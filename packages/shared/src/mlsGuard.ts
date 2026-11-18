import type { MlsCrypto, MlsStore } from "./mlsClient";

/**
 * The downgrade guard. Once this phone holds a chat's MLS group, it never sends v1 there, whatever
 * `/me` says. v1 has no forward secrecy, so a server that claimed MLS was off could otherwise get
 * a chat that moved back onto it.
 *
 * It reads only the phone's own store, with no transport, so it can't register, upload or call
 * `/mls`. A commit still waiting for its answer counts too: the server may have accepted it, and a
 * first commit is what moves a chat.
 */
export async function holdsMlsGroup(store: Pick<MlsStore, "loadDevice" | "pendingCommits">, crypto: Pick<MlsCrypto, "groupStatus">, conversationId: string): Promise<boolean> {
  if ((await store.pendingCommits())[conversationId]) return true;
  const device = await store.loadDevice();
  return device !== null && (await crypto.groupStatus(device.state, conversationId)) !== null;
}

/** A v1 send refused because this phone holds the chat's MLS group. */
export class MlsDowngradeError extends Error {
  constructor(readonly conversationId: string) {
    super("This phone holds an MLS group for this chat, so it won't send v1 there");
  }
}

/**
 * How a message goes out: with MLS when the server has it on here and this phone holds the group,
 * v1 when it holds none, and not at all when it holds one but MLS is off.
 */
export function sendPath(mlsOn: boolean, holdsGroup: boolean): "mls" | "v1" | "refuse" {
  if (!holdsGroup) return "v1";
  return mlsOn ? "mls" : "refuse";
}
