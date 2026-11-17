import { DurableObject } from "cloudflare:workers";
import { GROUP_MAX_SIZE, ageOn, canJoin, formGroups, groupStanceSpread, sizeBounds, topicPhrase, type Lean, type Stance, type Waiter } from "@babillard/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import { blocksBetween, blockedWith } from "../lib/blocks";
import { isDevMode } from "../lib/config";
import { sendPush } from "../lib/push";
import { newId } from "../lib/tokens";

export interface CohortJoin {
  userId: string;
  stance: Stance | null;
  topicId: string;
  topicKind: "interest" | "question";
  topicTitle: string;
  topicTitleFr: string;
  cityId: string;
  cityName: string;
}

interface MemberRow extends Record<string, SqlStorageValue> {
  user_id: string;
  stance: string | null;
  joined_at: number;
  group_id: string | null;
}

interface GroupRow extends Record<string, SqlStorageValue> {
  id: string;
  member_ids: string;
  flushed: number;
  created_at: number;
}

// Also keeps each D1 lookup under its limit of bound parameters.
const MAX_WAITERS_CHECKED = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One per (topic, city). Every call runs one at a time, because a join reads D1
 * between deciding and writing, and anything interleaved could split a group or
 * put someone back into one they just left.
 *
 * A new group is recorded here first and written to D1 afterwards. If the D1
 * write fails, the next join finishes it, so a group is never lost or doubled.
 */
