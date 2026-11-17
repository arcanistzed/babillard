/**
 * Whether this phone shows a message from `senderId`.
 *
 * In an MLS chat every phone has to read every message to stay in step with the
 * group, so the server can't drop a blocked person's messages the way it does
 * for v1. Instead the blocker's phone still reads and stores them, and hides
 * them on screen. That matches what v1 users see: unblocking someone brings
 * their messages back, because v1's server also filters when history is read.
 *
 * `blocked` is null when this phone has never learned its block list. Then only
 * its own messages and the app's notices show, so a blocked person's words
 * never appear just because the list hasn't loaded yet.
 */
export function showsSender(senderId: string | null, myId: string, blocked: ReadonlySet<string> | null): boolean {
  if (senderId === null || senderId === myId) return true;
  return blocked !== null && !blocked.has(senderId);
}
