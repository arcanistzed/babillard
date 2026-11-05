import type { ChatMessage, ServerSocketEvent } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, openConversationSocket } from "./api";

export interface LocalMessage extends ChatMessage {
  pending?: boolean;
  failed?: boolean;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const REMOVED_CLOSE_CODE = 4001;
/** If the server hasn't echoed a message by now, send it over HTTP. The clientId stops it being stored twice. */
const ECHO_TIMEOUT_MS = 5000;

function merge(existing: LocalMessage[], incoming: ChatMessage[]): LocalMessage[] {
  const byClientId = new Set(incoming.map((message) => message.clientId).filter(Boolean));
  const byId = new Map<string, LocalMessage>();
  for (const message of existing) {
    if (message.pending && message.clientId && byClientId.has(message.clientId)) continue;
    byId.set(message.id, message);
  }
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.seq - b.seq);
}

function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useChat(conversationId: string, onRemoved: () => void) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const socket = useRef<WebSocket | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const markRead = useCallback(() => {
    void api
      .post(`/conversations/${conversationId}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["inbox"] }))
      .catch(() => undefined);
  }, [conversationId, queryClient]);

  const refresh = useCallback(async () => {
    const history = await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages`);
    setMessages((current) => merge(current, history));
    setLoaded(true);
    markRead();
  }, [conversationId, markRead]);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const ws = openConversationSocket(conversationId);
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        // Catches anything sent while this phone was offline.
        void refresh().catch(() => undefined);
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as ServerSocketEvent;
        if (data.type === "message") {
          if (data.message.clientId) {
            const timer = timers.current.get(data.message.clientId);
            if (timer) clearTimeout(timer);
            timers.current.delete(data.message.clientId);
          }
          setMessages((current) => merge(current, [data.message]));
          markRead();
          if (data.message.kind === "meetup") void queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
        } else if (data.type === "meetup") {
          void queryClient.invalidateQueries({ queryKey: ["meetup", data.meetup.id] });
          void queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
        }
      };
      ws.onclose = (event) => {
        setConnected(false);
        if (closed) return;
        if (event.code === REMOVED_CLOSE_CODE) {
          onRemoved();
          return;
        }
        attempt += 1;
        retry = setTimeout(connect, Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS));
      };
    }

    void refresh().catch((error) => {
      setLoaded(true);
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
        closed = true;
        onRemoved();
      }
    });
    connect();

    const pendingTimers = timers.current;
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket.current?.close();
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
    };
    // onRemoved is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, queryClient, refresh, markRead]);

  const sendOverHttp = useCallback(
    async (body: string, clientId: string) => {
      try {
        const message = await api.post<ChatMessage>(`/conversations/${conversationId}/messages`, { body, clientId });
        setMessages((current) => merge(current, [message]));
      } catch {
        setMessages((current) => current.map((message) => (message.clientId === clientId && message.pending ? { ...message, failed: true } : message)));
      }
    },
    [conversationId],
  );

  const send = useCallback(
    (body: string, senderId: string, reuseClientId?: string) => {
      const clientId = reuseClientId ?? newClientId();
      const optimistic: LocalMessage = { seq: Number.MAX_SAFE_INTEGER, id: `local-${clientId}`, senderId, body, kind: "text", meetupId: null, createdAt: Date.now(), clientId, pending: true };
      setMessages((current) => [...current.filter((message) => message.clientId !== clientId), optimistic]);

      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "send", body, clientId }));
        timers.current.set(clientId, setTimeout(() => void sendOverHttp(body, clientId), ECHO_TIMEOUT_MS));
      } else {
        void sendOverHttp(body, clientId);
      }
    },
    [sendOverHttp],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => !message.pending);
    if (!oldest || !hasMore) return;
    const older = await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages?before=${oldest.seq}`);
    if (older.length === 0) setHasMore(false);
    setMessages((current) => merge(current, older));
  }, [conversationId, hasMore, messages]);

  return { messages, loaded, connected, send, loadOlder };
}
