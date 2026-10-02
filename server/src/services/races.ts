import { Prisma, type Race } from "@prisma/client";
import {
  OVERRIDE_REASONS,
  ROUNDS,
  SCORING_RULES,
  type RaceDetail,
  type RaceSummary,
  type TransitionReason,
} from "@dnd/shared";
import { prisma } from "../db";
import { HttpError, isUniqueViolation, notFound } from "../errors";
import { pickCurrentRace } from "../races/current";
import { withRaceLock } from "../races/lock";
import { applyTransition } from "../races/transition";
import { byCarNumber, toEntryView } from "./entries";

const withEntryCount = { _count: { select: { entries: true } } } satisfies Prisma.RaceInclude;
type RaceWithCount = Race & { _count: { entries: number } };

export function toRaceSummary(race: RaceWithCount): RaceSummary {
  return {
    id: race.id,
    seasonId: race.seasonId,
    nascarRaceId: race.nascarRaceId,
    raceName: race.raceName,
    trackName: race.trackName,
    raceDate: race.raceDate.toISOString(),
    status: race.status,
    scoringRuleKey: race.scoringRuleKey,
    totalLaps: race.totalLaps,
    wentLiveAt: race.wentLiveAt?.toISOString() ?? null,
    completedAt: race.completedAt?.toISOString() ?? null,
    entryCount: race._count.entries,
  };
}

const nascarRaceIdTaken = () =>
  new HttpError(409, "NASCAR_RACE_ID_TAKEN", "Another race already has that NASCAR race ID.");

/** Races in a season by date; defaults to the current season. */
export async function listRaces(seasonId?: string): Promise<RaceSummary[]> {
  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId } })
    : await prisma.season.findFirst({ where: { isCurrent: true } });
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
      ...withEntryCount,
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
    draftOrder: race.draftOrders.map((o) => ({
      userId: o.userId,
      displayName: o.user.displayName,
      pickPosition: o.pickPosition,
    })),
    picks: race.picks.map((p) => ({
      overallPickNumber: p.overallPickNumber,
      roundNumber: p.roundNumber,
      userId: p.userId,
      driverId: p.driverId,
      createdByUserId: p.createdByUserId,
    })),
    picksMade: race.picks.length,
    totalSlots: race.draftOrders.length * ROUNDS,
  };
}

export interface RaceInput {
  seasonId?: string;
  raceName: string;
  trackName: string;
  raceDate: Date;
  nascarRaceId?: number | null;
  totalLaps?: number | null;
  scoringRuleKey?: string;
}

export async function createRace(input: RaceInput): Promise<RaceSummary> {
  const seasonId = input.seasonId ?? (await prisma.season.findFirst({ where: { isCurrent: true } }))?.id;
  if (!seasonId) throw new HttpError(409, "NO_CURRENT_SEASON", "There is no current season to add the race to.");
  try {
    const race = await prisma.race.create({ data: { ...input, seasonId }, include: withEntryCount });
    return toRaceSummary(race);
  } catch (err) {
    if (isUniqueViolation(err)) throw nascarRaceIdTaken();
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") throw notFound("Season");
    throw err;
  }
}

export type RacePatch = Partial<Omit<RaceInput, "seasonId">>;

/** Metadata only; status changes go through overrideStatus or their dedicated actions. */
export async function updateRace(id: string, patch: RacePatch): Promise<RaceSummary> {
  try {
    await withRaceLock(id, async (tx, race) => {
      if (patch.scoringRuleKey !== undefined && patch.scoringRuleKey !== race.scoringRuleKey) {
        if (race.status === "COMPLETED" || race.status === "CORRECTING") {
          throw new HttpError(409, "RACE_COMPLETED", "The scoring rule can't change after the race is completed.");
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

export function isScoringRuleKey(key: string): boolean {
  return key in SCORING_RULES;
}

/** Commissioner status override (POST /races/:id/status). Only the four override reasons are accepted. */
export async function overrideStatus(
  id: string,
  reason: TransitionReason,
  actorUserId: string,
  note?: string,
): Promise<RaceSummary> {
  if (!(OVERRIDE_REASONS as readonly string[]).includes(reason)) {
    throw new HttpError(
      409,
      "OVERRIDE_NOT_ALLOWED",
      `"${reason}" can't be applied as an override; use its own action (wheel spin, complete, reopen, regenerate).`,
    );
  }
  await withRaceLock(id, (tx, race) => applyTransition(tx, race, reason, { actorUserId, note }));
  const race = await prisma.race.findUniqueOrThrow({ where: { id }, include: withEntryCount });
  return toRaceSummary(race);
}
