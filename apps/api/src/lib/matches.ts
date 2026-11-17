import { and, eq, lte, or, sql } from "drizzle-orm";
import { schema, type Db } from "../db";

const RELEASE_BATCH = 200;

/**
 * Lets two people whose match expired in silence find each other in People again, by clearing the swipes that
 * made the match. Both have to swipe right again to match, so neither is matched on an old yes.
 * Only swipes from before the match are cleared, so a fresh swipe made after it expired is kept.
 * Covers matches that expired before this existed, too.
 */
export async function releaseExpiredPairs(db: Db): Promise<number> {
  const rows = await db.all<{ user_a: string; user_b: string; created_at: number }>(sql`
    SELECT m.user_a, m.user_b, m.created_at FROM matches m
    WHERE m.state = 'expired' AND EXISTS (
      SELECT 1 FROM people_swipes ps
      WHERE ((ps.from_user = m.user_a AND ps.to_user = m.user_b) OR (ps.from_user = m.user_b AND ps.to_user = m.user_a)) AND ps.created_at <= m.created_at
    )
    LIMIT ${RELEASE_BATCH}`);
  const [first, ...rest] = rows.map((row) => {
    const swipes = schema.peopleSwipes;
    const pair = or(and(eq(swipes.fromUser, row.user_a), eq(swipes.toUser, row.user_b)), and(eq(swipes.fromUser, row.user_b), eq(swipes.toUser, row.user_a)));
    return db.delete(swipes).where(and(pair, lte(swipes.createdAt, row.created_at)));
  });
  if (first) await db.batch([first, ...rest]);
  return rows.length;
}
