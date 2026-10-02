/**
 * All contact with NASCAR's servers lives here (SPEC Section 7, "Adapter isolation"). Nothing else in the
 * codebase knows the feed's shape; everything downstream uses the normalized types below.
 *
 * What's verified (2026-10-02, against the idle live feed and cacher samples in server/test/fixtures):
 *   live feed top level: race_id, series_id, run_type (3 = race), flag_state, lap_number, laps_in_race, vehicles
 *   cacher weekend-feed: weekend_race[].race_id and results[] with driver_id, driver_fullname, car_number, team_name
 *   cacher weekend_runs[].run_type 2 = qualifying
 *
 * UNVERIFIED: every field read off a live-feed vehicle (see readVehicle), the practice/qualifying run_type values on
 * the live feed, and which flag_state means checkered. No session has been captured yet — run the capture script
 * (npm run capture:feed -w server) during a race weekend and check these against what it saves.
 */
import { env } from "../env";

export interface NormalizedVehicle {
  nascarDriverId: number;
  driverName: string;
  carNumber: string;
  runningPosition: number;
  lapsCompleted: number;
  status: "RUNNING" | "OUT" | "FINISHED";
  delta: number | null;
  bestLapTime: number | null; // seconds; used for qualifying capture
  bestLapSpeed: number | null; // mph
}

export type SessionType = "practice" | "qualifying" | "race" | "unknown";

export interface NormalizedRaceFeed {
  nascarRaceId: number | null;
  seriesId: number | null;
  sessionType: SessionType;
  currentLap: number | null;
  totalLaps: number | null;
  flagState: number | null;
  vehicles: NormalizedVehicle[];
  fetchedAt: Date;
}

export interface FeedEntry {
  nascarDriverId: number;
  driverName: string;
  carNumber: string;
  teamName: string | null;
}

export class FeedShapeError extends Error {}

// run_type 3 = race is verified on the live feed; 1 and 2 match the cacher's weekend_runs and the race schedule.
const SESSION_TYPES: Record<number, SessionType> = { 1: "practice", 2: "qualifying", 3: "race" };

// UNVERIFIED: 9 was observed the Friday after a finished race; 4 is the commonly documented value.
const CHECKERED_FLAGS = new Set([4, 9]);
// UNVERIFIED: 1 green, 2 yellow, 3 red, 4 checkered.
const GREEN_OR_LATER_FLAGS = new Set([1, 2, 3, 4]);

export const isCheckered = (flag: number | null) => flag !== null && CHECKERED_FLAGS.has(flag);
export const isGreenOrLater = (flag: number | null) => flag !== null && GREEN_OR_LATER_FLAGS.has(flag);

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
/** Lap times and speeds come through as 0 when there isn't one. */
const positiveOrNull = (v: unknown) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/**
 * UNVERIFIED field names. The first choice in each pair is the live feed's commonly reported name; the fallback is the
 * cacher's verified name for the same thing. Fix this function — and only this function — once a real capture exists.
 */
function readVehicle(v: Raw, flagState: number | null): NormalizedVehicle | null {
  const driver = isObject(v.driver) ? v.driver : {};
  const nascarDriverId = num(driver.driver_id ?? v.driver_id);
  const driverName = str(driver.full_name ?? v.driver_name);
  const carNumber = str(v.vehicle_number ?? v.car_number);
  const runningPosition = num(v.running_position ?? v.finishing_position);
  if (nascarDriverId === null || driverName === null || carNumber === null || runningPosition === null) return null;
  return {
    nascarDriverId,
    driverName,
    carNumber,
    runningPosition,
    lapsCompleted: num(v.laps_completed) ?? 0,
    // UNVERIFIED: no out/running indicator has been seen yet, so this only knows "finished" from the flag.
    status: isCheckered(flagState) ? "FINISHED" : "RUNNING",
    delta: num(v.delta ?? v.delta_leader),
    bestLapTime: positiveOrNull(v.best_lap_time),
    bestLapSpeed: positiveOrNull(v.best_lap_speed),
  };
}

