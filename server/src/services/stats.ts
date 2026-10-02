import {
  SCORING_RULES,
  type DraftedDriverStats,
  type DriverFinish,
  type SeasonStats,
  type UserSeasonStats,
  type WeekRef,
} from "@dnd/shared";
import { prisma } from "../db";
import { notFound } from "../errors";

export interface WeekRow {
  raceId: string;
  raceName: string;
  userId: string;
  displayName: string;
  score: number;
  rank: number;
  scoringRuleKey: string;
  driverFinishes: DriverFinish[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Higher is better, whichever way the week's rule scores. */
function goodness(row: WeekRow): number {
  return (SCORING_RULES[row.scoringRuleKey]?.direction ?? "asc") === "asc" ? -row.score : row.score;
}

const ref = (r: WeekRow): WeekRef => ({ raceId: r.raceId, raceName: r.raceName, score: r.score, rank: r.rank });

/**
 * Season aggregates from frozen weekly snapshots (SPEC Phase 7). Wins count rank === 1 rows, so a tie is a win
 * for every co-winner. Pure: takes the rows, returns the numbers.
 */
export function aggregateSeason(rows: WeekRow[]): Pick<SeasonStats, "weeksCompleted" | "users" | "mostDrafted"> {
  const byUser = new Map<string, WeekRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

  const users: UserSeasonStats[] = [...byUser.values()].map((weeks) => {
    const drafted = weeks.flatMap((w) => w.driverFinishes.filter((d) => d.driverId !== null));
    const sorted = [...weeks].sort((a, b) => goodness(b) - goodness(a));
    return {
      userId: weeks[0]!.userId,
      displayName: weeks[0]!.displayName,
      weeksPlayed: weeks.length,
      wins: weeks.filter((w) => w.rank === 1).length,
      avgScore: mean(weeks.map((w) => w.score)),
      bestWeek: ref(sorted[0]!),
      worstWeek: ref(sorted.at(-1)!),
      driversDrafted: drafted.length,
      top10Rate: drafted.length
        ? drafted.filter((d) => d.finishPosition !== null && d.finishPosition <= 10).length / drafted.length
        : null,
    };
  });
  users.sort((a, b) => b.wins - a.wins || (a.avgScore ?? Infinity) - (b.avgScore ?? Infinity) || a.displayName.localeCompare(b.displayName));

  const drivers = new Map<string, { name: string; car: string | null; finishes: (number | null)[] }>();
  for (const r of rows) {
    for (const d of r.driverFinishes) {
      if (!d.driverId) continue;
      const entry = drivers.get(d.driverId) ?? { name: d.driverName, car: d.carNumber, finishes: [] };
      entry.finishes.push(d.finishPosition);
      drivers.set(d.driverId, entry);
    }
  }
  const mostDrafted: DraftedDriverStats[] = [...drivers.entries()]
    .map(([driverId, d]) => ({
      driverId,
      driverName: d.name,
      carNumber: d.car,
      timesDrafted: d.finishes.length,
      avgFinish: mean(d.finishes.filter((f): f is number => f !== null)),
    }))
    .sort((a, b) => b.timesDrafted - a.timesDrafted || (a.avgFinish ?? Infinity) - (b.avgFinish ?? Infinity))
    .slice(0, 15);

  return { weeksCompleted: new Set(rows.map((r) => r.raceId)).size, users, mostDrafted };
}

/** GET /seasons/:id/stats — reads exclusively from WeeklyResult. */
export async function getSeasonStats(seasonId: string): Promise<SeasonStats> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) throw notFound("Season");
  const rows = await prisma.weeklyResult.findMany({
    where: { race: { seasonId } },
    include: { user: true, race: { select: { raceName: true } } },
  });
  const stats = aggregateSeason(
    rows.map((w) => ({
      raceId: w.raceId,
      raceName: w.race.raceName,
      userId: w.userId,
      displayName: w.user.displayName,
      score: w.score,
      rank: w.rank,
      scoringRuleKey: w.scoringRuleKey,
      driverFinishes: w.driverFinishes as unknown as DriverFinish[],
    })),
  );
  const { id, year, seriesId, name, isCurrent } = season;
  return { season: { id, year, seriesId, name, isCurrent }, ...stats };
}
