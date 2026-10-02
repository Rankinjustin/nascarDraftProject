import type { Prisma, Race } from "@prisma/client";
import { prisma } from "../db";
import { notFound } from "../errors";

export type Tx = Prisma.TransactionClient;

/**
 * Every write that touches a race's status, draft order, picks, entries or results runs in here
 * (SPEC Section 6). The row lock makes all writes for one race run one at a time.
 */
export async function withRaceLock<T>(raceId: string, fn: (tx: Tx, race: Race) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Race" WHERE "id" = ${raceId} FOR UPDATE`;
    if (locked.length === 0) throw notFound("Race");
    // Read through Prisma after locking so the row comes back fully typed.
    const race = await tx.race.findUniqueOrThrow({ where: { id: raceId } });
    return fn(tx, race);
  });
}
