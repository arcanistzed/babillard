import { isAnnouncementDue, requiredYesCount, yesStillNeeded, type ConversationKind } from "@babillard/shared";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "../db";
import { meetupAnnounceCooldownMs } from "./config";
import { venueNames } from "./language";
import { sendPush } from "./push";

type MeetupRow = typeof schema.meetups.$inferSelect;

export async function memberIds(db: Db, conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.conversationMembers.userId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, conversationId));
  return rows.map((row) => row.id);
}

/** Yeses from people still in the chat. Someone who left or deleted their account can't come. */
function memberYesCount(meetupId: string, conversationId: string) {
  // Plain names with aliases: drizzle leaves columns unqualified in single-table statements, which would make user_id ambiguous here.
  return sql<number>`(select count(*) from meetup_responses as yes_r inner join conversation_members as yes_m on yes_m.user_id = yes_r.user_id and yes_m.conversation_id = ${conversationId} where yes_r.meetup_id = ${meetupId} and yes_r.response = 'yes')`;
}

/** Current members who said yes or maybe: the people a change to the plan affects. */
export async function attendees(db: Db, meetupId: string, conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.meetupResponses.userId })
    .from(schema.meetupResponses)
    .innerJoin(schema.conversationMembers, and(eq(schema.conversationMembers.userId, schema.meetupResponses.userId), eq(schema.conversationMembers.conversationId, conversationId)))
    .where(and(eq(schema.meetupResponses.meetupId, meetupId), inArray(schema.meetupResponses.response, ["yes", "maybe"])));
  return rows.map((row) => row.userId);
}

function moreYeses(needed: number) {
  return { en: needed === 1 ? "1 more yes is needed" : `${needed} more yeses are needed`, fr: `il manque ${needed} oui` };
}

/** Someone who had said yes changed their answer. */
export interface Backout {
  userId: string;
  name: { en: string; fr: string };
  response: "no" | "maybe";
  /** When they had said yes. */
  yesAt: number;
}

/** A one-on-one chat that a block or an ended match closed, or that lost a member. Nobody there can meet anymore, so its meetups are left alone. */
async function isClosedDirectChat(db: Db, conversationId: string, memberCount: number): Promise<boolean> {
  if (memberCount < 2) return true;
  const [match] = await db.select({ state: schema.matches.state }).from(schema.matches).where(eq(schema.matches.conversationId, conversationId));
  return match !== undefined && match.state !== "active";
}

/**
 * Moves a meetup between proposed and confirmed to match its yes count, and tells the chat.
 * Each update re-counts inside its WHERE, so whichever of two simultaneous calls runs last sees every answer, and only one of them can win a transition.
 * A confirmed meetup only goes back to proposed before it starts.
 *
 * The state always changes straight away, but the chat hears about it at most once per cooldown. A change that has to wait
 * is announced by the next sweep after the cooldown, so someone flipping between yes and no can't flood the chat with messages and pushes.
 */
