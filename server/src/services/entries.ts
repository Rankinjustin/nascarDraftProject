import type { Driver, RaceEntry } from "@prisma/client";
import type { DriverView, EntryUpdateResult, RaceEntryView } from "@dnd/shared";
import { prisma } from "../db";
import { HttpError, notFound } from "../errors";
import { withRaceLock, type Tx } from "../races/lock";

export function byCarNumber(a: { carNumber: string }, b: { carNumber: string }): number {
  return a.carNumber.localeCompare(b.carNumber, undefined, { numeric: true });
}

export function toEntryView(entry: RaceEntry & { driver: Driver }, drafted: Set<string>): RaceEntryView {
  return {
    id: entry.id,
    driverId: entry.driverId,
    driverName: entry.driver.driverName,
    carNumber: entry.carNumber,
    teamName: entry.driver.teamName,
    isEligible: entry.isEligible,
    isDrafted: drafted.has(entry.driverId),
  };
}

export function toDriverView(driver: Driver): DriverView {
  return {
    id: driver.id,
    nascarDriverId: driver.nascarDriverId,
    driverName: driver.driverName,
    carNumber: driver.carNumber,
    teamName: driver.teamName,
    isActive: driver.isActive,
  };
}

async function draftedDriverIds(db: Tx | typeof prisma, raceId: string): Promise<Set<string>> {
  const picks = await db.pick.findMany({ where: { raceId }, select: { driverId: true } });
  return new Set(picks.map((p) => p.driverId));
}

async function entriesFor(db: Tx | typeof prisma, raceId: string): Promise<RaceEntryView[]> {
  const entries = await db.raceEntry.findMany({ where: { raceId }, include: { driver: true } });
  const drafted = await draftedDriverIds(db, raceId);
  return entries.map((e) => toEntryView(e, drafted)).sort(byCarNumber);
}

export async function listEntries(raceId: string): Promise<RaceEntryView[]> {
  const race = await prisma.race.findUnique({ where: { id: raceId }, select: { id: true } });
  if (!race) throw notFound("Race");
  return entriesFor(prisma, raceId);
}

export async function listDrivers(): Promise<DriverView[]> {
  const drivers = await prisma.driver.findMany();
  return drivers.map(toDriverView).sort(byCarNumber);
}

export type AddEntriesInput =
  | { driverIds: string[] }
  | { newDriver: { driverName: string; carNumber: string; teamName?: string | null } };

/**
 * Manual add: existing drivers by id (already-entered ones are skipped), or a brand-new driver
 * with no nascarDriverId — the poller backfills that later (SPEC Section 7).
 */
export async function addEntries(raceId: string, input: AddEntriesInput): Promise<RaceEntryView[]> {
  return withRaceLock(raceId, async (tx) => {
    if ("newDriver" in input) {
      const driver = await tx.driver.create({ data: { ...input.newDriver, nascarDriverId: null } });
      await tx.raceEntry.create({ data: { raceId, driverId: driver.id, carNumber: driver.carNumber } });
    } else {
      const drivers = await tx.driver.findMany({ where: { id: { in: input.driverIds } } });
      if (drivers.length !== new Set(input.driverIds).size) throw notFound("Driver");
      await tx.raceEntry.createMany({
        data: drivers.map((d) => ({ raceId, driverId: d.id, carNumber: d.carNumber })),
        skipDuplicates: true,
      });
    }
    return entriesFor(tx, raceId);
  });
}

/** "Copy entries from last race": copies the source race's eligible entries, skipping drivers already entered. */
export async function copyEntriesFrom(raceId: string, sourceRaceId: string): Promise<RaceEntryView[]> {
  if (raceId === sourceRaceId) throw new HttpError(400, "SAME_RACE", "Pick a different race to copy from.");
  return withRaceLock(raceId, async (tx) => {
    const source = await tx.race.findUnique({
      where: { id: sourceRaceId },
      include: { entries: { where: { isEligible: true } } },
    });
    if (!source) throw notFound("Source race");
    await tx.raceEntry.createMany({
      data: source.entries.map((e) => ({ raceId, driverId: e.driverId, carNumber: e.carNumber })),
      skipDuplicates: true,
    });
    return entriesFor(tx, raceId);
  });
}

async function findEntry(tx: Tx, raceId: string, entryId: string) {
  const entry = await tx.raceEntry.findUnique({ where: { id: entryId }, include: { driver: true } });
  if (!entry || entry.raceId !== raceId) throw notFound("Entry");
  return entry;
}

export async function updateEntry(
  raceId: string,
  entryId: string,
  patch: { isEligible?: boolean; carNumber?: string },
): Promise<EntryUpdateResult> {
  return withRaceLock(raceId, async (tx) => {
    await findEntry(tx, raceId, entryId);
    const entry = await tx.raceEntry.update({ where: { id: entryId }, data: patch, include: { driver: true } });
    const drafted = await draftedDriverIds(tx, raceId);
    const isDrafted = drafted.has(entry.driverId);
    return {
      entry: toEntryView(entry, drafted),
      warning:
        isDrafted && !entry.isEligible
          ? `${entry.driver.driverName} is already drafted. Swap that pick so the roster isn't stuck with a withdrawn driver.`
          : null,
    };
  });
}

export async function deleteEntry(raceId: string, entryId: string): Promise<void> {
  await withRaceLock(raceId, async (tx) => {
    const entry = await findEntry(tx, raceId, entryId);
    if ((await draftedDriverIds(tx, raceId)).has(entry.driverId)) {
      throw new HttpError(
        409,
        "ENTRY_DRAFTED",
        `${entry.driver.driverName} has been drafted. Mark them ineligible and swap the pick instead.`,
      );
    }
    await tx.raceEntry.delete({ where: { id: entryId } });
  });
}
