import type { DraftedDriverStats, DriverFinish, SeasonStats, UserSeasonStats, WeekRef } from "../types";
import { scoringRuleFor } from "./scoring";

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

/** Mean of the known values; null when there are none. */
export function mean(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

/** Higher is better, whichever way the week's rule scores. */
function goodness(row: WeekRow): number {
  return scoringRuleFor(row.scoringRuleKey).direction === "asc" ? -row.score : row.score;
}

const ref = (r: WeekRow): WeekRef => ({ raceId: r.raceId, raceName: r.raceName, score: r.score, rank: r.rank });

/**
 * Season aggregates from frozen weekly snapshots (SPEC Phase 7). Wins count rank === 1 rows, so a tie is a win
 * for every co-winner. Users tied on wins are ordered by average score in the direction the rule scores.
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
  const sign = rows[0] && scoringRuleFor(rows[0].scoringRuleKey).direction === "desc" ? -1 : 1;
  users.sort((a, b) => b.wins - a.wins || sign * (a.avgScore! - b.avgScore!) || a.displayName.localeCompare(b.displayName));

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
      avgFinish: mean(d.finishes),
    }))
    .sort((a, b) => b.timesDrafted - a.timesDrafted || (a.avgFinish ?? Infinity) - (b.avgFinish ?? Infinity))
    .slice(0, 15);

  return { weeksCompleted: new Set(rows.map((r) => r.raceId)).size, users, mostDrafted };
}
