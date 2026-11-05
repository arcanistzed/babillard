import type { PushData } from "@ideas-match/shared";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";

export interface PushMessage {
  title: string;
  body: string;
  data: PushData;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

/** Failures here never fail the action that caused the push. */
export async function sendPush(env: Env, userIds: string[], message: PushMessage): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const db = getDb(env);
    const rows = await db.select().from(schema.pushTokens).where(inArray(schema.pushTokens.userId, userIds));

    if (env.PUSH_MODE === "log") {
      console.log(JSON.stringify({ event: "push", userIds, title: message.title, body: message.body, data: message.data }));
      return;
    }

    for (let i = 0; i < rows.length; i += EXPO_BATCH_SIZE) {
      const batch = rows.slice(i, i + EXPO_BATCH_SIZE);
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(batch.map((row) => ({ to: row.token, sound: "default", ...message }))),
      });
      if (!response.ok) {
        console.error(JSON.stringify({ event: "push_failed", status: response.status }));
        continue;
      }
      const { data: tickets } = (await response.json()) as { data: ExpoTicket[] };
      await Promise.all(
        tickets.map(async (ticket, index) => {
          const row = batch[index];
          if (row && ticket.details?.error === "DeviceNotRegistered") {
            await db.delete(schema.pushTokens).where(eq(schema.pushTokens.token, row.token));
          }
        }),
      );
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "push_error", error: String(error) }));
  }
}
