import type { Season } from "@prisma/client";
import type { SeasonView } from "@dnd/shared";
import { prisma } from "../db";

export const toSeasonView = ({ id, year, seriesId, name, isCurrent }: Season): SeasonView => ({ id, year, seriesId, name, isCurrent });

/** The given season, or the current one when no id is passed. */
export function findSeason(seasonId?: string): Promise<Season | null> {
  return seasonId
    ? prisma.season.findUnique({ where: { id: seasonId } })
    : prisma.season.findFirst({ where: { isCurrent: true } });
}

/** Newest first. */
export async function listSeasons(): Promise<SeasonView[]> {
  const seasons = await prisma.season.findMany({ orderBy: [{ year: "desc" }, { seriesId: "asc" }] });
  return seasons.map(toSeasonView);
}
