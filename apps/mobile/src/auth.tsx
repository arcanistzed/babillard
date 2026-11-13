import type { Me } from "@babillard/shared";
import { useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api, ApiError, setSessionToken, setUnauthorizedHandler } from "./api";
import { deleteDeviceKey, ensureDeviceKey, forgetLoadedKey } from "./e2ee";
import { registerForPush, unregisterPush } from "./push";

const TOKEN_KEY = "babillard.session";
const RETRY_MS = 5_000;

interface AuthState {
  ready: boolean;
  me: Me | null;
  /** A saved session that couldn't be checked yet, usually for lack of a connection. The person is still signed in. */
  unreachable: boolean;
  retry: () => Promise<void>;
  completeSignIn: (token: string, me: Me) => Promise<void>;
  setMe: (me: Me) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  forgetSession: () => Promise<void>;
  forgetDevice: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const queryClient = useQueryClient();

  const forgetSession = useCallback(async () => {
    setSessionToken(null);
    setMe(null);
    setUnreachable(false);
    queryClient.clear();
    forgetLoadedKey();
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(() => void forgetSession());
    return () => setUnauthorizedHandler(null);
  }, [forgetSession]);

  /**
   * Only the server saying the session is dead (a 401, which clears it through the handler above) signs
   * someone out. Any other failure keeps the session and leaves them on the "can't reach" screen.
   */
  const checkSession = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/me"));
      setUnreachable(false);
    } catch (error) {
      setUnreachable(!(error instanceof ApiError && error.status === 401));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      if (token) {
        setSessionToken(token);
        await checkSession();
      }
      setReady(true);
    })();
  }, [checkSession]);

  // Keeps trying while the session can't be checked, and right away when the app comes back to the front.
  useEffect(() => {
    if (!unreachable) return;
    const timer = setInterval(() => void checkSession(), RETRY_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkSession();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [unreachable, checkSession]);

  useEffect(() => {
    if (me?.onboarded) void registerForPush();
  }, [me?.onboarded]);

  // Registered early, so people can write to this phone before it has opened a chat.
  useEffect(() => {
    if (me?.id) void ensureDeviceKey(me.id).catch(() => undefined);
  }, [me?.id]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      me,
      unreachable,
      retry: checkSession,
      setMe,
      forgetSession,
      forgetDevice: async () => {
        if (me) await deleteDeviceKey(me.id);
      },
      completeSignIn: async (token, nextMe) => {
        setSessionToken(token);
        await SecureStore.setItemAsync(TOKEN_KEY, token);
        setUnreachable(false);
        setMe(nextMe);
      },
      refresh: async () => setMe(await api.get<Me>("/me")),
      signOut: async () => {
        await unregisterPush();
        await api.post("/auth/logout").catch(() => undefined);
        await forgetSession();
      },
    }),
    [ready, me, unreachable, checkSession, forgetSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth needs AuthProvider");
  return value;
}
