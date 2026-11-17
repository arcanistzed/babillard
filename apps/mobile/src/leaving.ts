import { mlsMessenger } from "./mls";

/** Chats the person left from this phone's own screens, so the chat screen closes without telling them what they just did. */
const leftHere = new Set<string>();

export function markLeftHere(conversationId: string, left: boolean): void {
  if (left) leftHere.add(conversationId);
  else leftHere.delete(conversationId);
}

export function wasLeftHere(conversationId: string): boolean {
  return leftHere.has(conversationId);
}

/**
 * Deletes this phone's MLS copy of a chat the person is no longer in: the group, the messages,
 * and anything in flight. Like v1, where the server stops showing a chat once someone is out of it.
 */
export async function forgetMlsChat(userId: string, conversationId: string): Promise<void> {
  const mls = mlsMessenger(userId);
  if (!mls) return;
  await (await mls).forgetChat(conversationId);
}
