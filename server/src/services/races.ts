import type { DraftOrder, Pick, Prisma, Race } from "@prisma/client";
import {
  OVERRIDE_REASONS,
  ROUNDS,
  type DraftOrderView,
  type PickView,
  type RaceDetail,
  type RaceInput,
  type RaceSummary,
  type TransitionReason,
} from "@dnd/shared";
import { prisma } from "../db";
import { conflict, isUniqueViolation, notFound } from "../errors";
import { pickCurrentRace } from "../races/current";
import { withRaceLock } from "../races/lock";
import { applyTransition } from "../races/transition";
import { byCarNumber, toEntryView } from "./entries";
import { findSeason } from "./seasons";

export const withEntryCount = { _count: { select: { entries: true } } } satisfies Prisma.RaceInclude;
/** A race with its entry count, or with its entries already loaded (then they're counted instead). */
type RaceWithCount = Race & ({ _count: { entries: number } } | { entries: unknown[] });

export function toRaceSummary(race: RaceWithCount): RaceSummary {
  return {
    id: race.id,
    seasonId: race.seasonId,
    nascarRaceId: race.nascarRaceId,
    raceName: race.raceName,
    trackName: race.trackName,
    raceDate: race.raceDate.toISOString(),
    qualifyingAt: race.qualifyingAt?.toISOString() ?? null,
    trackMapUrl: race.trackMapUrl,
    imageUrl: race.imageUrl,
    status: race.status,
    scoringRuleKey: race.scoringRuleKey,
    totalLaps: race.totalLaps,
    wentLiveAt: race.wentLiveAt?.toISOString() ?? null,
    completedAt: race.completedAt?.toISOString() ?? null,
    entryCount: "entries" in race ? race.entries.length : race._count.entries,
  };
}

export const toOrderView = (o: DraftOrder & { user: { displayName: string } }): DraftOrderView => ({
  userId: o.userId,
  displayName: o.user.displayName,
  pickPosition: o.pickPosition,
});

export const toPickView = (p: Pick): PickView => ({
  overallPickNumber: p.overallPickNumber,
  roundNumber: p.roundNumber,
  userId: p.userId,
  driverId: p.driverId,
  createdByUserId: p.createdByUserId,
});

const nascarRaceIdTaken = () => conflict("NASCAR_RACE_ID_TAKEN", "Another race already has that NASCAR race ID.");

/** Races in a season by date; defaults to the current season. */
export async function listRaces(seasonId?: string): Promise<RaceSummary[]> {
  const season = await findSeason(seasonId);
  if (!season) return [];
  const races = await prisma.race.findMany({
    where: { seasonId: season.id },
    orderBy: { raceDate: "asc" },
    include: withEntryCount,
  });
  return races.map(toRaceSummary);
}

export async function getCurrentRace(now = new Date()): Promise<RaceSummary | null> {
  const races = await prisma.race.findMany({ where: { status: { not: "CORRECTING" } }, include: withEntryCount });
  const current = pickCurrentRace(races, now);
  return current ? toRaceSummary(current) : null;
}

export async function getRaceDetail(id: string): Promise<RaceDetail> {
  const race = await prisma.race.findUnique({
    where: { id },
    include: {
      entries: { include: { driver: true } },
      draftOrders: { include: { user: true }, orderBy: { pickPosition: "asc" } },
      picks: { orderBy: { overallPickNumber: "asc" } },
    },
  });
  if (!race) throw notFound("Race");

  const drafted = new Set(race.picks.map((p) => p.driverId));
  return {
    ...toRaceSummary(race),
    entries: race.entries.map((e) => toEntryView(e, drafted)).sort(byCarNumber),
    draftOrder: race.draftOrders.map(toOrderView),
    picks: race.picks.map(toPickView),
    picksMade: race.picks.length,
    totalSlots: race.draftOrders.length * ROUNDS,
  };
}

/** RaceInput with its dates parsed. */
export type NewRace = Omit<RaceInput, "raceDate" | "qualifyingAt"> & { raceDate: Date; qualifyingAt?: Date | null };

export async function createRace(input: NewRace): Promise<RaceSummary> {
  const season = await findSeason(input.seasonId);
  if (!season) {
    throw input.seasonId ? notFound("Season") : conflict("NO_CURRENT_SEASON", "There is no current season to add the race to.");
  }
  try {
    const race = await prisma.race.create({ data: { ...input, seasonId: season.id }, include: withEntryCount });
    return toRaceSummary(race);
  } catch (err) {
    if (isUniqueViolation(err)) throw nascarRaceIdTaken();
    throw err;
  }
}

export type RacePatch = Partial<Omit<NewRace, "seasonId">>;

/** Metadata only; status changes go through overrideStatus or their dedicated actions. */
export async function updateRace(id: string, patch: RacePatch): Promise<RaceSummary> {
  try {
    await withRaceLock(id, async (tx, race) => {
      if (patch.scoringRuleKey !== undefined && patch.scoringRuleKey !== race.scoringRuleKey) {
        if (race.status === "COMPLETED" || race.status === "CORRECTING") {
          throw conflict("RACE_COMPLETED", "The scoring rule can't change after the race is completed.");
        }
      }
      await tx.race.update({ where: { id }, data: patch });

      // Postponement: the deadline warning and close announcement should fire again for the new date.
      if (patch.raceDate && patch.raceDate.getTime() !== race.raceDate.getTime()) {
        await tx.notificationLog.deleteMany({
          where: { raceId: id, kind: { in: ["deadline_warning", "draft_closed"] } },
        });
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw nascarRaceIdTaken();
    throw err;
  }
  const race = await prisma.race.findUniqueOrThrow({ where: { id }, include: withEntryCount });
  return toRaceSummary(race);
}

/** Commissioner status override (POST /races/:id/status). Only the four override reasons are accepted. */
export async function overrideStatus(
  id: string,
  reason: TransitionReason,
  actorUserId: string,
  note?: string,
): Promise<RaceSummary> {
  if (!(OVERRIDE_REASONS as readonly string[]).includes(reason)) {
    throw conflict(
      "OVERRIDE_NOT_ALLOWED",
      `"${reason}" can't be applied as an override; use its own action (wheel spin, complete, reopen, regenerate).`,
    );
  }
  await withRaceLock(id, (tx, race) => applyTransition(tx, race, reason, { actorUserId, note }));
  const race = await prisma.race.findUniqueOrThrow({ where: { id }, include: withEntryCount });
  return toRaceSummary(race);
}
