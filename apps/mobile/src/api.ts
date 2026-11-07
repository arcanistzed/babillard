const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8787";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    // A rejected code or link says nothing about the session this device already has.
    if (response.status === 401 && sessionToken && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(response.status, payload.error ?? "request_failed");
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export async function uploadAvatar(uri: string): Promise<void> {
  const file = await (await fetch(uri)).blob();
  const response = await fetch(`${BASE_URL}/me/avatar`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}) },
    body: file,
  });
  if (!response.ok) throw new ApiError(response.status, "upload_failed");
}

/** React Native's WebSocket accepts headers as a third argument, which keeps the token out of URLs and logs. */
export function openConversationSocket(conversationId: string): WebSocket {
  const url = `${BASE_URL.replace(/^http/, "ws")}/conversations/${conversationId}/ws`;
  const Socket = WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket;
  return new Socket(url, undefined, { headers: { authorization: `Bearer ${sessionToken ?? ""}` } });
}

export function friendlyError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  const messages: Record<string, string> = {
    network: "Can't reach Ideas Match. Check your connection and try again.",
    invalid_or_expired: "That code didn't work. Check it, or ask for a new one.",
    account_unavailable: "This account has been closed.",
    under_age: "Ideas Match is for people 18 and over.",
    email_unavailable: "We couldn't send your email just now. Try again in a minute.",
    too_many_submissions: "That's the limit for today. Suggest more tomorrow.",
    too_many_reports: "That's the limit for today. If you're in danger, contact local emergency services.",
    invalid_request: "Some of that isn't quite right. Check it and try again.",
    conversation_closed: "This conversation has ended.",
    starts_in_the_past: "That time has already passed. Pick another.",
    upload_failed: "That photo didn't upload. Try a different one.",
  };
  return messages[error.code] ?? "Something went wrong. Try again.";
}
