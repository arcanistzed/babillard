import type { BlockPair } from "@babillard/shared";
import { and, eq, inArray, or } from "drizzle-orm";
import { schema, type Db } from "../db";

/** Everyone with a block in either direction with this user. */
export async function blockedWith(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(schema.blocks)
    .where(or(eq(schema.blocks.blockerId, userId), eq(schema.blocks.blockedId, userId)));
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
