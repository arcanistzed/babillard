import type { MlsGroupState, MlsLogEntry } from "./api";
import { fromBase64, toBase64 } from "./e2ee";
import type { HistoryRef, MlsTransport } from "./mlsClient";

/** One HTTP call. Resolves with the status and parsed body, whatever the status, and rejects only on a network failure. */
export type HttpCall = (method: "GET" | "POST", path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;

export class MlsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
  ) {
    super(`${status} ${error}`);
  }
}

/** The server's /mls routes, as the sync engine needs them. */
export function httpMlsTransport(call: HttpCall): MlsTransport {
  async function ok<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    if (response.status >= 400) throw new MlsHttpError(response.status, String((response.body as { error?: string } | null)?.error ?? "error"));
    return response.body as T;
  }

  return {
    async registerIdentity(deviceId, signatureKey) {
      await ok("POST", "/mls/identity", { deviceId, signatureKey: toBase64(signatureKey) });
    },
    async uploadKeyPackages(deviceId, keyPackages) {
      await ok("POST", "/mls/key-packages", { deviceId, keyPackages: keyPackages.map(toBase64) });
    },
    async keyPackageCount(deviceId) {
      return (await ok<{ available: number }>("GET", `/mls/key-packages/${deviceId}`)).available;
    },
    async claimKeyPackages(conversationId, deviceIds) {
      const result = await ok<{ keyPackages: { deviceId: string; keyPackage: string }[] }>("POST", `/mls/conversations/${conversationId}/key-packages`, { deviceIds });
      return result.keyPackages.map((entry) => ({ deviceId: entry.deviceId, keyPackage: fromBase64(entry.keyPackage) }));
    },
    groupState(conversationId) {
      return ok<MlsGroupState>("GET", `/mls/conversations/${conversationId}`);
    },
    async submit(conversationId, body) {
      const response = await call("POST", `/mls/conversations/${conversationId}/messages`, {
        deviceId: body.deviceId,
        message: toBase64(body.message),
        ...(body.welcome ? { welcome: toBase64(body.welcome) } : {}),
        ...(body.groupInfo ? { groupInfo: toBase64(body.groupInfo) } : {}),
        ...(body.clientId ? { clientId: body.clientId } : {}),
      });
      if (response.status < 400) return { ok: true, entry: response.body as MlsLogEntry };
      return { ok: false, status: response.status, error: String((response.body as { error?: string } | null)?.error ?? "error") };
    },
    async log(conversationId, since) {
      return ok<MlsLogEntry[]>("GET", `/mls/conversations/${conversationId}/messages?since=${since}`);
    },
    async welcome(conversationId, deviceId) {
      const response = await call("GET", `/mls/conversations/${conversationId}/welcome/${deviceId}`);
      if (response.status === 404) return null;
      if (response.status >= 400) throw new MlsHttpError(response.status, "welcome");
      const body = response.body as { seq: number; welcome: string };
      return { seq: body.seq, welcome: fromBase64(body.welcome) };
    },
    async groupInfo(conversationId) {
      const response = await call("GET", `/mls/conversations/${conversationId}/group-info`);
      if (response.status === 404) return null;
      if (response.status >= 400) throw new MlsHttpError(response.status, "group_info");
      return fromBase64((response.body as { groupInfo: string }).groupInfo);
    },
    async historyKeyId() {
      return (await ok<{ keyId: string | null }>("GET", "/mls/history/key")).keyId;
    },
    async setHistoryKeyId(keyId, replace) {
      const response = await call("POST", "/mls/history/key", { keyId, replace });
      if (response.status === 409) return "exists";
      if (response.status >= 400) throw new MlsHttpError(response.status, "history_key");
      return "ok";
    },
    async uploadHistory(keyId, entries) {
      const response = await call("POST", "/mls/history", {
        keyId,
        entries: entries.map((entry) => ({ conversationId: entry.conversationId, seq: entry.seq, entry: toBase64(entry.sealed) })),
      });
      if (response.status === 409) return "key_changed";
      if (response.status >= 400) throw new MlsHttpError(response.status, "history");
      return { rejected: (response.body as { rejected: HistoryRef[] }).rejected };
    },
    async history(conversationId, after) {
      const body = await ok<{ entries: { seq: number; entry: string }[] }>("GET", `/mls/history/${conversationId}?after=${after}`);
      return body.entries.map((entry) => ({ seq: entry.seq, sealed: fromBase64(entry.entry) }));
    },
  };
}
