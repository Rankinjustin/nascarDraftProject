/** Every react-query key and the queries more than one screen uses. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const keys = {
  me: ["me"] as const,
  users: ["users"] as const,
  drivers: ["drivers"] as const,
  seasons: ["seasons"] as const,
  races: ["races"] as const,
  currentRace: ["race", "current"] as const,
  race: (raceId: string) => ["race", raceId] as const,
  draft: (raceId: string) => ["draft", raceId] as const,
  live: (raceId: string) => ["live", raceId] as const,
  events: (raceId: string) => ["events", raceId] as const,
  qualifying: (raceId: string) => ["qualifying", raceId] as const,
  /** Prefix: one entry per season. */
  history: ["history"] as const,
  /** Prefix: one entry per season. */
  seasonStats: ["season-stats"] as const,
  pushSubscription: ["push-subscription"] as const,
};

export const useCurrentRace = () => useQuery({ queryKey: keys.currentRace, queryFn: api.currentRace });
export const useSeasons = () => useQuery({ queryKey: keys.seasons, queryFn: api.listSeasons });
export const useRaces = () => useQuery({ queryKey: keys.races, queryFn: () => api.listRaces() });
export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: api.listUsers });

/** Polls every 3s, or 10s while it's your turn — you're the one acting (SPEC Section 6, "Polling"). */
export function useDraft(raceId: string | undefined, meId: string | undefined, poll = true) {
  return useQuery({
    queryKey: keys.draft(raceId ?? ""),
    queryFn: () => api.getDraft(raceId!),
    enabled: Boolean(raceId),
    refetchInterval: (query) => {
      if (!poll) return false;
      const state = query.state.data;
      if (!state) return 3_000;
      if (state.race.status === "UPCOMING" || state.race.status === "DRAFTING") {
        return state.onTheClock?.userId === meId ? 10_000 : 3_000;
      }
      // A finished week only changes if a commissioner reopens it; that refreshes on focus like everything else.
      return state.race.status === "COMPLETED" ? false : 30_000;
    },
  });
}

/** 15s on race day; otherwise the page only changes when qualifying lands or picks are made. */
export function useLive(raceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.live(raceId),
    queryFn: () => api.getLive(raceId),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.race.status;
      return status === "LIVE" ? 15_000 : status === "COMPLETED" ? false : 60_000;
    },
  });
}

/**
 * After any write to a race, refresh every view that shows it. The one rule for race writes: put the server's response
 * in the cache, then call this (refetching that one query again is cheap, and nothing else is left stale).
 */
export function useInvalidateRace(raceId: string) {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of [
      keys.race(raceId),
      keys.races,
      keys.currentRace,
      keys.draft(raceId),
      keys.live(raceId),
      keys.events(raceId),
      keys.qualifying(raceId),
      keys.history,
      keys.seasonStats,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}