export class Cohort extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      // Only ever adds tables, so cohorts created before a change pick it up on their next start.
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS members (
          user_id TEXT PRIMARY KEY,
          stance TEXT,
          joined_at INTEGER NOT NULL,
          group_id TEXT
        );
        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY,
          member_ids TEXT NOT NULL,
          flushed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS left_groups (
          user_id TEXT NOT NULL,
          group_id TEXT NOT NULL,
          PRIMARY KEY (user_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS group_stances (
          group_id TEXT PRIMARY KEY,
          counts TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );
      `);
    });
  }

  private serial<T>(work: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(work);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Safe to call twice for the same user. Returns the conversation they ended up in, if any. */
  join(input: CohortJoin): Promise<string | null> {
    return this.serial(() => this.runJoin(input));
  }

  /** Keeps the waiting list's copy of someone's answer in step with the one they changed. */
  setStance(userId: string, stance: Stance | null): Promise<void> {
    return this.serial(() => {
      this.ctx.storage.sql.exec("UPDATE members SET stance = ? WHERE user_id = ?", stance, userId);
    });
  }

  /**
   * Takes someone off the waiting list. Returns the group they're in instead, if they are in one,
   * because only waiting can be undone here. Leaving a group happens in the chat.
   */
  leave(userId: string): Promise<{ groupConversationId: string | null }> {
    return this.serial(async () => {
      const sqlite = this.ctx.storage.sql;
      const me = sqlite.exec<MemberRow>("SELECT * FROM members WHERE user_id = ?", userId).toArray()[0];
      if (me?.group_id) {
        if (!(await this.leftUnrecorded(me))) return { groupConversationId: me.group_id };
        sqlite.exec("INSERT OR IGNORE INTO left_groups (user_id, group_id) VALUES (?, ?)", userId, me.group_id);
      }
      sqlite.exec("DELETE FROM members WHERE user_id = ?", userId);
      return { groupConversationId: null };
    });
  }

  /** Someone who left a group goes back on the waiting list, at the back, and is never put in that group again. */
  leaveGroup(userId: string, groupId: string): Promise<void> {
    return this.serial(() => this.requeue(userId, groupId));
  }

  /** Removes everything held about someone whose account is deleted. Returns how many places they were in. */
  forget(userId: string): Promise<number> {
    return this.serial(() => this.forgetNow([userId]));
  }

  /** The totals saved when this group formed, or null when the rule hid them or the group formed before they were saved. */
  stanceSpread(groupId: string): Promise<Lean | null> {
    return this.serial(() => {
      const row = this.ctx.storage.sql.exec<{ counts: string }>("SELECT counts FROM group_stances WHERE group_id = ?", groupId).toArray()[0];
      return row ? (JSON.parse(row.counts) as Lean) : null;
    });
  }

  /**
   * True when someone this cohort has in a written group is no longer in it, because they left before leaving was
   * recorded here. A group still being written to D1 counts as one they're in.
   */
  private async leftUnrecorded(me: MemberRow): Promise<boolean> {
    const group = this.ctx.storage.sql.exec<GroupRow>("SELECT * FROM groups WHERE id = ?", me.group_id).toArray()[0];
    if (!group || group.flushed === 0) return false;
    const [membership] = await getDb(this.env)
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, me.group_id!), eq(schema.conversationMembers.userId, me.user_id)));
    return !membership;
  }

  private requeue(userId: string, groupId: string): void {
    const sqlite = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sqlite.exec("INSERT OR IGNORE INTO left_groups (user_id, group_id) VALUES (?, ?)", userId, groupId);
      sqlite.exec("UPDATE members SET group_id = NULL, joined_at = ? WHERE user_id = ? AND group_id = ?", Date.now(), userId, groupId);
    });
  }

  private forgetNow(userIds: string[]): number {
    const sqlite = this.ctx.storage.sql;
    const gone = new Set(userIds);
    let removed = 0;
    this.ctx.storage.transactionSync(() => {
      for (const userId of userIds) {
        removed += sqlite.exec("DELETE FROM members WHERE user_id = ?", userId).rowsWritten;
        sqlite.exec("DELETE FROM left_groups WHERE user_id = ?", userId);
      }
      // Group rosters keep IDs only to write a new group to D1. Removing the person also keeps a group not yet written from adding them.
      for (const group of sqlite.exec<GroupRow>("SELECT * FROM groups").toArray()) {
        const memberIds = JSON.parse(group.member_ids) as string[];
        const kept = memberIds.filter((id) => !gone.has(id));
        if (kept.length !== memberIds.length) sqlite.exec("UPDATE groups SET member_ids = ? WHERE id = ?", JSON.stringify(kept), group.id);
      }
    });
    return removed;
  }

  /**
   * At most daily, and on every join in development: removes anyone whose account was deleted without this cohort
   * hearing about it (before deletion told cohorts, or from a city they had moved away from), and puts back on the
   * waiting list anyone who left their group before leaving was recorded here. Banned people stay, in case of an unban.
   */
  private async purgeIfDue(input: CohortJoin): Promise<void> {
    const sqlite = this.ctx.storage.sql;
    const now = Date.now();
    const last = sqlite.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'purged_at'").toArray()[0]?.value ?? 0;
    if (!isDevMode(this.env) && now - last < DAY_MS) return;

    const db = getDb(this.env);
    let removed = 0;
    let requeued = 0;
    let after = "";
    for (;;) {
      const page = sqlite.exec<MemberRow>("SELECT * FROM members WHERE user_id > ? ORDER BY user_id LIMIT ?", after, MAX_WAITERS_CHECKED).toArray();
      if (page.length === 0) break;
      after = page[page.length - 1]!.user_id;
      const ids = page.map((row) => row.user_id);
      const grouped = page.filter((row) => row.group_id !== null);
      const [accounts, memberships] = await Promise.all([
        db.select({ id: schema.users.id, status: schema.users.status }).from(schema.users).where(inArray(schema.users.id, ids)),
        grouped.length
          ? db
              .select({ conversationId: schema.conversationMembers.conversationId, userId: schema.conversationMembers.userId })
              .from(schema.conversationMembers)
              .where(inArray(schema.conversationMembers.userId, grouped.map((row) => row.user_id)))
          : Promise.resolve([]),
      ]);
      const live = new Set(accounts.filter((account) => account.status !== "deleted").map((account) => account.id));
      const gone = ids.filter((id) => !live.has(id));
      removed += gone.length ? this.forgetNow(gone) : 0;
      const inGroup = new Set(memberships.map((row) => `${row.conversationId}|${row.userId}`));
      for (const row of grouped) {
        if (!live.has(row.user_id) || inGroup.has(`${row.group_id}|${row.user_id}`)) continue;
        this.requeue(row.user_id, row.group_id!);
        requeued += 1;
      }
    }
    sqlite.exec("INSERT INTO meta (key, value) VALUES ('purged_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", now);
    if (removed || requeued) console.log(JSON.stringify({ event: "cohort_purged", cohort: `${input.topicId}:${input.cityId}`, removed, requeued }));
  }

  private async runJoin(input: CohortJoin): Promise<string | null> {
    await this.flushPending(input);
    await this.purgeIfDue(input);

    const sqlite = this.ctx.storage.sql;
    sqlite.exec(
      "INSERT OR IGNORE INTO members (user_id, stance, joined_at, group_id) VALUES (?, ?, ?, NULL)",
      input.userId,
      input.stance,
      Date.now(),
    );
    let me = sqlite.exec<MemberRow>("SELECT * FROM members WHERE user_id = ?", input.userId).one();
    if (me.group_id && (await this.leftUnrecorded(me))) {
      this.requeue(me.user_id, me.group_id);
      me = sqlite.exec<MemberRow>("SELECT * FROM members WHERE user_id = ?", input.userId).one();
    }
    if (me.group_id) return me.group_id;

    const joinedOpen = await this.tryJoinOpenGroup(input);
    if (joinedOpen) return joinedOpen;

    return this.tryFormGroup(input);
  }

  private async tryJoinOpenGroup(input: CohortJoin): Promise<string | null> {
    const sqlite = this.ctx.storage.sql;
    const newest = sqlite.exec<GroupRow>("SELECT * FROM groups WHERE flushed = 1 ORDER BY created_at DESC LIMIT 1").toArray()[0];
    if (!newest) return null;
    if (sqlite.exec("SELECT 1 FROM left_groups WHERE user_id = ? AND group_id = ?", input.userId, newest.id).toArray().length) return null;

    const db = getDb(this.env);
    const current = await db
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.conversationId, newest.id));
    const memberIds = current.map((row) => row.userId);
    if (memberIds.length >= GROUP_MAX_SIZE) return null;

    // The group can grow only while it stays within the largest size everyone in it, and the newcomer, asked for.
    const sizes = await db
      .select({ groupSize: schema.profiles.groupSize })
      .from(schema.profiles)
      .where(inArray(schema.profiles.userId, [...memberIds, input.userId]));
    const { min, max } = sizeBounds(sizes.map((row) => row.groupSize));
    if (min > max || memberIds.length + 1 > max) return null;

    const blocked = await blockedWith(db, input.userId);
    const blockPairs = [...blocked].map((other) => [input.userId, other] as const);
    if (!canJoin(input.userId, memberIds, blockPairs)) return null;

    await db
      .insert(schema.conversationMembers)
      .values({ conversationId: newest.id, userId: input.userId, joinedAt: Date.now() })
      .onConflictDoNothing();
    sqlite.exec("UPDATE members SET group_id = ? WHERE user_id = ?", newest.id, input.userId);

    const [profile] = await db
      .select({ name: schema.profiles.displayName })
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, input.userId));
    await this.env.CHAT_ROOM.getByName(newest.id).postSystem(newest.id, `${profile?.name ?? "Someone new"} joined the group.`, { fr: `${profile?.name ?? "Une nouvelle personne"} a rejoint le groupe.` });
    return newest.id;
  }

  private async tryFormGroup(input: CohortJoin): Promise<string | null> {
    const sqlite = this.ctx.storage.sql;
    const waitingRows = sqlite
      .exec<MemberRow>("SELECT * FROM members WHERE group_id IS NULL ORDER BY joined_at ASC LIMIT ?", MAX_WAITERS_CHECKED)
      .toArray();

    const db = getDb(this.env);
    const eligible = await db
      .select({ id: schema.users.id, dob: schema.users.dob, groupSize: schema.profiles.groupSize })
      .from(schema.users)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(
        and(
          inArray(schema.users.id, waitingRows.map((row) => row.user_id)),
          eq(schema.users.status, "active"),
          eq(schema.users.cityId, input.cityId),
          isNotNull(schema.users.onboardedAt),
        ),
      );
    const people = new Map(eligible.map((row) => [row.id, row]));
    const waiting: Waiter[] = waitingRows
      .filter((row) => people.has(row.user_id))
      .map((row) => {
        const person = people.get(row.user_id)!;
        return {
          userId: row.user_id,
          stance: row.stance as Stance | null,
          joinedAt: row.joined_at,
          age: person.dob ? ageOn(person.dob) : null,
          groupSize: person.groupSize ?? "any",
        };
      });

    const blocks = await blocksBetween(db, waiting.map((waiter) => waiter.userId));
    const memberIds = formGroups({ waiting, topicKind: input.topicKind, blocks });
    if (!memberIds) return null;

    const groupId = newId();
    // Saved now, while everyone in it arrives together, so later joins, leaves and changed answers can't be read off it.
    const stanceOf = new Map(waiting.map((waiter) => [waiter.userId, waiter.stance]));
    const spread = input.topicKind === "question" ? groupStanceSpread(memberIds.map((id) => stanceOf.get(id) ?? null)) : null;
    this.ctx.storage.transactionSync(() => {
      sqlite.exec("INSERT INTO groups (id, member_ids, created_at) VALUES (?, ?, ?)", groupId, JSON.stringify(memberIds), Date.now());
      if (spread) sqlite.exec("INSERT INTO group_stances (group_id, counts) VALUES (?, ?)", groupId, JSON.stringify(spread));
      for (const memberId of memberIds) sqlite.exec("UPDATE members SET group_id = ? WHERE user_id = ?", groupId, memberId);
    });
    await this.flushPending(input);
    return memberIds.includes(input.userId) ? groupId : null;
  }

  private async flushPending(input: CohortJoin): Promise<void> {
    const sqlite = this.ctx.storage.sql;
    const pending = sqlite.exec<GroupRow>("SELECT * FROM groups WHERE flushed = 0").toArray();
    const db = getDb(this.env);

    for (const group of pending) {
      const memberIds = JSON.parse(group.member_ids) as string[];
      const now = Date.now();
      await db.batch([
        db
          .insert(schema.conversations)
          .values({ id: group.id, kind: "group", topicId: input.topicId, localityId: input.cityId, createdAt: now })
          .onConflictDoNothing(),
        db
          .insert(schema.conversationMembers)
          .values(memberIds.map((userId) => ({ conversationId: group.id, userId, joinedAt: now })))
          .onConflictDoNothing(),
      ]);
      await this.env.CHAT_ROOM.getByName(group.id).postSystem(
        group.id,
        `A group on ${topicPhrase(input.topicTitle)} just opened in ${input.cityName}.`,
        { fr: `Un groupe sur ${topicPhrase(input.topicTitleFr, "fr")} vient d'ouvrir à ${input.cityName}.` },
      );
      sqlite.exec("UPDATE groups SET flushed = 1 WHERE id = ?", group.id);
      console.log(JSON.stringify({ event: "group_formed", conversationId: group.id, topicId: input.topicId, cityId: input.cityId, size: memberIds.length }));
      this.ctx.waitUntil(
        sendPush(this.env, memberIds, {
          title: "Your group is open",
          body: `A group on ${topicPhrase(input.topicTitle)} just opened in ${input.cityName}`,
          fr: { title: "Votre groupe est ouvert", body: `Un groupe sur ${topicPhrase(input.topicTitleFr, "fr")} vient d'ouvrir à ${input.cityName}` },
          data: { screen: "chat", id: group.id },
        }),
      );
    }
  }
}
