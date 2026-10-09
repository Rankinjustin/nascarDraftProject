import { aggregateSeason, type SeasonStats } from "@dnd/shared";
import { prisma } from "../db";
import { notFound } from "../errors";
import { driverFinishesOf } from "./scoring";
import { toSeasonView } from "./seasons";

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
      driverFinishes: driverFinishesOf(w),
    })),
  );
  return { season: toSeasonView(season), ...stats };
}
