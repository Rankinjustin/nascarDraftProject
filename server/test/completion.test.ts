import type { HistoryWeek, SeasonStats, StandingsView, WeeklyResultView } from "@dnd/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSweeper } from "../src/jobs/sweeper";
import { applyFeed } from "../src/jobs/poller";
import { setChannels, settleNotifications } from "../src/notifications/notify";
import {
  call,
  fakeChannel,
  hasTestDb,
  makeDrivers,
  makeRace,
  makeSeason,
  makeUser,
  ofKind,
  prisma,
  resetDb,
  startServer,
  stopServer,
} from "./helpers";

const HOUR = 3_600_000;

describe.skipIf(!hasTestDb)("completion, corrections, history, and season stats (integration)", () => {
  let push: ReturnType<typeof fakeChannel>;

  beforeAll(startServer);
  afterAll(stopServer);
  beforeEach(async () => {
    await settleNotifications();
    await resetDb();
    push = fakeChannel();
    setChannels([push]);
  });

  /**
   * Two drafters over 10 entered drivers (car numbers 1–10, NASCAR ids 9001–9010).
   * rosters: car numbers per user, in pick order; a roster shorter than 3 leaves empty slots.
   */
  async function setup({
    status = "LIVE",
    rosters = [[1, 4, 5], [2, 3, 6]] as number[][],
    seasonId,
  }: { status?: "LIVE" | "LOCKED"; rosters?: number[][]; seasonId?: string } = {}) {
    const commish = await makeUser("COMMISSIONER", "Commish");
    const players = [];
    for (let i = 0; i < rosters.length; i++) players.push(await makeUser("MEMBER", `Player ${String.fromCharCode(65 + i)}`));
    const season = seasonId ? await prisma.season.findUniqueOrThrow({ where: { id: seasonId } }) : await makeSeason();
    const race = await makeRace(season.id, {
      status,
      nascarRaceId: 5630,
      raceDate: new Date(Date.now() - HOUR),
      ...(status === "LIVE" ? { wentLiveAt: new Date(Date.now() - HOUR) } : {}),
    });
    const existing = await prisma.driver.findMany({ orderBy: { carNumber: "asc" } });
    const drivers = existing.length ? existing.sort((a, b) => Number(a.carNumber) - Number(b.carNumber)) : await makeDrivers(10);
    if (!existing.length) {
      for (const [i, d] of drivers.entries()) await prisma.driver.update({ where: { id: d.id }, data: { nascarDriverId: 9001 + i } });
    }
    await prisma.raceEntry.createMany({ data: drivers.map((d) => ({ raceId: race.id, driverId: d.id, carNumber: d.carNumber })) });
    await prisma.draftOrder.createMany({ data: players.map((p, i) => ({ raceId: race.id, userId: p.user.id, pickPosition: i + 1 })) });
    let n = 0;
    for (let round = 0; round < 3; round++) {
      for (const [i, p] of players.entries()) {
        const carNo = rosters[i]![round];
        n += 1;
        if (carNo === undefined) continue;
        await prisma.pick.create({
          data: {
            raceId: race.id,
            userId: p.user.id,
            createdByUserId: p.user.id,
            driverId: drivers[carNo - 1]!.id,
            overallPickNumber: n,
            roundNumber: round + 1,
          },
        });
      }
    }
    // Picks must stay contiguous; renumber in case a roster had gaps.
    const picks = await prisma.pick.findMany({ where: { raceId: race.id }, orderBy: { overallPickNumber: "asc" } });
    for (const [i, p] of picks.entries()) await prisma.pick.update({ where: { id: p.id }, data: { overallPickNumber: 100 + i } });
    for (const [i, p] of picks.entries()) await prisma.pick.update({ where: { id: p.id }, data: { overallPickNumber: i + 1 } });
    return { commish, players, season, race, drivers };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** Running order: car numbers in finishing order. */
  async function runningOrder(ctx: Ctx, cars: number[]) {
    await prisma.raceResult.createMany({
      data: cars.map((c, i) => ({ raceId: ctx.race.id, driverId: ctx.drivers[c - 1]!.id, runningPosition: i + 1 })),
    });
  }

  const complete = (ctx: Ctx) => call<WeeklyResultView[]>(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/complete`);
  const scoreOf = (rows: WeeklyResultView[], name: string) => rows.find((r) => r.displayName === name)!;

  it("complete → finishPosition frozen, WeeklyResult scores and ranks, results_posted to the league", async () => {
    const ctx = await setup();
    await runningOrder(ctx, [2, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
    const res = await complete(ctx);
    expect(res.status).toBe(200);
    // A: cars 1,4,5 → 2,4,5 = 3.67. B: cars 2,3,6 → 1,3,6 = 3.33.
    expect(scoreOf(res.body, "Player B")).toMatchObject({ rank: 1, fieldSize: 10 });
    expect(scoreOf(res.body, "Player B").score).toBeCloseTo(10 / 3);
    expect(scoreOf(res.body, "Player A")).toMatchObject({ rank: 2 });
    expect(scoreOf(res.body, "Player A").driverFinishes.map((d) => d.finishPosition)).toEqual([2, 4, 5]);

    const race = await prisma.race.findUniqueOrThrow({ where: { id: ctx.race.id } });
    expect(race.status).toBe("COMPLETED");
    expect(race.completedAt).not.toBeNull();
    expect(await prisma.raceResult.count({ where: { raceId: ctx.race.id, finishPosition: null } })).toBe(0);
    await settleNotifications();
    expect(ofKind(push.sent, "results_posted")).toHaveLength(3);
    expect(ofKind(push.sent, "results_posted")[0]!.url).toBe(`/live/${ctx.race.id}`);
  });

  it("a draft that closed with 2 empty slots → those slots score fieldSize + 1, no throw", async () => {
    const ctx = await setup({ rosters: [[1, 4, 5], [2]] });
    await runningOrder(ctx, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const res = await complete(ctx);
    expect(res.status).toBe(200);
    const b = scoreOf(res.body, "Player B");
    expect(b.score).toBeCloseTo((2 + 11 + 11) / 3);
    expect(b.driverFinishes.map((d) => d.driverName)).toEqual(["Driver 2", "No pick", "No pick"]);
  });

  it("a drafted driver with no RaceResult row → scores fieldSize + 1, no throw", async () => {
    const ctx = await setup();
    // Car 6 (Player B's) never appeared in the feed.
    await runningOrder(ctx, [1, 2, 3, 4, 5, 7, 8, 9, 10]);
    const res = await complete(ctx);
    expect(res.status).toBe(200);
    expect(scoreOf(res.body, "Player B").driverFinishes.at(-1)!.finishPosition).toBeNull();
    expect(scoreOf(res.body, "Player B").score).toBeCloseTo((2 + 3 + 10) / 3);
  });

  it("complete → reopen → patch → poller tick → re-complete: the patch survives, the poller wrote nothing", async () => {
    const ctx = await setup();
    await runningOrder(ctx, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await complete(ctx);
    await settleNotifications();

    expect((await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/reopen`)).status).toBe(204);
    expect(await prisma.weeklyResult.count({ where: { raceId: ctx.race.id } })).toBe(0);

    // A DQ: car 1 (Player A) is moved from 1st to 10th.
    const patched = await call(ctx.commish.cookie, "PATCH", `/races/${ctx.race.id}/results`, {
      results: [{ driverId: ctx.drivers[0]!.id, finishPosition: 10 }],
    });
    expect(patched.status).toBe(200);

    await applyFeed(ctx.race.id, {
      nascarRaceId: 5630,
      seriesId: 1,
      sessionType: "race",
      currentLap: 1,
      totalLaps: 267,
      flagState: 1,
      vehicles: [{ nascarDriverId: 9001, driverName: "Driver 1", carNumber: "1", runningPosition: 1, lapsCompleted: 1, status: "RUNNING", delta: null, bestLapTime: null, bestLapSpeed: null }],
      fetchedAt: new Date(),
    });
    const car1 = await prisma.raceResult.findFirstOrThrow({ where: { raceId: ctx.race.id, driverId: ctx.drivers[0]!.id } });
    expect(car1).toMatchObject({ finishPosition: 10, runningPosition: 1, lapsCompleted: 0 });

    const res = await complete(ctx);
    expect(res.status).toBe(200);
    expect(scoreOf(res.body, "Player A").driverFinishes[0]!.finishPosition).toBe(10);
    expect(scoreOf(res.body, "Player A").score).toBeCloseTo((10 + 4 + 5) / 3);
    expect(await prisma.draftEvent.count({ where: { type: "RESULTS_CORRECTED" } })).toBe(1);

    // results_posted is deduped: the re-completion doesn't re-announce.
    await settleNotifications();
    expect(ofKind(push.sent, "results_posted")).toHaveLength(3);
  });

  it("no RaceResult rows → green_flag override, PUT the pasted order, complete → correct scores", async () => {
    const ctx = await setup({ status: "LOCKED" });
    const green = await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/status`, { reason: "green_flag" });
    expect(green.body.status).toBe("LIVE");

    const order = [6, 5, 4, 3, 2, 1, 7, 8, 9, 10];
    const put = await call(ctx.commish.cookie, "PUT", `/races/${ctx.race.id}/results`, {
      results: order.map((c, i) => ({ driverId: ctx.drivers[c - 1]!.id, finishPosition: i + 1 })),
    });
    expect(put.status).toBe(200);
    expect(await prisma.raceResult.count({ where: { raceId: ctx.race.id, source: "manual" } })).toBe(10);

    const res = await complete(ctx);
    // A: cars 1,4,5 → 6,3,2 = 3.67. B: cars 2,3,6 → 5,4,1 = 3.33.
    expect(scoreOf(res.body, "Player B").rank).toBe(1);
    expect(scoreOf(res.body, "Player A").score).toBeCloseTo(11 / 3);
  });

  it("PATCH for a drafted driver with no row → row created, driver scored at the patched position", async () => {
    const ctx = await setup();
    await runningOrder(ctx, [1, 2, 3, 4, 5, 7, 8, 9, 10]);
    await call(ctx.commish.cookie, "PATCH", `/races/${ctx.race.id}/results`, {
      results: [{ driverId: ctx.drivers[5]!.id, finishPosition: 10 }],
    });
    const row = await prisma.raceResult.findFirstOrThrow({ where: { raceId: ctx.race.id, driverId: ctx.drivers[5]!.id } });
    expect(row).toMatchObject({ finishPosition: 10, runningPosition: 10, source: "manual" });
    const res = await complete(ctx);
    expect(scoreOf(res.body, "Player B").driverFinishes.at(-1)!.finishPosition).toBe(10);
  });

  it("complete, results entry, and reopen refuse the wrong statuses", async () => {
    const ctx = await setup({ status: "LOCKED" });
    expect((await complete(ctx)).status).toBe(409);
    const put = await call(ctx.commish.cookie, "PUT", `/races/${ctx.race.id}/results`, {
      results: [{ driverId: ctx.drivers[0]!.id, finishPosition: 1 }],
    });
    expect(put.status).toBe(409);
    expect((await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/reopen`)).status).toBe(409);
    expect((await call(ctx.players[0]!.cookie, "POST", `/races/${ctx.race.id}/complete`)).status).toBe(403);
  });

  it("LIVE with checkeredSeenAt 61 minutes ago → one complete_reminder per commissioner; a second sweep sends nothing", async () => {
    const ctx = await setup();
    const second = await makeUser("COMMISSIONER", "Backup Commish");
    await prisma.race.update({ where: { id: ctx.race.id }, data: { checkeredSeenAt: new Date(Date.now() - 61 * 60_000) } });
    await runSweeper();
    await runSweeper();
    const reminders = ofKind(push.sent, "complete_reminder");
    expect(reminders.map((p) => p.userId).sort()).toEqual([ctx.commish.user.id, second.user.id].sort());
    expect(reminders.every((p) => p.overallPickNumber === 1 && p.url === `/admin/races/${ctx.race.id}`)).toBe(true);
  });

  it("no reminder before an hour past the checkered", async () => {
    const ctx = await setup();
    await prisma.race.update({ where: { id: ctx.race.id }, data: { checkeredSeenAt: new Date(Date.now() - 30 * 60_000) } });
    await runSweeper();
    expect(ofKind(push.sent, "complete_reminder")).toHaveLength(0);
  });

  it("the follow-up reminder fires the next morning", async () => {
    const ctx = await setup();
    await prisma.race.update({ where: { id: ctx.race.id }, data: { checkeredSeenAt: new Date(Date.now() - 2 * HOUR) } });
    await runSweeper(new Date(Date.now() + 2 * 24 * HOUR));
    expect(ofKind(push.sent, "complete_reminder").map((p) => p.overallPickNumber).sort()).toEqual([1, 2]);
  });

  it("two users tied at the best score → both rank 1, and both count as a weekly win in season stats", async () => {
    const ctx = await setup();
    // Car 7 (undrafted) runs 4th. A: cars 1,4,5 → 1,5,6 = 4. B: cars 2,3,6 → 2,3,7 = 4.
    await runningOrder(ctx, [1, 2, 3, 7, 4, 5, 6, 8, 9, 10]);
    const res = await complete(ctx);
    expect(res.body.map((r) => [r.rank, r.score])).toEqual([
      [1, 4],
      [1, 4],
    ]);

    const stats = await call<SeasonStats>(ctx.commish.cookie, "GET", `/seasons/${ctx.season.id}/stats`);
    expect(stats.status).toBe(200);
    expect(stats.body.weeksCompleted).toBe(1);
    expect(stats.body.users.map((u) => u.wins)).toEqual([1, 1]);
  });

  it("season stats: wins, averages, best and worst weeks, top-10 rate, most-drafted", async () => {
    const week1 = await setup();
    await runningOrder(week1, [2, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
    await complete(week1);

    const commish2 = await makeUser("COMMISSIONER", "Commish 2");
    const race2 = await makeRace(week1.season.id, { status: "LIVE", nascarRaceId: null, raceDate: new Date(Date.now() - 2 * HOUR) });
    await prisma.raceEntry.createMany({ data: week1.drivers.map((d) => ({ raceId: race2.id, driverId: d.id, carNumber: d.carNumber })) });
    const [a, b] = week1.players;
    await prisma.draftOrder.createMany({
      data: [
        { raceId: race2.id, userId: a!.user.id, pickPosition: 1 },
        { raceId: race2.id, userId: b!.user.id, pickPosition: 2 },
      ],
    });
    // Week 2: A drafts cars 1, 9, 10; B drafts car 2 only.
    const week2Picks: [string, number][] = [[a!.user.id, 1], [b!.user.id, 2], [a!.user.id, 9], [a!.user.id, 10]];
    for (const [i, [userId, carNo]] of week2Picks.entries()) {
      await prisma.pick.create({
        data: { raceId: race2.id, userId, createdByUserId: userId, driverId: week1.drivers[carNo - 1]!.id, overallPickNumber: i + 1, roundNumber: 1 },
      });
    }
    await prisma.raceResult.createMany({
      data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => ({ raceId: race2.id, driverId: week1.drivers[c - 1]!.id, runningPosition: c })),
    });
    // A: 1, 9, 10 = 6.67. B: 2, 11, 11 = 8 → A wins week 2.
    await call(commish2.cookie, "POST", `/races/${race2.id}/complete`);

    const { body } = await call<SeasonStats>(commish2.cookie, "GET", `/seasons/${week1.season.id}/stats`);
    expect(body.weeksCompleted).toBe(2);
    const A = body.users.find((u) => u.displayName === "Player A")!;
    const B = body.users.find((u) => u.displayName === "Player B")!;
    expect([A.wins, B.wins]).toEqual([1, 1]);
    expect(A.weeksPlayed).toBe(2);
    expect(A.avgScore).toBeCloseTo((11 / 3 + 20 / 3) / 2);
    expect(A.bestWeek?.raceName).toBe("Test 400");
    expect(A.bestWeek?.score).toBeCloseTo(11 / 3);
    expect(A.worstWeek?.score).toBeCloseTo(20 / 3);
    // A drafted 6 drivers, all finishing top 10. B drafted 4: 1, 3, 6, then 2.
    expect(A.top10Rate).toBe(1);
    expect(B.driversDrafted).toBe(4);
    expect(body.mostDrafted[0]).toMatchObject({ timesDrafted: 2 });
  });

  it("standings are the live projection before completion and the frozen week after; history lists completed weeks", async () => {
    const ctx = await setup();
    await runningOrder(ctx, [2, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
    const before = await call<StandingsView>(ctx.players[0]!.cookie, "GET", `/races/${ctx.race.id}/standings`);
    expect(before.body.final).toBe(false);

    await complete(ctx);
    const after = await call<StandingsView>(ctx.players[0]!.cookie, "GET", `/races/${ctx.race.id}/standings`);
    expect(after.body.final).toBe(true);

    const history = await call<HistoryWeek[]>(ctx.players[0]!.cookie, "GET", "/races/history");
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]!.results.filter((r) => r.rank === 1).map((r) => r.displayName)).toEqual(["Player B"]);
  });
});
