import { MlsDowngradeError, MlsRemovedError, isOutOfChat, sendPath, showsSender, type ChatMessage, type ConversationDetail, type MlsStoredMessage, type ServerSocketEvent } from "@babillard/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, ApiError, openConversationSocket } from "./api";
import { useBlockedIds } from "./blocked";
import { forgetMlsChat } from "./leaving";
import { ensureDeviceKey, readingKeys, readMessage, sealFor, type ReadableMessage } from "./e2ee";
import { holdsMlsGroupHere, mlsMessenger, type MlsUser } from "./mls";

export interface LocalMessage extends ReadableMessage {
  pending?: boolean;
  failed?: boolean;
  /** An MLS message whose franking didn't check out, so a report couldn't prove it. */
  unverified?: boolean;
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
  // By server time: v1 and MLS messages come from two logs whose seq numbers aren't comparable.
  return [...byId.values()].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.createdAt - b.createdAt || a.seq - b.seq);
}

const MLS_PREFIX = "mls-";

/** A message from the MLS store, shaped like the rest of the timeline. */
function fromMls(message: MlsStoredMessage): LocalMessage {
  return {
    seq: message.seq ?? Number.MAX_SAFE_INTEGER,
    id: `${MLS_PREFIX}${message.id}`,
    senderId: message.senderId,
    body: message.text,
    kind: "text",
    meetupId: null,
    createdAt: message.createdAt,
    ...(message.status === "sent" ? {} : { pending: true }),
    ...(message.status === "failed" ? { failed: true } : {}),
    ...(message.unverified ? { unverified: true } : {}),
  };
}

