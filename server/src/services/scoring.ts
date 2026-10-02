import type { prisma } from "../db";
import type { Tx } from "../races/lock";

/**
 * fieldSize (SPEC Section 4): the count of RaceResult rows for the race, falling back to the count of eligible
 * RaceEntry rows before any results exist. Every caller — the live leaderboard and race completion — uses this,
 * so a DNF is scored the same way in both.
 */
export async function fieldSizeFor(db: Tx | typeof prisma, raceId: string): Promise<number> {
  const results = await db.raceResult.count({ where: { raceId } });
  if (results > 0) return results;
  return db.raceEntry.count({ where: { raceId, isEligible: true } });
}
