import type { User, WeeklyResult } from "@prisma/client";
import {
  ROUNDS,
  SCORING_RULES,
  rankEntries,
  type DriverFinish,
  type HistoryWeek,
  type ResultInput,
  type StandingsView,
  type UserEntry,
  type WeeklyResultView,
} from "@dnd/shared";
import { prisma } from "../db";
import { HttpError, notFound } from "../errors";
import { dispatchAfterCommit } from "../notifications/notify";
import { withRaceLock, type Tx } from "../races/lock";
import { applyTransition } from "../races/transition";
import { getLiveView } from "./live";
import { toRaceSummary } from "./races";
import { fieldSizeFor } from "./scoring";

const notLiveOrCorrecting = () =>
  new HttpError(409, "RACE_NOT_EDITABLE", "Results can only be entered while the race is live or reopened for corrections.");

/**
 * POST /races/:id/complete (SPEC Section 8): freezes finish positions and snapshots the week.
 * A re-completion after a correction only fills finish positions that are still empty, so hand fixes survive.
 */
export async function completeRace(raceId: string, actor: User, now = new Date()): Promise<WeeklyResultView[]> {
  await withRaceLock(raceId, async (tx, race) => {
    if (race.status !== "LIVE" && race.status !== "CORRECTING") {
      throw new HttpError(409, "RACE_NOT_COMPLETABLE", "Only a live race, or one reopened for corrections, can be completed.");
    }

    // 2. runningPosition → finishPosition, only where it's still null.
    await tx.$executeRaw`
      UPDATE "RaceResult" SET "finishPosition" = "runningPosition", "updatedAt" = now()
      WHERE "raceId" = ${raceId} AND "finishPosition" IS NULL`;

    // 3–5. Score every drafter. Left join: a drafted driver with no result row arrives as null; empty slots are padded.
    const fieldSize = await fieldSizeFor(tx, raceId);
    const order = await tx.draftOrder.findMany({ where: { raceId }, include: { user: true }, orderBy: { pickPosition: "asc" } });
    const picks = await tx.pick.findMany({ where: { raceId }, orderBy: { overallPickNumber: "asc" }, include: { driver: true } });
    const results = await tx.raceResult.findMany({ where: { raceId } });
    const entries = await tx.raceEntry.findMany({ where: { raceId } });
    const finishByDriver = new Map(results.map((r) => [r.driverId, r.finishPosition]));
    const carByDriver = new Map(entries.map((e) => [e.driverId, e.carNumber]));

    const rosters = order.map((o) => {
      const mine = picks.filter((p) => p.userId === o.userId);
      const finishes: DriverFinish[] = Array.from({ length: ROUNDS }, (_, i) => {
        const pick = mine[i];
        if (!pick) return { driverId: null, driverName: "No pick", carNumber: null, finishPosition: null };
        return {
          driverId: pick.driverId,
          driverName: pick.driver.driverName,
          carNumber: carByDriver.get(pick.driverId) ?? pick.driver.carNumber,
          finishPosition: finishByDriver.get(pick.driverId) ?? null,
        };
      });
      return { userId: o.userId, finishes };
    });

    const rule = SCORING_RULES[race.scoringRuleKey] ?? SCORING_RULES.average_finish!;
    const userEntries: UserEntry[] = rosters.map((r) => ({
      userId: r.userId,
      drivers: r.finishes.map((f) => ({ driverId: f.driverId, finishPosition: f.finishPosition })),
    }));
    const ranked = new Map(rankEntries(userEntries, rule, { fieldSize }).map((r) => [r.userId, r]));

    // 6. The frozen snapshot. Season stats read only from here.
    await tx.weeklyResult.deleteMany({ where: { raceId } });
    await tx.weeklyResult.createMany({
      data: rosters.map((r) => ({
        raceId,
        userId: r.userId,
        score: ranked.get(r.userId)!.score,
        rank: ranked.get(r.userId)!.rank,
        scoringRuleKey: race.scoringRuleKey,
        fieldSize,
        driverFinishes: r.finishes as unknown as object[],
      })),
    });

    // 7.
    await tx.race.update({ where: { id: raceId }, data: { completedAt: now } });
    await applyTransition(tx, race, "completed", { actorUserId: actor.id, now });
  });

  // Deduped by the ledger, so a re-completion after a correction doesn't re-announce.
  dispatchAfterCommit([{ raceId, kind: "results_posted", overallPickNumber: 0, to: "league" }]);
  return weeklyResults(prisma, raceId);
}

/** POST /races/:id/reopen — COMPLETED → CORRECTING. The poller ignores CORRECTING races. */
export async function reopenRace(raceId: string, actor: User, note?: string): Promise<void> {
  await withRaceLock(raceId, async (tx, race) => {
    await applyTransition(tx, race, "reopened", { actorUserId: actor.id, note });
    await tx.weeklyResult.deleteMany({ where: { raceId } });
  });
}

