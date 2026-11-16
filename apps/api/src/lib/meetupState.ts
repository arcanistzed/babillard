import { requiredYesCount, yesStillNeeded, type ConversationKind } from "@babillard/shared";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "../db";
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
}

/**
 * Moves a meetup between proposed and confirmed to match its yes count, and tells the chat.
 * Each update re-counts inside its WHERE, so whichever of two simultaneous calls runs last sees every answer, and only one of them can win a transition.
 * A confirmed meetup only goes back to proposed before it starts.
 */
export async function settleMeetup(env: Env, db: Db, meetup: MeetupRow, kind: ConversationKind, options: { now?: number; backout?: Backout; waitUntil?: (promise: Promise<unknown>) => void } = {}): Promise<MeetupRow> {
  const now = options.now ?? Date.now();
  const defer = options.waitUntil ?? (() => undefined);
  const everyone = await memberIds(db, meetup.conversationId);
  const required = requiredYesCount(kind, everyone.length);
  const yes = memberYesCount(meetup.id, meetup.conversationId);
  const stub = env.CHAT_ROOM.getByName(meetup.conversationId);
  const where = venueNames(meetup);
  const pushes: Promise<unknown>[] = [];

  const confirmed = await db
    .update(schema.meetups)
    .set({ state: "confirmed" })
    .where(and(eq(schema.meetups.id, meetup.id), eq(schema.meetups.state, "proposed"), sql`${yes} >= ${required}`))
    .returning({ id: schema.meetups.id });
  const unconfirmed = await db
    .update(schema.meetups)
    .set({ state: "proposed" })
    .where(and(eq(schema.meetups.id, meetup.id), eq(schema.meetups.state, "confirmed"), gt(schema.meetups.startsAt, now), sql`${yes} < ${required}`))
    .returning({ id: schema.meetups.id });

  const [fresh] = await db.select({ meetup: schema.meetups, yes }).from(schema.meetups).where(eq(schema.meetups.id, meetup.id));
  const current = fresh?.meetup ?? meetup;
  const stillNeeded = yesStillNeeded(kind, fresh?.yes ?? 0, everyone.length);

  if (confirmed.length > 0) {
    await stub.postSystem(meetup.conversationId, `It's on! Meetup confirmed at ${where.en}.`, { fr: `C'est confirmé! Rencontre: ${where.fr}.`, kind: "meetup", meetupId: meetup.id });
    console.log(JSON.stringify({ event: "meetup_confirmed", meetupId: meetup.id, conversationKind: kind }));
    pushes.push(sendPush(env, everyone, { title: "Your meetup is on", body: where.en, fr: { title: "Votre rencontre est confirmée", body: where.fr }, data: { screen: "meetup", id: meetup.id } }));
  }
  if (unconfirmed.length > 0) console.log(JSON.stringify({ event: "meetup_unconfirmed", meetupId: meetup.id, conversationKind: kind, backout: Boolean(options.backout) }));

  const { backout } = options;
  const wasOn = meetup.state === "confirmed" || unconfirmed.length > 0;
  if (backout && wasOn && confirmed.length === 0) {
    const on = current.state === "confirmed";
    const more = moreYeses(stillNeeded);
    const changed =
      backout.response === "no"
        ? { en: `${backout.name.en} can't make it anymore.`, fr: `${backout.name.fr} ne peut plus venir.` }
        : { en: `${backout.name.en} changed their answer to maybe.`, fr: `${backout.name.fr} a changé sa réponse pour peut-être.` };
    // Once it has started a meetup stays confirmed, so "still on" could be false. Just say who changed.
    const started = current.startsAt <= now;
    const status = started
      ? null
      : on
        ? { en: `The meetup at ${where.en} is still on.`, fr: `La rencontre est toujours confirmée: ${where.fr}.` }
        : { en: `The meetup at ${where.en} isn't confirmed anymore: ${more.en}.`, fr: `La rencontre n'est plus confirmée (${where.fr}): ${more.fr}.` };
    const body = status ? { en: `${changed.en} ${status.en}`, fr: `${changed.fr} ${status.fr}` } : changed;
    await stub.postSystem(meetup.conversationId, body.en, { fr: body.fr, kind: "meetup", meetupId: meetup.id });
    const told = (await attendees(db, meetup.id, meetup.conversationId)).filter((id) => id !== backout.userId);
    pushes.push(
      sendPush(env, told, {
        title: on || started ? "A change to your meetup" : "Your meetup isn't confirmed anymore",
        body: body.en,
        fr: { title: on || started ? "Changement pour votre rencontre" : "Votre rencontre n'est plus confirmée", body: body.fr },
        data: { screen: "meetup", id: meetup.id },
      }),
    );
  } else if (unconfirmed.length > 0) {
    // Nobody changed their answer: someone left, or the group grew and now needs more yeses.
    const more = moreYeses(stillNeeded);
    const body = { en: `The meetup at ${where.en} isn't confirmed anymore: ${more.en}.`, fr: `La rencontre n'est plus confirmée (${where.fr}): ${more.fr}.` };
    await stub.postSystem(meetup.conversationId, body.en, { fr: body.fr, kind: "meetup", meetupId: meetup.id });
    pushes.push(
      sendPush(env, await attendees(db, meetup.id, meetup.conversationId), {
        title: "Your meetup isn't confirmed anymore",
        body: body.en,
        fr: { title: "Votre rencontre n'est plus confirmée", body: body.fr },
        data: { screen: "meetup", id: meetup.id },
      }),
    );
  }
  for (const push of pushes) defer(push);
  if (!options.waitUntil) await Promise.all(pushes);
  return current;
}
