import {
  ROUNDS,
  SCORING_RULES,
  rankEntries,
  type FantasyStanding,
  type LiveDriverRow,
  type LiveView,
  type RosterSlot,
  type UserEntry,
} from "@dnd/shared";
import { prisma } from "../db";
import { notFound } from "../errors";
import { liveFeedSnapshot } from "../integrations/nascarFeed";
import { toRaceSummary } from "./races";
import { fieldSizeFor } from "./scoring";
import { getQualifying } from "./qualifying";

const mean = (values: (number | null)[]): number | null => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

/**
 * GET /races/:id/live — the race page's single poll. Reads the database and the poller's in-memory feed;
 * never calls NASCAR, and a feed failure never breaks it (standings come from the database).
 */
export async function getLiveView(raceId: string): Promise<LiveView> {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: {
      _count: { select: { entries: true } },
      entries: { include: { driver: true } },
      draftOrders: { orderBy: { pickPosition: "asc" }, include: { user: true } },
      picks: { orderBy: { overallPickNumber: "asc" } },
      results: { include: { driver: true } },
    },
  });
  if (!race) throw notFound("Race");

  const qualifying = await getQualifying(raceId);
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
        change: startPosition !== null && position !== null ? startPosition - position : null,
        lapsCompleted: r.lapsCompleted,
        status: r.status,
        ownerUserId,
        ownerName: ownerUserId ? (userById.get(ownerUserId)?.displayName ?? null) : null,
      };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

  const rosters = race.draftOrders.map((o) => {
    const picks = race.picks.filter((p) => p.userId === o.userId);
    const slots: RosterSlot[] = Array.from({ length: ROUNDS }, (_, i) => {
      const pick = picks[i];
      if (!pick) return { driverId: null, driverName: null, carNumber: null, startPosition: null, position: null, isWithdrawn: false };
      const entry = entryByDriver.get(pick.driverId);
      return {
        driverId: pick.driverId,
        driverName: entry?.driver.driverName ?? null,
        carNumber: entry?.carNumber ?? null,
        startPosition: startByDriver.get(pick.driverId) ?? null,
        position: positionOf(pick.driverId),
        isWithdrawn: !entry || !entry.isEligible,
      };
    });
    return { order: o, slots };
  });

  // Same rankEntries as completion, against current positions, so projected and final standings agree on method.
  const rule = SCORING_RULES[race.scoringRuleKey] ?? SCORING_RULES.average_finish!;
  const entries: UserEntry[] = rosters.map(({ order, slots }) => ({
    userId: order.userId,
    drivers: slots.map((s) => ({ driverId: s.driverId, finishPosition: s.position })),
  }));
  // A completed week shows its frozen snapshot, so the page can never disagree with history or season stats.
  const ranked =
    race.status === "COMPLETED"
      ? await prisma.weeklyResult.findMany({ where: { raceId }, select: { userId: true, score: true, rank: true } })
      : race.results.length > 0
        ? rankEntries(entries, rule, { fieldSize })
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
      flagState: race.flagState,
      feedUpdatedAt: race.feedUpdatedAt?.toISOString() ?? null,
      checkeredSeenAt: race.checkeredSeenAt?.toISOString() ?? null,
    },
    feed: ours
      ? {
          sessionType: ours.sessionType,
          flagState: ours.flagState,
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