async function writeResults(raceId: string, actor: User, rows: ResultInput[], mode: "replace" | "patch") {
  if (new Set(rows.map((r) => r.driverId)).size !== rows.length) {
    throw new HttpError(400, "DUPLICATE_DRIVER", "A driver appears twice in the results.");
  }
  if (mode === "replace" && new Set(rows.map((r) => r.finishPosition)).size !== rows.length) {
    throw new HttpError(400, "DUPLICATE_POSITION", "Two drivers have the same finishing position.");
  }
  await withRaceLock(raceId, async (tx, race) => {
    if (race.status !== "LIVE" && race.status !== "CORRECTING") throw notLiveOrCorrecting();
    const drivers = await tx.driver.findMany({ where: { id: { in: rows.map((r) => r.driverId) } } });
    if (drivers.length !== rows.length) throw notFound("Driver");
    const nameById = new Map(drivers.map((d) => [d.id, d.driverName]));
    const before = new Map(
      (await tx.raceResult.findMany({ where: { raceId, driverId: { in: rows.map((r) => r.driverId) } } })).map((r) => [r.driverId, r]),
    );

    // Upserts: a driver who never appeared in the feed gets a row (source "manual") and is scored at that position.
    for (const row of rows) {
      const existing = before.get(row.driverId);
      const extra = { ...(row.lapsCompleted !== undefined ? { lapsCompleted: row.lapsCompleted } : {}), ...(row.status ? { status: row.status } : {}) };
      await tx.raceResult.upsert({
        where: { raceId_driverId: { raceId, driverId: row.driverId } },
        create: { raceId, driverId: row.driverId, runningPosition: row.finishPosition, finishPosition: row.finishPosition, source: "manual", ...extra },
        update: {
          finishPosition: row.finishPosition,
          // A full re-order is the new running order too; a single fix leaves the live position alone.
          ...(mode === "replace" || !existing ? { runningPosition: row.finishPosition, source: "manual" } : {}),
          ...extra,
        },
      });
    }

    await tx.draftEvent.create({
      data: {
        raceId,
        actorUserId: actor.id,
        type: "RESULTS_CORRECTED",
        payload: {
          mode,
          changes: rows.map((r) => ({
            driverId: r.driverId,
            driverName: nameById.get(r.driverId),
            before: before.get(r.driverId)?.finishPosition ?? null,
            after: r.finishPosition,
          })),
        },
      },
    });
  });
}

/** PUT /races/:id/results — the full finishing order by hand (feed down, no nascarRaceId, missing drivers). */
export const replaceResults = (raceId: string, actor: User, rows: ResultInput[]) => writeResults(raceId, actor, rows, "replace");
/** PATCH /races/:id/results — individual fixes, creating rows that don't exist. */
export const patchResults = (raceId: string, actor: User, rows: ResultInput[]) => writeResults(raceId, actor, rows, "patch");

type WithUser = WeeklyResult & { user: { displayName: string } };

function toWeeklyView(w: WithUser): WeeklyResultView {
  return {
    userId: w.userId,
    displayName: w.user.displayName,
    score: w.score,
    rank: w.rank,
    scoringRuleKey: w.scoringRuleKey,
    fieldSize: w.fieldSize,
    driverFinishes: w.driverFinishes as unknown as DriverFinish[],
  };
}

async function weeklyResults(db: Tx | typeof prisma, raceId: string): Promise<WeeklyResultView[]> {
  const rows = await db.weeklyResult.findMany({
    where: { raceId },
    include: { user: true },
    orderBy: [{ rank: "asc" }, { user: { displayName: "asc" } }],
  });
  return rows.map(toWeeklyView);
}

/** GET /races/:id/standings — the frozen week once completed, otherwise the live projection. */
export async function getStandings(raceId: string): Promise<StandingsView> {
  const race = await prisma.race.findUnique({ where: { id: raceId }, select: { status: true } });
  if (!race) throw notFound("Race");
  if (race.status === "COMPLETED") return { final: true, results: await weeklyResults(prisma, raceId) };
  return { final: false, projected: (await getLiveView(raceId)).fantasyStandings };
}

/** Completed weeks, newest first, each with its frozen results. */
export async function listHistory(seasonId?: string): Promise<HistoryWeek[]> {
  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId } })
    : await prisma.season.findFirst({ where: { isCurrent: true } });
  if (!season) return [];
  const races = await prisma.race.findMany({
    where: { seasonId: season.id, status: "COMPLETED" },
    orderBy: { raceDate: "desc" },
    include: {
      _count: { select: { entries: true } },
      weeklyResults: { include: { user: true }, orderBy: [{ rank: "asc" }, { user: { displayName: "asc" } }] },
    },
  });
  return races.map((r) => ({ race: toRaceSummary(r), results: r.weeklyResults.map(toWeeklyView) }));
}
