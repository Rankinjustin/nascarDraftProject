import type { QualifyingView } from "@dnd/shared";
import type { NormalizedVehicle } from "../integrations/nascarFeed";
import { prisma, type Db } from "../db";
import { HttpError, notFound } from "../errors";
import { findRace, withRaceLock, type Tx } from "../races/lock";
import { resolveDrivers } from "./feedDrivers";

export async function gridFor(db: Db, raceId: string): Promise<QualifyingView[]> {
  const rows = await db.qualifyingResult.findMany({
    where: { raceId },
    include: { driver: true },
    orderBy: { startPosition: "asc" },
  });
  const entries = await db.raceEntry.findMany({ where: { raceId }, select: { driverId: true, carNumber: true } });
  const carByDriver = new Map(entries.map((e) => [e.driverId, e.carNumber]));
  return rows.map((q) => ({
    driverId: q.driverId,
    driverName: q.driver.driverName,
    carNumber: carByDriver.get(q.driverId) ?? q.driver.carNumber,
    startPosition: q.startPosition,
    qualifyingTime: q.qualifyingTime,
    qualifyingSpeed: q.qualifyingSpeed,
    isPole: q.isPole,
    source: q.source === "manual" ? "manual" : "feed",
  }));
}

/** GET /races/:id/qualifying — empty until captured or entered. */
export async function getQualifying(raceId: string): Promise<QualifyingView[]> {
  await findRace(raceId);
  return gridFor(prisma, raceId);
}

/**
 * Poller capture during a live qualifying session (SPEC Section 7, "Qualifying capture"). Call inside the race lock.
 * Replaces the whole feed grid every poll (positions reshuffle constantly), and never touches a manual grid.
 * An empty session (cars not on track yet, or the feed already moved on) keeps the last grid.
 */
export async function captureFeedQualifying(tx: Tx, raceId: string, vehicles: NormalizedVehicle[]): Promise<boolean> {
  if (vehicles.length === 0) return false;
  if ((await tx.qualifyingResult.count({ where: { raceId, source: "manual" } })) > 0) return false;
  const drivers = await resolveDrivers(tx, raceId, vehicles);
  const seen = new Set<string>();
  const rows = vehicles.flatMap((v, i) => {
    const driverId = drivers[i]!.id;
    if (seen.has(driverId)) return [];
    seen.add(driverId);
    return [
      {
        raceId,
        driverId,
        startPosition: v.runningPosition,
        qualifyingTime: v.bestLapTime,
        qualifyingSpeed: v.bestLapSpeed,
        isPole: v.runningPosition === 1,
        source: "feed",
      },
    ];
  });
  await tx.qualifyingResult.deleteMany({ where: { raceId, source: "feed" } });
  await tx.qualifyingResult.createMany({ data: rows });
  return true;
}

export interface ManualGridRow {
  driverId: string;
  startPosition: number;
  qualifyingTime?: number | null;
  qualifyingSpeed?: number | null;
}

/** POST /races/:id/qualifying — the commissioner's word; replaces the whole grid with source "manual". */
export async function setManualQualifying(raceId: string, grid: ManualGridRow[]): Promise<QualifyingView[]> {
  if (new Set(grid.map((g) => g.driverId)).size !== grid.length) {
    throw new HttpError(400, "DUPLICATE_DRIVER", "A driver appears twice in the lineup.");
  }
  if (new Set(grid.map((g) => g.startPosition)).size !== grid.length) {
    throw new HttpError(400, "DUPLICATE_POSITION", "Two drivers have the same starting position.");
  }
  return withRaceLock(raceId, async (tx) => {
    const found = await tx.driver.count({ where: { id: { in: grid.map((g) => g.driverId) } } });
    if (found !== grid.length) throw notFound("Driver");
    await tx.qualifyingResult.deleteMany({ where: { raceId } });
    await tx.qualifyingResult.createMany({
      data: grid.map((g) => ({
        raceId,
        driverId: g.driverId,
        startPosition: g.startPosition,
        qualifyingTime: g.qualifyingTime ?? null,
        qualifyingSpeed: g.qualifyingSpeed ?? null,
        isPole: g.startPosition === 1,
        source: "manual",
      })),
    });
    return gridFor(tx, raceId);
  });
}