/** Throws FeedShapeError on anything it can't read in full; callers treat that like a failed fetch. */
export function normalizeLiveFeed(raw: unknown, fetchedAt = new Date()): NormalizedRaceFeed {
  if (!isObject(raw) || !Array.isArray(raw.vehicles)) throw new FeedShapeError("Live feed has no vehicles array.");
  const flagState = num(raw.flag_state);
  const vehicles = raw.vehicles.map((v, i) => {
    const vehicle = isObject(v) ? readVehicle(v, flagState) : null;
    // Never drop a car: a missing one would shrink fieldSize and change how DNFs score (SPEC Section 7).
    if (!vehicle) throw new FeedShapeError(`Live feed vehicle ${i} is missing a driver id, name, car number, or position.`);
    return vehicle;
  });
  const runType = num(raw.run_type);
  return {
    nascarRaceId: num(raw.race_id),
    seriesId: num(raw.series_id),
    sessionType: (runType !== null && SESSION_TYPES[runType]) || "unknown",
    currentLap: num(raw.lap_number),
    totalLaps: num(raw.laps_in_race),
    flagState,
    vehicles,
    fetchedAt,
  };
}

/** The entry list from the cacher weekend feed (verified; populated two days before the race). */
export function normalizeEntryList(raw: unknown, nascarRaceId: number): FeedEntry[] {
  if (!isObject(raw) || !Array.isArray(raw.weekend_race)) throw new FeedShapeError("Weekend feed has no weekend_race.");
  const race = raw.weekend_race.find((r) => isObject(r) && num(r.race_id) === nascarRaceId);
  if (!isObject(race) || !Array.isArray(race.results)) {
    throw new FeedShapeError(`Weekend feed has no entry list for race ${nascarRaceId}.`);
  }
  return race.results.map((r, i) => {
    const row = isObject(r) ? r : {};
    const nascarDriverId = num(row.driver_id);
    const driverName = str(row.driver_fullname);
    const carNumber = str(row.car_number);
    if (nascarDriverId === null || driverName === null || carNumber === null) {
      throw new FeedShapeError(`Weekend feed entry ${i} is missing a driver id, name, or car number.`);
    }
    return { nascarDriverId, driverName, carNumber, teamName: str(row.team_name) };
  });
}

// --- Fetching ---------------------------------------------------------------------------------

export type FetchRaw = (url: string) => Promise<unknown>;

/** 10-second timeout, 3 retries with exponential backoff (SPEC Section 7, "Resilience"). */
export const fetchRaw: FetchRaw = async (url) => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

export const liveFeedUrl = () => `${env.NASCAR_FEED_BASE_URL}/live/feeds/live-feed.json`;

// Last good feed, kept in memory. Client requests never call NASCAR; they read this and the database.
let cached: NormalizedRaceFeed | null = null;
let stale = false;
let loggedFirst = false;
let loggedFirstWithVehicles = false;

export interface FeedSnapshot {
  feed: NormalizedRaceFeed | null;
  stale: boolean;
}

export function liveFeedSnapshot(): FeedSnapshot {
  return { feed: cached, stale };
}

/** Tests only. */
export function setLiveFeedCache(feed: NormalizedRaceFeed | null, isStale = false): void {
  cached = feed;
  stale = isStale;
}

/**
 * Fetches and normalizes the live feed. Fails soft: on any error it keeps serving the last good feed with stale: true.
 * Logs the raw payload once, and once more the first time it carries vehicles, so real field names can be checked.
 */
export async function refreshLiveFeed(fetcher: FetchRaw = fetchRaw): Promise<FeedSnapshot> {
  try {
    const raw = await fetcher(liveFeedUrl());
    const hasVehicles = isObject(raw) && Array.isArray(raw.vehicles) && raw.vehicles.length > 0;
    if (!loggedFirst || (hasVehicles && !loggedFirstWithVehicles)) {
      console.log(`[nascarFeed] raw live feed${hasVehicles ? " (with vehicles)" : ""}:`, JSON.stringify(raw));
      loggedFirst = true;
      if (hasVehicles) loggedFirstWithVehicles = true;
    }
    cached = normalizeLiveFeed(raw);
    stale = false;
  } catch (err) {
    stale = true;
    console.warn("[nascarFeed] live feed fetch failed; serving the last good copy:", err instanceof Error ? err.message : err);
  }
  return liveFeedSnapshot();
}

export async function fetchEntryList(
  year: number,
  seriesId: number,
  nascarRaceId: number,
  fetcher: FetchRaw = fetchRaw,
): Promise<FeedEntry[]> {
  const raw = await fetcher(`${env.NASCAR_FEED_BASE_URL}/cacher/${year}/${seriesId}/${nascarRaceId}/weekend-feed.json`);
  return normalizeEntryList(raw, nascarRaceId);
}