function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useChat(conversationId: string, me: MlsUser | null | undefined, onRemoved: () => void) {
  const myId = me?.id;
  const mlsOn = me?.mls === true;
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const socket = useRef<WebSocket | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const unsent = useRef(new Map<string, string>());
  const sendOverHttpRef = useRef<((body: string, clientId: string) => Promise<void>) | null>(null);
  const onRemovedRef = useRef(onRemoved);
  useEffect(() => {
    onRemovedRef.current = onRemoved;
  }, [onRemoved]);
  /** The person is out of this chat: forget this phone's MLS copy of it, then let the screen close. */
  const removedRef = useRef(() => {});
  useEffect(() => {
    removedRef.current = () => {
      if (myId) void forgetMlsChat({ id: myId, mls: mlsOn }, conversationId).catch((error) => console.warn("Couldn't forget the MLS chat", error));
      onRemovedRef.current();
    };
  }, [conversationId, myId, mlsOn]);

  // MLS, when the server has it on. Null otherwise, and then nothing below changes how v1 works.
  const mls = useMemo(() => (myId ? mlsMessenger({ id: myId, mls: mlsOn }) : null), [myId, mlsOn]);
  /** True once this phone is in the chat's MLS group. From then on it sends with MLS. */
  const [mlsActive, setMlsActive] = useState(false);
  /**
   * The downgrade guard tripped: this phone holds the chat's MLS group, but MLS is off here, so the
   * chat can't send. v1 would be readable by the group but has no forward secrecy.
   */
  const [heldWhileOff, setHeldWhileOff] = useState(false);
  const mlsOnlyButOff = !mls && heldWhileOff;
  const blocked = useBlockedIds(myId);

  // With MLS off, say at once if this chat can't send from here, rather than after a message fails.
  useEffect(() => {
    if (!myId || mls) return;
    let stale = false;
    void holdsMlsGroupHere(myId, conversationId).then((held) => {
      if (!stale) setHeldWhileOff(held);
    });
    return () => {
      stale = true;
    };
  }, [conversationId, mls, myId]);

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

  /** Brings the chat's MLS group up to date and puts what the store holds into the timeline. */
  const syncMls = useCallback(async () => {
    if (!mls) return;
    const messenger = await mls;
    let failure: unknown = await messenger.sync(conversationId).then(
      () => null,
      (error: unknown) => error,
    );
    // The log removed this phone, and the engine dropped its copy of the group. If the person is
    // still in the chat, syncing again joins it again. If not, the server says so.
    if (failure instanceof MlsRemovedError) {
      failure = await messenger.sync(conversationId).then(
        () => null,
        (error: unknown) => error,
      );
    }
    if (isOutOfChat(failure)) {
      removedRef.current();
      return;
    }
    // Anything else leaves what's stored on screen. The next socket event or visit tries again.
    if (failure) console.warn("MLS sync failed", failure);
    const stored = (await messenger.messages(conversationId)).map(fromMls);
    setMlsActive(await messenger.inGroup(conversationId));
    setMessages((current) => merge(current.filter((message) => !message.id.startsWith(MLS_PREFIX)), stored));
  }, [conversationId, mls]);

  const refresh = useCallback(async () => {
    const history = await read(await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages`));
    setMessages((current) => merge(current, history));
    await syncMls().catch(() => undefined);
    setLoaded(true);
    markRead();
  }, [conversationId, markRead, read, syncMls]);

  useEffect(() => {
    let closed = false;
    // The server pushes only to people without an open socket, so a socket left open
    // in the background would swallow notifications. Close it there and reopen on return.
    let paused = AppState.currentState === "background";
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
        } else if (data.type === "mls") {
          void syncMls()
            .then(markRead)
            .catch(() => undefined);
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
        if (closed || paused) return;
        if (event.code === REMOVED_CLOSE_CODE) {
          removedRef.current();
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
        removedRef.current();
      }
    });
    if (!paused) connect();
    const appState = AppState.addEventListener("change", (state) => {
      if (closed) return;
      if (state === "background" && !paused) {
        paused = true;
        if (retry) clearTimeout(retry);
        socket.current?.close();
      } else if (state === "active" && paused) {
        paused = false;
        attempt = 0;
        connect();
      }
    });

    const pendingTimers = timers.current;
    return () => {
      closed = true;
      appState.remove();
      if (retry) clearTimeout(retry);
      socket.current?.close();
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
    };
  }, [conversationId, queryClient, read, refresh, markRead, syncMls]);

  /**
   * Every v1 send goes through here: the socket, the HTTP fallback, and retries. So this is where the
   * downgrade guard holds. It asks the phone's own store each time, not `me.mls` or `mlsActive`,
   * which a server can set or which may not have caught up yet.
   */
  const seal = useCallback(
    async (body: string, senderId: string, fresh = false) => {
      if (await holdsMlsGroupHere(senderId, conversationId)) throw new MlsDowngradeError(conversationId);
      const me = await ensureDeviceKey(senderId);
      return sealFor(body, conversationId, senderId, me, await members(fresh));
    },
    [conversationId, members],
  );

  const markFailed = useCallback((clientId: string) => {
    setMessages((current) => current.map((message) => (message.clientId === clientId && message.pending ? { ...message, failed: true } : message)));
  }, []);

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
      } catch (error) {
        if (error instanceof MlsDowngradeError) {
          unsent.current.delete(clientId);
          setHeldWhileOff(true);
        }
        markFailed(clientId);
      }
    },
    [conversationId, markFailed, myId, read, seal],
  );
  useEffect(() => {
    sendOverHttpRef.current = sendOverHttp;
  }, [sendOverHttp]);

  const send = useCallback(
    (body: string, senderId: string, reuseClientId?: string) => {
      const clientId = reuseClientId ?? newClientId();
      const optimistic: LocalMessage = { seq: Number.MAX_SAFE_INTEGER, id: `local-${clientId}`, senderId, body, kind: "text", meetupId: null, createdAt: Date.now(), clientId, pending: true };
      setMessages((current) => [...current.filter((message) => message.clientId !== clientId), optimistic]);

      const withMls = (messenger: NonNullable<typeof mls>) => {
        // The engine syncs, encrypts, saves, and sends. Its store then holds the sent copy.
        void messenger
          .then((engine) => engine.send(conversationId, body))
          .then(async () => {
            setMessages((current) => current.filter((message) => message.clientId !== clientId));
            await syncMls();
          })
          .catch(() => setMessages((current) => current.map((message) => (message.clientId === clientId ? { ...message, failed: true } : message))));
      };
      if (mls && mlsActive) return withMls(mls);

      const withV1 = () => {
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
      };

      // Not yet known to be in the group: the first sync may still be running, or MLS is off here.
      // The phone's own store decides, so a chat this phone moved to MLS never gets v1 from it.
      void holdsMlsGroupHere(senderId, conversationId).then((held) => {
        const path = sendPath(mls !== null, held);
        if (path === "mls" && mls) withMls(mls);
        else if (path === "v1") withV1();
        else {
          setHeldWhileOff(true);
          markFailed(clientId);
        }
      });
    },
    [conversationId, markFailed, mls, mlsActive, seal, sendOverHttp, syncMls],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => !message.pending);
    if (!oldest || !hasMore) return;
    const older = await read(await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages?before=${oldest.seq}`));
    if (older.length === 0) setHasMore(false);
    setMessages((current) => merge(current, older));
  }, [conversationId, hasMore, messages, read]);

  // The server can't drop a blocked person's MLS messages, so they're hidden here, when shown.
  // Everything stays in the store, so unblocking brings them back, as it does for v1.
  const shown = useMemo(
    () =>
      myId
        ? messages.filter((message) =>
            message.id.startsWith(MLS_PREFIX) ? showsSender(message.senderId, myId, blocked) : message.senderId === null || !blocked?.has(message.senderId),
          )
        : messages,
    [blocked, messages, myId],
  );

  return { messages: shown, loaded, connected, send, loadOlder, mlsActive, mlsOnlyButOff };
}
