import { DurableObject } from "cloudflare:workers";
import { sendMessageSchema, type ChatMessage, type ServerSocketEvent } from "@ideas-match/shared";
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { newId } from "../lib/tokens";
import { sendPush } from "../lib/push";

interface SocketAttachment {
  userId: string;
  conversationId: string;
}

interface MessageRow extends Record<string, SqlStorageValue> {
  seq: number;
  id: string;
  sender_id: string | null;
  body: string;
  kind: string;
  meetup_id: string | null;
  created_at: number;
  client_id: string | null;
}

export class SendRejected extends Error {}

const PREVIEW_LENGTH = 120;
const HISTORY_LIMIT = 50;

function toMessage(row: MessageRow): ChatMessage {
  return {
    seq: row.seq,
    id: row.id,
    senderId: row.sender_id,
    body: row.body,
    kind: row.kind as ChatMessage["kind"],
    meetupId: row.meetup_id,
    createdAt: row.created_at,
    ...(row.client_id ? { clientId: row.client_id } : {}),
  };
}

/** One per conversation. Owns the message log and the live sockets. D1 only keeps what the inbox list needs. */
export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          sender_id TEXT,
          body TEXT NOT NULL,
          kind TEXT NOT NULL,
          meetup_id TEXT,
          created_at INTEGER NOT NULL,
          client_id TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS messages_client_idx ON messages (sender_id, client_id) WHERE client_id IS NOT NULL;
      `);
    });
  }

  /** The Worker has already authenticated the user and checked membership. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const userId = request.headers.get("x-user-id");
    const conversationId = request.headers.get("x-conversation-id");
    if (!userId || !conversationId) return new Response("Missing identity", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, conversationId } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const { userId, conversationId } = socket.deserializeAttachment() as SocketAttachment;
    try {
      const payload: unknown = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      const parsed = sendMessageSchema.safeParse(payload);
      if (!parsed.success) throw new SendRejected("Invalid message");
      await this.postUserMessage(conversationId, userId, parsed.data.body, parsed.data.clientId);
    } catch (error) {
      const message = error instanceof SendRejected ? error.message : "Could not send";
      if (!(error instanceof SendRejected)) console.error(JSON.stringify({ event: "chat_send_error", error: String(error) }));
      socket.send(JSON.stringify({ type: "error", error: message } satisfies ServerSocketEvent));
    }
  }

  override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  async postUserMessage(conversationId: string, senderId: string, body: string, clientId?: string): Promise<ChatMessage> {
    if (clientId) {
      const existing = this.ctx.storage.sql
        .exec<MessageRow>("SELECT * FROM messages WHERE sender_id = ? AND client_id = ?", senderId, clientId)
        .toArray()[0];
      if (existing) return toMessage(existing);
    }

    const db = getDb(this.env);
    const [members, matchRows] = await Promise.all([
      db
        .select({ userId: schema.conversationMembers.userId, muted: schema.conversationMembers.muted, status: schema.users.status })
        .from(schema.conversationMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.conversationMembers.userId))
        .where(eq(schema.conversationMembers.conversationId, conversationId)),
      db.select({ state: schema.matches.state }).from(schema.matches).where(eq(schema.matches.conversationId, conversationId)),
    ]);

    const sender = members.find((member) => member.userId === senderId);
    if (!sender || sender.status !== "active") throw new SendRejected("You are not in this conversation");
    if (matchRows[0] && matchRows[0].state !== "active") throw new SendRejected("This conversation is closed");

    const otherIds = members.filter((member) => member.userId !== senderId).map((member) => member.userId);
    const blockers = otherIds.length
      ? await db
          .select({ id: schema.blocks.blockerId })
          .from(schema.blocks)
          .where(and(eq(schema.blocks.blockedId, senderId), inArray(schema.blocks.blockerId, otherIds)))
      : [];
    const blockerIds = blockers.map((row) => row.id);

    const message = this.insert({ senderId, body, kind: "text", meetupId: null, clientId: clientId ?? null });
    this.broadcast({ type: "message", message }, new Set(blockerIds));

    const now = message.createdAt;
    await db.batch([
      db
        .update(schema.conversations)
        .set({
          lastMessagePreview: body.slice(0, PREVIEW_LENGTH),
          lastMessageSenderId: senderId,
          lastMessageAt: now,
          lastUserMessageAt: now,
        })
        .where(eq(schema.conversations.id, conversationId)),
      db
        .update(schema.conversationMembers)
        .set({ unreadCount: sql`${schema.conversationMembers.unreadCount} + 1` })
        .where(
          and(
            eq(schema.conversationMembers.conversationId, conversationId),
            ne(schema.conversationMembers.userId, senderId),
            blockerIds.length ? notInArray(schema.conversationMembers.userId, blockerIds) : undefined,
          ),
        ),
    ]);

    const connected = this.connectedUserIds();
    const recipients = members
      .filter((member) => member.userId !== senderId && !member.muted && !blockerIds.includes(member.userId) && !connected.has(member.userId))
      .map((member) => member.userId);
    if (recipients.length) {
      const [profile] = await db
        .select({ name: schema.profiles.displayName })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, senderId));
      this.ctx.waitUntil(
        sendPush(this.env, recipients, {
          title: profile?.name ?? "New message",
          body: body.slice(0, PREVIEW_LENGTH),
          data: { screen: "chat", id: conversationId },
        }),
      );
    }
    return message;
  }

  /** RPC entry point. Custom error classes do not survive RPC, so rejections come back as data. */
  async trySend(conversationId: string, senderId: string, body: string, clientId?: string): Promise<{ ok: true; message: ChatMessage } | { ok: false; error: string }> {
    try {
      return { ok: true, message: await this.postUserMessage(conversationId, senderId, body, clientId) };
    } catch (error) {
      if (error instanceof SendRejected) return { ok: false, error: error.message };
      throw error;
    }
  }

  /** System and meetup messages. The caller decides who gets a push. */
  async postSystem(conversationId: string, body: string, options: { kind?: "system" | "meetup"; meetupId?: string } = {}): Promise<ChatMessage> {
    const message = this.insert({ senderId: null, body, kind: options.kind ?? "system", meetupId: options.meetupId ?? null, clientId: null });
    this.broadcast({ type: "message", message });
    const db = getDb(this.env);
    await db
      .update(schema.conversations)
      .set({ lastMessagePreview: body.slice(0, PREVIEW_LENGTH), lastMessageSenderId: null, lastMessageAt: message.createdAt })
      .where(eq(schema.conversations.id, conversationId));
    return message;
  }

  history(before?: number, limit = HISTORY_LIMIT): ChatMessage[] {
    const size = Math.min(Math.max(limit, 1), HISTORY_LIMIT);
    const cursor = this.ctx.storage.sql.exec<MessageRow>(
      "SELECT * FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?",
      before ?? Number.MAX_SAFE_INTEGER,
      size,
    );
    return cursor.toArray().map(toMessage).reverse();
  }

  getMessage(id: string): ChatMessage | null {
    const row = this.ctx.storage.sql.exec<MessageRow>("SELECT * FROM messages WHERE id = ?", id).toArray()[0];
    return row ? toMessage(row) : null;
  }

  /** Tells open sockets that a meetup changed, so clients refetch it. */
  notifyMeetupChanged(meetupId: string): void {
    this.broadcast({ type: "meetup", meetup: { id: meetupId } });
  }

  /** Closes a user's sockets after they leave, block, or get banned. */
  kick(userId: string): void {
    for (const socket of this.ctx.getWebSockets(userId)) {
      try {
        socket.close(4001, "Removed from conversation");
      } catch {
        // Already closed.
      }
    }
  }

  /** Permanently removes one user's messages when they delete their account. */
  eraseUser(userId: string): void {
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE sender_id = ?", userId);
    this.kick(userId);
  }

  private insert(input: { senderId: string | null; body: string; kind: ChatMessage["kind"]; meetupId: string | null; clientId: string | null }): ChatMessage {
    const row = this.ctx.storage.sql
      .exec<MessageRow>(
        "INSERT INTO messages (id, sender_id, body, kind, meetup_id, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
        newId(),
        input.senderId,
        input.body,
        input.kind,
        input.meetupId,
        Date.now(),
        input.clientId,
      )
      .one();
    return toMessage(row);
  }

  private broadcast(event: ServerSocketEvent, except: Set<string> = new Set()): void {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      const { userId } = socket.deserializeAttachment() as SocketAttachment;
      if (except.has(userId)) continue;
      try {
        socket.send(payload);
      } catch {
        // The socket is on its way out. webSocketClose handles it.
      }
    }
  }

  private connectedUserIds(): Set<string> {
    return new Set(this.ctx.getWebSockets().map((socket) => (socket.deserializeAttachment() as SocketAttachment).userId));
  }
}
