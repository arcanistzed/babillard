import type { Me } from "@ideas-match/shared";
import { useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setSessionToken, setUnauthorizedHandler } from "./api";
import { deleteDeviceKey, ensureDeviceKey, forgetLoadedKey } from "./e2ee";
import { registerForPush, unregisterPush } from "./push";

const TOKEN_KEY = "ideas-match.session";

interface AuthState {
  ready: boolean;
  me: Me | null;
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
  const queryClient = useQueryClient();

  const forgetSession = useCallback(async () => {
    setSessionToken(null);
    setMe(null);
    queryClient.clear();
    forgetLoadedKey();
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(() => void forgetSession());
    return () => setUnauthorizedHandler(null);
  }, [forgetSession]);

  useEffect(() => {
    void (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        setSessionToken(token);
        // A failure here is usually a bad connection. A dead session clears itself through the 401 handler.
        await api
          .get<Me>("/me")
          .then(setMe)
          .catch(() => undefined);
      }
      setReady(true);
    })();
  }, []);

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
      setMe,
      forgetSession,
      forgetDevice: async () => {
        if (me) await deleteDeviceKey(me.id);
      },
      completeSignIn: async (token, nextMe) => {
        setSessionToken(token);
        await SecureStore.setItemAsync(TOKEN_KEY, token);
        setMe(nextMe);
      },
      refresh: async () => setMe(await api.get<Me>("/me")),
      signOut: async () => {
        await unregisterPush();
        await api.post("/auth/logout").catch(() => undefined);
        await forgetSession();
      },
    }),
    [ready, me, forgetSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth needs AuthProvider");
  return value;
}
