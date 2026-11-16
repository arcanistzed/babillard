import type { BlockPair } from "@babillard/shared";
import { and, eq, inArray, ne, notExists, or, sql } from "drizzle-orm";
import { schema, type Db } from "../db";
import { hmacHex } from "./tokens";

/** Everyone with a block in either direction with this user. */
export async function blockedWith(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(schema.blocks)
    .where(or(eq(schema.blocks.blockerId, userId), eq(schema.blocks.blockedId, userId)));
  return new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)));
}

/** Which of `others` have a block in either direction with this user. */
export async function blockedWithAmong(db: Db, userId: string, others: string[]): Promise<Set<string>> {
  if (others.length === 0) return new Set();
  const rows = await db
    .select()
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerId, userId), inArray(schema.blocks.blockedId, others)),
        and(eq(schema.blocks.blockedId, userId), inArray(schema.blocks.blockerId, others)),
      ),
    );
  return new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)));
}

export async function blocksBetween(db: Db, userIds: string[]): Promise<BlockPair[]> {
  if (userIds.length < 2) return [];
  const rows = await db
    .select()
    .from(schema.blocks)
    .where(and(inArray(schema.blocks.blockerId, userIds), inArray(schema.blocks.blockedId, userIds)));
  return rows.map((row) => [row.blockerId, row.blockedId] as const);
}

/**
 * What a deleted account's email becomes while other people's blocks on it remain.
 * It's a keyed hash, so it can't be read back as the address, but the same address
 * signing up again produces it and inherits those blocks.
 */
export async function blockedEmailTombstone(secret: string, email: string): Promise<string> {
  return `blocked-${await hmacHex(secret, `blocked-email:${email}`)}@deleted.invalid`;
}

export const deletedEmail = (id: string) => `deleted-${id}@deleted.invalid`;

/**
 * Forgets the hashed email of deleted accounts that nobody blocks any more,
 * so it's kept only while a block on that person lasts.
 */
export async function releaseUnblockedTombstones(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(schema.users)
    .set({ email: sql`'deleted-' || ${schema.users.id} || '@deleted.invalid'` })
    .where(
      and(
        inArray(schema.users.id, ids),
        eq(schema.users.status, "deleted"),
        sql`${schema.users.email} LIKE 'blocked-%'`,
        notExists(db.select({ one: sql`1` }).from(schema.blocks).where(eq(schema.blocks.blockedId, schema.users.id))),
      ),
    );
}

/**
 * When someone signs up with the email of a deleted account that others had blocked,
 * those blocks move to the new account and the hash is dropped.
 */
export async function inheritBlocks(db: Db, secret: string, email: string, userId: string): Promise<void> {
  const tombstoneEmail = await blockedEmailTombstone(secret, email);
  const [tombstone] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.email, tombstoneEmail), eq(schema.users.status, "deleted")));
  if (!tombstone || tombstone.id === userId) return;
  await db.batch([
    db
      .insert(schema.blocks)
      .select(
        db
          .select({ blockerId: schema.blocks.blockerId, blockedId: sql<string>`${userId}`.as("blocked_id"), createdAt: schema.blocks.createdAt })
          .from(schema.blocks)
          .where(and(eq(schema.blocks.blockedId, tombstone.id), ne(schema.blocks.blockerId, userId))),
      )
      .onConflictDoNothing(),
    db.delete(schema.blocks).where(eq(schema.blocks.blockedId, tombstone.id)),
    db.update(schema.users).set({ email: deletedEmail(tombstone.id) }).where(eq(schema.users.id, tombstone.id)),
  ]);
}
