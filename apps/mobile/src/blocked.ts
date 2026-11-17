import { useQuery } from "@tanstack/react-query";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useMemo } from "react";
import { api } from "./api";

export type BlockedPerson = { id: string; displayName: string };

/** The block list, under the key the Blocked screen also uses, so blocking or unblocking anywhere refreshes it. */
export const blockedQuery = { queryKey: ["blocked"], queryFn: () => api.get<BlockedPerson[]>("/safety/blocks") };

const storageKey = (userId: string) => `babillard.blocked.${userId}`;

function saved(userId: string): string[] | null {
  try {
    const raw = Storage.getItemSync(storageKey(userId));
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Who this user has blocked, for hiding their MLS messages on this phone. The
 * last list the server gave is kept on the phone, so the hiding still works
 * offline. Null only until the phone has learned the list at least once.
 */
export function useBlockedIds(userId: string | undefined): ReadonlySet<string> | null {
  const stored = useMemo(() => (userId ? saved(userId) : null), [userId]);
  const query = useQuery({ ...blockedQuery, enabled: userId !== undefined });
  const fresh = query.data;
  useEffect(() => {
    if (!userId || !fresh) return;
    try {
      Storage.setItemSync(storageKey(userId), JSON.stringify(fresh.map((person) => person.id)));
    } catch {
      // The list still applies for this session. Only the offline copy is out of date.
    }
  }, [fresh, userId]);
  return useMemo(() => {
    const ids = fresh?.map((person) => person.id) ?? stored;
    return ids ? new Set(ids) : null;
  }, [fresh, stored]);
}

/** Forgets the saved list, with the rest of this user's data on this phone. */
export function forgetBlockedIds(userId: string): void {
  try {
    Storage.removeItemSync(storageKey(userId));
  } catch {
    // Nothing saved.
  }
}