export async function settleMeetup(env: Env, db: Db, meetup: MeetupRow, kind: ConversationKind, options: { now?: number; backout?: Backout; waitUntil?: (promise: Promise<unknown>) => void } = {}): Promise<MeetupRow> {
  const now = options.now ?? Date.now();
  const cooldown = meetupAnnounceCooldownMs(env);
  const everyone = await memberIds(db, meetup.conversationId);
  if (kind === "direct" && (await isClosedDirectChat(db, meetup.conversationId, everyone.length))) return meetup;

  const required = requiredYesCount(kind, everyone.length);
  const yes = memberYesCount(meetup.id, meetup.conversationId);
  await db
    .update(schema.meetups)
    .set({ state: "confirmed" })
    .where(and(eq(schema.meetups.id, meetup.id), eq(schema.meetups.state, "proposed"), sql`${yes} >= ${required}`));
  const unconfirmed = await db
    .update(schema.meetups)
    .set({ state: "proposed" })
    .where(and(eq(schema.meetups.id, meetup.id), eq(schema.meetups.state, "confirmed"), gt(schema.meetups.startsAt, now), sql`${yes} < ${required}`))
    .returning({ id: schema.meetups.id });
  if (unconfirmed.length > 0) console.log(JSON.stringify({ event: "meetup_unconfirmed", meetupId: meetup.id, conversationKind: kind, backout: Boolean(options.backout) }));

  const [fresh] = await db.select({ meetup: schema.meetups, yes }).from(schema.meetups).where(eq(schema.meetups.id, meetup.id));
  const current = fresh?.meetup ?? meetup;
  const state = current.state;
  if (state !== "proposed" && state !== "confirmed") return current;

  // What the chat believes. Before the first confirmation it has only heard the proposal.
  const told = current.announcedState ?? "proposed";
  const where = venueNames(meetup);
  const stub = env.CHAT_ROOM.getByName(meetup.conversationId);
  const pushes: Promise<unknown>[] = [];
  const { backout } = options;

  if (state !== told && current.startsAt > now) {
    // Claims the announcement, so two requests or a request and the sweep can't both send it, and nothing is sent inside the cooldown.
    const claimed = await db
      .update(schema.meetups)
      .set({ announcedState: state, announcedAt: now })
      .where(
        and(
          eq(schema.meetups.id, meetup.id),
          eq(schema.meetups.state, state),
          sql`coalesce(${schema.meetups.announcedState}, 'proposed') = ${told}`,
          sql`(${schema.meetups.announcedAt} is null or ${schema.meetups.announcedAt} <= ${now - cooldown})`,
        ),
      )
      .returning({ id: schema.meetups.id });
    if (claimed.length > 0 && state === "confirmed") {
      await stub.postSystem(meetup.conversationId, `It's on! Meetup confirmed at ${where.en}.`, { fr: `C'est confirmé! Rencontre: ${where.fr}.`, kind: "meetup", meetupId: meetup.id });
      console.log(JSON.stringify({ event: "meetup_confirmed", meetupId: meetup.id, conversationKind: kind }));
      // Someone who said they can't come doesn't need to hear it's on.
      const declined = new Set(await answered(db, meetup.id, "no"));
      pushes.push(
        sendPush(env, everyone.filter((id) => !declined.has(id)), { title: "Your meetup is on", body: where.en, fr: { title: "Votre rencontre est confirmée", body: where.fr }, data: { screen: "meetup", id: meetup.id } }),
      );
    } else if (claimed.length > 0) {
      const more = moreYeses(yesStillNeeded(kind, fresh?.yes ?? 0, everyone.length));
      const off = { en: `The meetup at ${where.en} isn't confirmed anymore: ${more.en}.`, fr: `La rencontre n'est plus confirmée (${where.fr}): ${more.fr}.` };
      const body = backout ? { en: `${changedText(backout).en} ${off.en}`, fr: `${changedText(backout).fr} ${off.fr}` } : off;
      await stub.postSystem(meetup.conversationId, body.en, { fr: body.fr, kind: "meetup", meetupId: meetup.id });
      const recipients = (await attendees(db, meetup.id, meetup.conversationId)).filter((id) => id !== backout?.userId);
      pushes.push(sendPush(env, recipients, { title: "Your meetup isn't confirmed anymore", body: body.en, fr: { title: "Votre rencontre n'est plus confirmée", body: body.fr }, data: { screen: "meetup", id: meetup.id } }));
    }
  } else if (backout && state === "confirmed" && isAnnouncementDue(backout.yesAt, now, cooldown)) {
    // Still on, or already started. A yes taken back within the cooldown was never announced, so taking it back isn't either.
    const started = current.startsAt <= now;
    const changed = changedText(backout);
    const body = started ? changed : { en: `${changed.en} The meetup at ${where.en} is still on.`, fr: `${changed.fr} La rencontre est toujours confirmée: ${where.fr}.` };
    await stub.postSystem(meetup.conversationId, body.en, { fr: body.fr, kind: "meetup", meetupId: meetup.id });
    const recipients = (await attendees(db, meetup.id, meetup.conversationId)).filter((id) => id !== backout.userId);
    pushes.push(sendPush(env, recipients, { title: "A change to your meetup", body: body.en, fr: { title: "Changement pour votre rencontre", body: body.fr }, data: { screen: "meetup", id: meetup.id } }));
  }

  if (options.waitUntil) for (const push of pushes) options.waitUntil(push);
  else await Promise.all(pushes);
  return current;
}

function changedText(backout: Backout) {
  return backout.response === "no"
    ? { en: `${backout.name.en} can't make it anymore.`, fr: `${backout.name.fr} ne peut plus venir.` }
    : { en: `${backout.name.en} changed their answer to maybe.`, fr: `${backout.name.fr} a changé sa réponse pour peut-être.` };
}

async function answered(db: Db, meetupId: string, response: "yes" | "no" | "maybe"): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.meetupResponses.userId })
    .from(schema.meetupResponses)
    .where(and(eq(schema.meetupResponses.meetupId, meetupId), eq(schema.meetupResponses.response, response)));
  return rows.map((row) => row.userId);
}
