import type { Driver, RaceEntry } from "@prisma/client";
import type { DriverView, EntryImportResult, EntryUpdateResult, RaceEntryView } from "@dnd/shared";
import { prisma, type Db } from "../db";
import { conflict, HttpError, notFound } from "../errors";
import { fetchEntryList, type FeedEntry, type FetchRaw } from "../integrations/nascarFeed";
import { findRace, withRaceLock, type Tx } from "../races/lock";
import { resolveDrivers } from "./feedDrivers";

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

function toDriverView(driver: Driver): DriverView {
  return {
    id: driver.id,
    nascarDriverId: driver.nascarDriverId,
    driverName: driver.driverName,
    carNumber: driver.carNumber,
    teamName: driver.teamName,
  };
}

async function draftedDriverIds(db: Db, raceId: string): Promise<Set<string>> {
  const picks = await db.pick.findMany({ where: { raceId }, select: { driverId: true } });
  return new Set(picks.map((p) => p.driverId));
}

async function entriesFor(db: Db, raceId: string): Promise<RaceEntryView[]> {
  const entries = await db.raceEntry.findMany({ where: { raceId }, include: { driver: true } });
  const drafted = await draftedDriverIds(db, raceId);
  return entries.map((e) => toEntryView(e, drafted)).sort(byCarNumber);
}

export async function listEntries(raceId: string): Promise<RaceEntryView[]> {
  await findRace(raceId);
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
      throw conflict("ENTRY_DRAFTED", `${entry.driver.driverName} has been drafted. Mark them ineligible and swap the pick instead.`);
    }
    await tx.raceEntry.delete({ where: { id: entryId } });
  });
}

/**
 * POST /races/:id/entries/import — the entry list from NASCAR's cacher weekend feed, which is populated a couple of
 * days before the race. Also records the scheduled qualifying time from the same feed. Adds missing entries and
 * updates car numbers that changed. Nothing is removed: withdrawals are the commissioner's call.
 */
export async function importEntries(raceId: string, fetcher?: FetchRaw): Promise<EntryImportResult> {
  const race = await prisma.race.findUnique({ where: { id: raceId }, include: { season: true } });
  if (!race) throw notFound("Race");
  if (race.nascarRaceId === null) {
    throw conflict("NO_NASCAR_RACE_ID", "Set the race's NASCAR race ID before importing its entry list.");
  }

  let list: FeedEntry[];
  let qualifyingAt: Date | null;
  try {
    ({ entries: list, qualifyingAt } = await fetchEntryList(race.season.year, race.season.seriesId, race.nascarRaceId, fetcher));
  } catch (err) {
    console.warn("[entries] entry-list import failed:", err instanceof Error ? err.message : err);
    throw new HttpError(502, "FEED_UNAVAILABLE", "NASCAR's feed didn't return an entry list. Try again later, or add entries by hand.");
  }
  if (list.length === 0) {
    throw conflict("NO_ENTRY_LIST", "NASCAR hasn't published the entry list for this race yet.");
  }

  return withRaceLock(raceId, async (tx) => {
    // The feed's schedule wins over a hand-entered time; a missing one leaves the commissioner's value alone.
    if (qualifyingAt) await tx.race.update({ where: { id: raceId }, data: { qualifyingAt } });
    const drivers = await resolveDrivers(tx, raceId, list);
    const existing = new Map((await tx.raceEntry.findMany({ where: { raceId } })).map((e) => [e.driverId, e]));
    const handled = new Set<string>();
    let added = 0;
    let updated = 0;
    for (const [i, car] of list.entries()) {
      const driver = drivers[i]!;
      if (handled.has(driver.id)) continue;
      handled.add(driver.id);
      const entry = existing.get(driver.id);
      if (!entry) {
        await tx.raceEntry.create({ data: { raceId, driverId: driver.id, carNumber: car.carNumber } });
        added += 1;
      } else if (entry.carNumber !== car.carNumber) {
        await tx.raceEntry.update({ where: { id: entry.id }, data: { carNumber: car.carNumber } });
        updated += 1;
      }
      if (driver.carNumber !== car.carNumber || (car.teamName && driver.teamName !== car.teamName)) {
        await tx.driver.update({ where: { id: driver.id }, data: { carNumber: car.carNumber, teamName: car.teamName ?? driver.teamName } });
      }
    }
    return { entries: await entriesFor(tx, raceId), added, updated };
  });
}
