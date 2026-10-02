import type { RaceStatus } from "@dnd/shared";

const ACTIVE: RaceStatus[] = ["DRAFTING", "LOCKED", "LIVE"];
const STALE_LIVE_MS = 24 * 60 * 60 * 1000;

/** A LIVE race more than 24 hours past its start: the commissioner probably forgot to complete it. */
export function isStaleLive(race: { status: RaceStatus; raceDate: Date }, now: Date): boolean {
  return race.status === "LIVE" && now.getTime() - race.raceDate.getTime() > STALE_LIVE_MS;
}

/**
 * The race in focus for the dashboard (SPEC Section 9, GET /races/current):
 * the DRAFTING/LOCKED/LIVE race with the earliest raceDate, skipping stale LIVE races when another
 * active race exists; else the next UPCOMING race; else the most recent COMPLETED one.
 * CORRECTING races are never current.
 */
export function pickCurrentRace<R extends { status: RaceStatus; raceDate: Date }>(races: R[], now: Date): R | null {
  const byDate = [...races].sort((a, b) => a.raceDate.getTime() - b.raceDate.getTime());

  const active = byDate.filter((r) => ACTIVE.includes(r.status));
  const fresh = active.find((r) => !isStaleLive(r, now));
  if (fresh) return fresh;
  if (active[0]) return active[0];

  const upcoming = byDate.find((r) => r.status === "UPCOMING" && r.raceDate > now);
  if (upcoming) return upcoming;

  return byDate.filter((r) => r.status === "COMPLETED").at(-1) ?? null;
}
