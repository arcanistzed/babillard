import type { ChatMessage, ConversationDetail, ServerSocketEvent } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, openConversationSocket } from "./api";
import { ensureDeviceKey, readingKeys, readMessage, sealFor, type ReadableMessage } from "./e2ee";

export interface LocalMessage extends ReadableMessage {
  pending?: boolean;
  failed?: boolean;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const REMOVED_CLOSE_CODE = 4001;
/** If the server hasn't echoed a message by now, send it over HTTP. The clientId stops it being stored twice. */
const ECHO_TIMEOUT_MS = 5000;

function merge(existing: LocalMessage[], incoming: LocalMessage[]): LocalMessage[] {
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

export function useChat(conversationId: string, myId: string | undefined, onRemoved: () => void) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const socket = useRef<WebSocket | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const unsent = useRef(new Map<string, string>());
  const sendOverHttpRef = useRef<((body: string, clientId: string) => Promise<void>) | null>(null);

  const members = useCallback(
    async (fresh = false) => {
      const detail = await queryClient.fetchQuery({
        queryKey: ["conversation", conversationId],
        queryFn: () => api.get<ConversationDetail>(`/conversations/${conversationId}`),
        staleTime: fresh ? 0 : 60_000,
      });
      return detail.members;
    },
    [conversationId, queryClient],
  );

  const read = useCallback(
    async (incoming: ChatMessage[]): Promise<LocalMessage[]> => {
      if (!myId || !incoming.some((message) => message.envelope)) return incoming;
      const keys = await readingKeys(myId);
      const roster = await members();
      const opened = incoming.map((message) => readMessage(message, conversationId, keys, roster));
      // Someone may have signed in on a new phone since this list was fetched.
      if (!opened.some((message) => message.unreadable && keys.some((key) => message.envelope?.keys[key.publicKey]))) return opened;
      const latest = await members(true);
      return incoming.map((message) => readMessage(message, conversationId, keys, latest));
    },
    [conversationId, members, myId],
  );

  const markRead = useCallback(() => {
    void api
      .post(`/conversations/${conversationId}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["inbox"] }))
      .catch(() => undefined);
  }, [conversationId, queryClient]);

  const refresh = useCallback(async () => {
    const history = await read(await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages`));
    setMessages((current) => merge(current, history));
    setLoaded(true);
    markRead();
  }, [conversationId, markRead, read]);

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
          if (data.message.clientId) unsent.current.delete(data.message.clientId);
          void read([data.message]).then((opened) => setMessages((current) => merge(current, opened)));
          markRead();
          if (data.message.kind === "meetup") void queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
        } else if (data.type === "meetup") {
          void queryClient.invalidateQueries({ queryKey: ["meetup", data.meetup.id] });
          void queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
        } else if (data.type === "error" && data.clientId) {
          // Someone joined or got a new phone. HTTP re-encrypts with the latest list straight away.
          const body = unsent.current.get(data.clientId);
          const timer = timers.current.get(data.clientId);
          if (body !== undefined && timer) {
            clearTimeout(timer);
            timers.current.delete(data.clientId);
            void sendOverHttpRef.current?.(body, data.clientId);
          }
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

    // This only sets state after the fetch finishes, which the rule can't see through the callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [conversationId, queryClient, read, refresh, markRead]);

  const seal = useCallback(
    async (body: string, senderId: string, fresh = false) => {
      const me = await ensureDeviceKey(senderId);
      return sealFor(body, conversationId, senderId, me, await members(fresh));
    },
    [conversationId, members],
  );

  const sendOverHttp = useCallback(
    async (body: string, clientId: string) => {
      if (!myId) return;
      const post = async (fresh: boolean) => {
        const message = await api.post<ChatMessage>(`/conversations/${conversationId}/messages`, { envelope: await seal(body, myId, fresh), clientId });
        unsent.current.delete(clientId);
        const opened = await read([message]);
        setMessages((current) => merge(current, opened));
      };
      try {
        try {
          await post(true);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 409)) throw error;
          await post(true);
        }
      } catch {
        setMessages((current) => current.map((message) => (message.clientId === clientId && message.pending ? { ...message, failed: true } : message)));
      }
    },
    [conversationId, myId, read, seal],
  );
  useEffect(() => {
    sendOverHttpRef.current = sendOverHttp;
  }, [sendOverHttp]);

  const send = useCallback(
    (body: string, senderId: string, reuseClientId?: string) => {
      const clientId = reuseClientId ?? newClientId();
      const optimistic: LocalMessage = { seq: Number.MAX_SAFE_INTEGER, id: `local-${clientId}`, senderId, body, kind: "text", meetupId: null, createdAt: Date.now(), clientId, pending: true };
      setMessages((current) => [...current.filter((message) => message.clientId !== clientId), optimistic]);
      unsent.current.set(clientId, body);

      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        void seal(body, senderId)
          .then((envelope) => {
            ws.send(JSON.stringify({ type: "send", envelope, clientId }));
            timers.current.set(clientId, setTimeout(() => void sendOverHttp(body, clientId), ECHO_TIMEOUT_MS));
          })
          .catch(() => void sendOverHttp(body, clientId));
      } else {
        void sendOverHttp(body, clientId);
      }
    },
    [seal, sendOverHttp],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => !message.pending);
    if (!oldest || !hasMore) return;
    const older = await read(await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages?before=${oldest.seq}`));
    if (older.length === 0) setHasMore(false);
    setMessages((current) => merge(current, older));
  }, [conversationId, hasMore, messages, read]);

  return { messages, loaded, connected, send, loadOlder };
}
