import type { FeedSessionType } from "@dnd/shared";
import { prisma } from "../db";
import { isCheckered, isGreenOrLater, refreshLiveFeed, type FeedSnapshot, type NormalizedRaceFeed } from "../integrations/nascarFeed";
import { ACTIVE_STATUSES } from "../races/current";
import { withRaceLock } from "../races/lock";
import { applyTransition } from "../races/transition";
import { resolveDrivers } from "../services/feedDrivers";
import { captureFeedQualifying } from "../services/qualifying";

const DAY = 24 * 60 * 60 * 1000;
const SLOW_INTERVAL = 2 * 60 * 1000;

let lastFetchAt = 0;
let lastSession: FeedSessionType | null = null;

/** Tests only. */
export function resetPollerState(): void {
  lastFetchAt = 0;
  lastSession = null;
}

/**
 * One poller tick (SPEC Section 7, "Poller"); scheduled every 20 seconds with an overlap guard.
 * Fetches every tick while a race is LIVE or qualifying is running, otherwise every 2 minutes,
 * and only when some race is in its active window.
 */
export async function runPoller(now = new Date(), refresh: () => Promise<FeedSnapshot> = () => refreshLiveFeed()) {
  const races = await prisma.race.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      nascarRaceId: { not: null },
      raceDate: { gte: new Date(now.getTime() - 4 * DAY), lte: new Date(now.getTime() + 3 * DAY) },
    },
    include: { season: true },
  });
  if (races.length === 0) return;

  const fast = races.some((r) => r.status === "LIVE") || lastSession === "qualifying";
  if (!fast && now.getTime() - lastFetchAt < SLOW_INTERVAL) return;
  lastFetchAt = now.getTime();

  const { feed, stale } = await refresh();
  // A failed fetch leaves the old copy in the cache; it was already applied when it was fresh.
  if (!feed || stale) return;
  lastSession = feed.sessionType;

  const race = races.find(
    (r) => r.nascarRaceId === feed.nascarRaceId && (feed.seriesId === null || feed.seriesId === r.season.seriesId),
  );
  if (race) await applyFeed(race.id, feed, now);
}

/** Writes one feed into its matching race, inside the race lock. Never writes a COMPLETED or CORRECTING race. */
export async function applyFeed(raceId: string, feed: NormalizedRaceFeed, now = new Date()): Promise<void> {
  await withRaceLock(raceId, async (tx, race) => {
    if (race.nascarRaceId === null || race.nascarRaceId !== feed.nascarRaceId) return;

    if (feed.sessionType === "qualifying" && (race.status === "DRAFTING" || race.status === "LOCKED")) {
      await captureFeedQualifying(tx, race.id, feed.vehicles);
      return;
    }
    if (feed.sessionType !== "race") return;

    let status = race.status;
    if (status === "LOCKED" && isGreenOrLater(feed.flagState) && now.getTime() >= race.raceDate.getTime() - 60 * 60 * 1000) {
      status = (await applyTransition(tx, race, "green_flag", { actorUserId: null, now })).status;
    }
    if (status !== "LIVE") return;

    const drivers = await resolveDrivers(tx, race.id, feed.vehicles);
    for (const [i, v] of feed.vehicles.entries()) {
      const live = { runningPosition: v.runningPosition, lapsCompleted: v.lapsCompleted, status: v.status };
      // Never touches finishPosition; that's filled when the commissioner completes the race.
      await tx.raceResult.upsert({
        where: { raceId_driverId: { raceId: race.id, driverId: drivers[i]!.id } },
        create: { raceId: race.id, driverId: drivers[i]!.id, ...live, source: "feed" },
        update: live,
      });
    }
    await tx.race.update({
      where: { id: race.id },
      data: {
        currentLap: feed.currentLap,
        totalLaps: feed.totalLaps ?? race.totalLaps,
        flagState: feed.flagState,
        feedUpdatedAt: feed.fetchedAt,
        ...(isCheckered(feed.flagState) && race.checkeredSeenAt === null ? { checkeredSeenAt: now } : {}),
      },
    });
  });
}
