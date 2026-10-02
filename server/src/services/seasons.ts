import type { SeasonView } from "@dnd/shared";
import { prisma } from "../db";

/** Newest first. */
export async function listSeasons(): Promise<SeasonView[]> {
  const seasons = await prisma.season.findMany({ orderBy: [{ year: "desc" }, { seriesId: "asc" }] });
  return seasons.map(({ id, year, seriesId, name, isCurrent }) => ({ id, year, seriesId, name, isCurrent }));
}
