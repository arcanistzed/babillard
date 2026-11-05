import { DurableObject } from "cloudflare:workers";
import { GROUP_MAX_SIZE, canJoin, formGroups, topicPhrase, type Stance, type Waiter } from "@ideas-match/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import { blocksBetween, blockedWith } from "../lib/blocks";
import { sendPush } from "../lib/push";
import { newId } from "../lib/tokens";

export interface CohortJoin {
  userId: string;
  stance: Stance | null;
  topicId: string;
  topicKind: "interest" | "question";
  topicTitle: string;
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

const MAX_WAITERS_CHECKED = 90;

/**
 * One per (topic, city). Joins run one at a time, because each one reads D1
 * between deciding and writing and two interleaved joins could split a group.
 *
 * A new group is recorded here first and written to D1 afterwards. If the D1
 * write fails, the next join finishes it, so a group is never lost or doubled.
 */
export class Cohort extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
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
      `);
    });
  }

  /** Safe to call twice for the same user. Returns the conversation they ended up in, if any. */
  join(input: CohortJoin): Promise<string | null> {
    const run = this.tail.then(() => this.runJoin(input));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async runJoin(input: CohortJoin): Promise<string | null> {
    await this.flushPending(input);

    const sqlite = this.ctx.storage.sql;
    sqlite.exec(
      "INSERT OR IGNORE INTO members (user_id, stance, joined_at, group_id) VALUES (?, ?, ?, NULL)",
      input.userId,
      input.stance,
      Date.now(),
    );
    const me = sqlite.exec<MemberRow>("SELECT * FROM members WHERE user_id = ?", input.userId).one();
    if (me.group_id) return me.group_id;

    const joinedOpen = await this.tryJoinOpenGroup(input);
    if (joinedOpen) return joinedOpen;

    return this.tryFormGroup(input);
  }

  private async tryJoinOpenGroup(input: CohortJoin): Promise<string | null> {
    const sqlite = this.ctx.storage.sql;
    const newest = sqlite.exec<GroupRow>("SELECT * FROM groups WHERE flushed = 1 ORDER BY created_at DESC LIMIT 1").toArray()[0];
    if (!newest) return null;

    const db = getDb(this.env);
    const current = await db
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.conversationId, newest.id));
    const memberIds = current.map((row) => row.userId);
    if (memberIds.length >= GROUP_MAX_SIZE) return null;

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
    await this.env.CHAT_ROOM.getByName(newest.id).postSystem(newest.id, `${profile?.name ?? "Someone new"} joined the group.`);
    return newest.id;
  }

  private async tryFormGroup(input: CohortJoin): Promise<string | null> {
    const sqlite = this.ctx.storage.sql;
    const waitingRows = sqlite
      .exec<MemberRow>("SELECT * FROM members WHERE group_id IS NULL ORDER BY joined_at ASC LIMIT ?", MAX_WAITERS_CHECKED)
      .toArray();

    const db = getDb(this.env);
    const eligible = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.id, waitingRows.map((row) => row.user_id)),
          eq(schema.users.status, "active"),
          eq(schema.users.cityId, input.cityId),
          isNotNull(schema.users.onboardedAt),
        ),
      );
    const eligibleIds = new Set(eligible.map((row) => row.id));
    const waiting: Waiter[] = waitingRows
      .filter((row) => eligibleIds.has(row.user_id))
      .map((row) => ({ userId: row.user_id, stance: row.stance as Stance | null, joinedAt: row.joined_at }));

    const blocks = await blocksBetween(db, waiting.map((waiter) => waiter.userId));
    const memberIds = formGroups({ waiting, topicKind: input.topicKind, blocks });
    if (!memberIds) return null;

    const groupId = newId();
    this.ctx.storage.transactionSync(() => {
      sqlite.exec("INSERT INTO groups (id, member_ids, created_at) VALUES (?, ?, ?)", groupId, JSON.stringify(memberIds), Date.now());
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
        `A group on ${topicPhrase(input.topicTitle)} just opened in ${input.cityName}. Say hi, then pick a time to meet.`,
      );
      sqlite.exec("UPDATE groups SET flushed = 1 WHERE id = ?", group.id);
      console.log(JSON.stringify({ event: "group_formed", conversationId: group.id, topicId: input.topicId, cityId: input.cityId, size: memberIds.length }));
      this.ctx.waitUntil(
        sendPush(this.env, memberIds, {
          title: "Your group is open",
          body: `A group on ${topicPhrase(input.topicTitle)} just opened in ${input.cityName}`,
          data: { screen: "chat", id: group.id },
        }),
      );
    }
  }
}
