import {
  mean,
  rankEntries,
  rosterFor,
  scoringRuleFor,
  type FantasyStanding,
  type LiveDriverRow,
  type LiveView,
  type RosterSlot,
  type UserEntry,
} from "@dnd/shared";
import { prisma } from "../db";
import { notFound } from "../errors";
import { flagLabel, liveFeedSnapshot } from "../integrations/nascarFeed";
import { toRaceSummary } from "./races";
import { fieldSizeFor } from "./scoring";
import { gridFor } from "./qualifying";

const EMPTY_SLOT: RosterSlot = {
  driverId: null,
  driverName: null,
  carNumber: null,
  startPosition: null,
  position: null,
  change: null,
  isWithdrawn: false,
};

/** start − current: positive = positions gained. */
const changeOf = (start: number | null, position: number | null) => (start !== null && position !== null ? start - position : null);

/**
 * GET /races/:id/live — the race page's single poll. Reads the database and the poller's in-memory feed;
 * never calls NASCAR, and a feed failure never breaks it (standings come from the database).
 */
export async function getLiveView(raceId: string): Promise<LiveView> {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: {
      entries: { include: { driver: true } },
      draftOrders: { orderBy: { pickPosition: "asc" }, include: { user: true } },
      picks: { orderBy: { overallPickNumber: "asc" } },
      results: { include: { driver: true } },
    },
  });
  if (!race) throw notFound("Race");

  const qualifying = await gridFor(prisma, raceId);
  const fieldSize = await fieldSizeFor(prisma, raceId);
  const final = race.status === "COMPLETED" || race.status === "CORRECTING";

  const startByDriver = new Map(qualifying.map((q) => [q.driverId, q.startPosition]));
  const entryByDriver = new Map(race.entries.map((e) => [e.driverId, e]));
  const resultByDriver = new Map(race.results.map((r) => [r.driverId, r]));
  const userById = new Map(race.draftOrders.map((o) => [o.userId, o.user]));
  const ownerByDriver = new Map(race.picks.map((p) => [p.driverId, p.userId]));
  // The live leaderboard reads runningPosition; once completed, the frozen finishPosition.
  const positionOf = (driverId: string): number | null => {
    const r = resultByDriver.get(driverId);
    if (!r) return null;
    return final ? (r.finishPosition ?? r.runningPosition) : r.runningPosition;
  };

  const runningOrder: LiveDriverRow[] = race.results
    .map((r) => {
      const position = positionOf(r.driverId);
      const startPosition = startByDriver.get(r.driverId) ?? null;
      const ownerUserId = ownerByDriver.get(r.driverId) ?? null;
      return {
        driverId: r.driverId,
        driverName: r.driver.driverName,
        carNumber: entryByDriver.get(r.driverId)?.carNumber ?? r.driver.carNumber,
        position,
        startPosition,
        change: changeOf(startPosition, position),
        lapsCompleted: r.lapsCompleted,
        status: r.status,
        ownerUserId,
        ownerName: ownerUserId ? (userById.get(ownerUserId)?.displayName ?? null) : null,
      };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

  const rosters = race.draftOrders.map((o) => {
    const slots = rosterFor(o.userId, race.picks).map((pick): RosterSlot => {
      if (!pick) return EMPTY_SLOT;
      const entry = entryByDriver.get(pick.driverId);
      const startPosition = startByDriver.get(pick.driverId) ?? null;
      const position = positionOf(pick.driverId);
      return {
        driverId: pick.driverId,
        driverName: entry?.driver.driverName ?? null,
        carNumber: entry?.carNumber ?? null,
        startPosition,
        position,
        change: changeOf(startPosition, position),
        isWithdrawn: !entry || !entry.isEligible,
      };
    });
    return { order: o, slots };
  });

  // Same rankEntries as completion, against current positions, so projected and final standings agree on method.
  const entries: UserEntry[] = rosters.map(({ order, slots }) => ({
    userId: order.userId,
    drivers: slots.map((s) => ({ driverId: s.driverId, finishPosition: s.position })),
  }));
  // A completed week shows its frozen snapshot, so the page can never disagree with history or season stats.
  const ranked =
    race.status === "COMPLETED"
      ? await prisma.weeklyResult.findMany({ where: { raceId }, select: { userId: true, score: true, rank: true } })
      : race.results.length > 0
        ? rankEntries(entries, scoringRuleFor(race.scoringRuleKey), { fieldSize })
        : [];
  const rankByUser = new Map(ranked.map((r) => [r.userId, r]));

  const fantasyStandings: FantasyStanding[] = rosters
    .map(({ order, slots }) => ({
      userId: order.userId,
      displayName: order.user.displayName,
      pickPosition: order.pickPosition,
      score: rankByUser.get(order.userId)?.score ?? null,
      rank: rankByUser.get(order.userId)?.rank ?? null,
      avgStart: mean(slots.map((s) => s.startPosition)),
      avgCurrent: mean(slots.map((s) => s.position)),
      drivers: slots,
    }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.pickPosition - b.pickPosition);

  const { feed, stale } = liveFeedSnapshot();
  const ours = feed && race.nascarRaceId !== null && feed.nascarRaceId === race.nascarRaceId ? feed : null;

  return {
    race: {
      ...toRaceSummary(race),
      currentLap: race.currentLap,
      totalLaps: race.totalLaps,
      flag: flagLabel(race.flagState),
      feedUpdatedAt: race.feedUpdatedAt?.toISOString() ?? null,
      checkeredSeenAt: race.checkeredSeenAt?.toISOString() ?? null,
    },
    feed: ours
      ? {
          sessionType: ours.sessionType,
          flag: flagLabel(ours.flagState),
          currentLap: ours.currentLap,
          totalLaps: ours.totalLaps,
          fetchedAt: ours.fetchedAt.toISOString(),
        }
      : null,
    stale,
    fieldSize,
    qualifying,
    runningOrder,
    fantasyStandings,
  };
}
