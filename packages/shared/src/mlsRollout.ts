/**
 * The server's MLS switch, MLS_ENABLED, and who it applies to. Pure, so it's tested on its own.
 *
 * - "true" (`on`): MLS for everyone, and chats move to it as their members become ready.
 * - "testers": MLS only for the people named in MLS_TESTERS. A chat moves only when every member is one.
 * - "paused": chats already on MLS carry on, and no other chat moves.
 * - anything else (`off`): every /mls route answers 404.
 */
export type MlsMode = "on" | "testers" | "paused" | "off";

export function parseMlsMode(value: string | undefined): MlsMode {
  if (value === "true") return "on";
  if (value === "testers") return "testers";
  if (value === "paused") return "paused";
  return "off";
}

/**
 * MLS_TESTERS: emails or user IDs, separated by commas, spaces or new lines. An entry with an "@" is
 * an email, compared without case. Empty or missing names nobody.
 */
export interface MlsTesters {
  emails: Set<string>;
  ids: Set<string>;
}

export function parseMlsTesters(value: string | undefined): MlsTesters {
  const testers: MlsTesters = { emails: new Set(), ids: new Set() };
  for (const entry of (value ?? "").split(/[\s,]+/)) {
    if (!entry) continue;
    if (entry.includes("@")) testers.emails.add(entry.toLowerCase());
    else testers.ids.add(entry);
  }
  return testers;
}

export interface MlsPerson {
  id: string;
  email: string;
}

export function isMlsTester(testers: MlsTesters, person: MlsPerson): boolean {
  return testers.ids.has(person.id) || testers.emails.has(person.email.toLowerCase());
}

/** What `/me` says: whether this person's app should use MLS at all. */
export function mlsOnFor(mode: MlsMode, testers: MlsTesters, person: MlsPerson): boolean {
  if (mode === "on" || mode === "paused") return true;
  if (mode === "testers") return isMlsTester(testers, person);
  return false;
}

/**
 * Whether a chat with these active members may move to MLS now, which is whether the server
 * accepts its group's first commit. Refused, the phone gets `not_ready` and the chat stays on v1.
 */
export function mlsMayMove(mode: MlsMode, testers: MlsTesters, members: MlsPerson[]): boolean {
  if (mode === "on") return true;
  if (mode === "testers") return members.length > 0 && members.every((member) => isMlsTester(testers, member));
  return false;
}
