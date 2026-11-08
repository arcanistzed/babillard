import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { adminOrigin } from "./config";
import { sendEmail } from "./email";
import { newId } from "./tokens";

export const REASON_LABELS: Record<string, string> = {
  harassment: "Harassment",
  spam: "Spam",
  fake_profile: "Fake profile",
  underage: "May be under 18",
  intimate_images: "Intimate images shared without consent",
  safety: "Feels unsafe",
  other: "Something else",
};

const URGENT_REASONS = new Set(["underage", "intimate_images", "safety"]);

export function isUrgentReason(reason: string): boolean {
  return URGENT_REASONS.has(reason);
}

/**
 * Tells the admin a report arrived. It leaves out names and the reporter's note,
 * so private details stay behind the admin sign-in. Never fails the report itself.
 */
export async function notifyAdminOfReport(env: Env, reason: string): Promise<void> {
  const label = REASON_LABELS[reason] ?? reason;
  const link = `${adminOrigin(env)}/admin/reports`;
  try {
    if (!env.ADMIN_EMAIL) throw new Error("ADMIN_EMAIL is not set");
    await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: `${isUrgentReason(reason) ? "[Urgent] " : ""}New Ideas Match report: ${label}`,
      text: `A new report needs review.\n\nReason: ${label}\n\n${link}`,
      html: `<p>A new report needs review.</p><p>Reason: <strong>${label}</strong></p><p><a href="${link}">Open reports</a></p>`,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "report_alert_failed", error: String(error) }));
  }
}

/** Throws if the email can't be sent, so a report is never closed as "warned" when nobody was told. */
export async function sendConductWarning(env: Env, email: string, language: "en" | "fr" = "en"): Promise<void> {
  const french = language === "fr";
  const text = french
    ? "Quelqu'un a signalé un échange récent avec vous sur Ideas Match. Merci de garder vos conversations respectueuses. Si cela se reproduit, votre compte pourrait être fermé."
    : "Someone reported a recent interaction with you on Ideas Match. Please keep conversations respectful. If this happens again, your account may be closed.";
  await sendEmail(env, { to: email, subject: french ? "Un mot sur votre comportement sur Ideas Match" : "A note about your conduct on Ideas Match", text, html: `<p>${text}</p>` });
}

/** Ends every session and removes push tokens. Their profile and memberships stay, so a ban can be undone. */
export async function banUser(env: Env, db: Db, userId: string): Promise<void> {
  const memberships = await db
    .select({ id: schema.conversationMembers.conversationId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.userId, userId));
  await db.batch([
    db.update(schema.users).set({ status: "banned" }).where(eq(schema.users.id, userId)),
    db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)),
    db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, userId)),
  ]);
  await Promise.all(memberships.map((row) => env.CHAT_ROOM.getByName(row.id).kick(userId)));
}


export async function logModeration(db: Db, actor: string, action: string, targetType: "report" | "user" | "topic" | "takeaway", targetId: string, detail = ""): Promise<void> {
  await db.insert(schema.moderationLog).values({ id: newId(), actor, action, targetType, targetId, detail, createdAt: Date.now() });
}
