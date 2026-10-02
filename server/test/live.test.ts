import type { LiveView, QualifyingView } from "@dnd/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyFeed, resetPollerState, runPoller } from "../src/jobs/poller";
import { setLiveFeedCache, type NormalizedRaceFeed, type NormalizedVehicle, type SessionType } from "../src/integrations/nascarFeed";
import { importEntries } from "../src/services/entries";
import { call, hasTestDb, makeDrivers, makeRace, makeSeason, makeUser, prisma, resetDb, startServer, stopServer } from "./helpers";

const MIN = 60_000;
const NASCAR_RACE = 5630;

describe.skipIf(!hasTestDb)("live feed, qualifying, and the live page (integration)", () => {
  beforeAll(startServer);
  afterAll(stopServer);
  beforeEach(async () => {
    await resetDb();
    resetPollerState();
    setLiveFeedCache(null);
  });

  /** A race with 6 entered drivers that have NASCAR ids 9001..9006 and car numbers 1..6. */
  async function setup(data: Parameters<typeof makeRace>[1] = {}) {
    const commish = await makeUser("COMMISSIONER", "Commish");
    const season = await makeSeason();
    const race = await makeRace(season.id, { nascarRaceId: NASCAR_RACE, status: "LOCKED", raceDate: new Date(Date.now() + 10 * MIN), ...data });
    const drivers = await makeDrivers(6);
    for (const [i, d] of drivers.entries()) await prisma.driver.update({ where: { id: d.id }, data: { nascarDriverId: 9001 + i } });
    await prisma.raceEntry.createMany({ data: drivers.map((d) => ({ raceId: race.id, driverId: d.id, carNumber: d.carNumber })) });
    return { commish, season, race, drivers };
  }

  const car = (n: number, position: number, extra: Partial<NormalizedVehicle> = {}): NormalizedVehicle => ({
    nascarDriverId: 9000 + n,
    driverName: `Driver ${n}`,
    carNumber: String(n),
    runningPosition: position,
    lapsCompleted: 10,
    status: "RUNNING",
    delta: null,
    bestLapTime: null,
    bestLapSpeed: null,
    ...extra,
  });

  const feed = (sessionType: SessionType, vehicles: NormalizedVehicle[], extra: Partial<NormalizedRaceFeed> = {}): NormalizedRaceFeed => ({
    nascarRaceId: NASCAR_RACE,
    seriesId: 1,
    sessionType,
    currentLap: 10,
    totalLaps: 267,
    flagState: 1,
    vehicles,
    fetchedAt: new Date(),
    ...extra,
  });

  it("a feed for a different nascarRaceId → the poller writes nothing", async () => {
    const { race } = await setup();
    await runPoller(new Date(), async () => ({ feed: feed("race", [car(1, 1), car(2, 2)], { nascarRaceId: 1234 }), stale: false }));
    expect(await prisma.raceResult.count()).toBe(0);
    expect((await prisma.race.findUniqueOrThrow({ where: { id: race.id } })).status).toBe("LOCKED");
  });

  it("a stale (failed) fetch is never re-applied", async () => {
    await setup();
    await runPoller(new Date(), async () => ({ feed: feed("race", [car(1, 1)]), stale: true }));
    expect(await prisma.raceResult.count()).toBe(0);
  });

  it("green flag on a LOCKED race → LIVE with wentLiveAt, results written, finishPosition untouched", async () => {
    const { race } = await setup();
    await runPoller(new Date(), async () => ({ feed: feed("race", [car(1, 2), car(2, 1), car(3, 3)]), stale: false }));
    const after = await prisma.race.findUniqueOrThrow({ where: { id: race.id } });
    expect(after.status).toBe("LIVE");
    expect(after.wentLiveAt).not.toBeNull();
    expect(after.currentLap).toBe(10);
    const results = await prisma.raceResult.findMany({ where: { raceId: race.id }, orderBy: { runningPosition: "asc" } });
    expect(results.map((r) => r.runningPosition)).toEqual([1, 2, 3]);
    expect(results.every((r) => r.finishPosition === null && r.source === "feed")).toBe(true);
    const event = await prisma.draftEvent.findFirstOrThrow({ where: { type: "STATUS_CHANGED" } });
    expect(event.actorUserId).toBeNull();
  });

  it("doesn't promote more than an hour before the published start", async () => {
    const { race } = await setup({ raceDate: new Date(Date.now() + 2 * 60 * MIN) });
    await applyFeed(race.id, feed("race", [car(1, 1)]));
    expect((await prisma.race.findUniqueOrThrow({ where: { id: race.id } })).status).toBe("LOCKED");
  });

  it("checkered flag sets checkeredSeenAt once", async () => {
    const { race } = await setup({ status: "LIVE" });
    await applyFeed(race.id, feed("race", [car(1, 1)], { flagState: 4 }));
    const first = (await prisma.race.findUniqueOrThrow({ where: { id: race.id } })).checkeredSeenAt;
    expect(first).not.toBeNull();
    await applyFeed(race.id, feed("race", [car(1, 1)], { flagState: 4 }), new Date(Date.now() + 5 * MIN));
    expect((await prisma.race.findUniqueOrThrow({ where: { id: race.id } })).checkeredSeenAt).toEqual(first);
  });

  it("a CORRECTING race is never written", async () => {
    const { race, drivers } = await setup({ status: "CORRECTING" });
    await prisma.raceResult.create({ data: { raceId: race.id, driverId: drivers[0]!.id, runningPosition: 5, finishPosition: 5, source: "manual" } });
    await applyFeed(race.id, feed("race", [car(1, 1), car(2, 2)]));
    const rows = await prisma.raceResult.findMany({ where: { raceId: race.id } });
    expect(rows).toEqual([expect.objectContaining({ runningPosition: 5, finishPosition: 5 })]);
  });

  it("two qualifying polls where two drivers swap → the grid is fully replaced, no constraint error", async () => {
    const { race, drivers } = await setup({ status: "DRAFTING" });
    await applyFeed(race.id, feed("qualifying", [car(1, 1), car(2, 2), car(3, 3)]));
    await applyFeed(race.id, feed("qualifying", [car(1, 2), car(2, 1), car(3, 3)]));
    const grid = await prisma.qualifyingResult.findMany({ where: { raceId: race.id }, orderBy: { startPosition: "asc" } });
    expect(grid.map((q) => [q.driverId, q.startPosition, q.isPole])).toEqual([
      [drivers[1]!.id, 1, true],
      [drivers[0]!.id, 2, false],
      [drivers[2]!.id, 3, false],
    ]);
  });

  it("a qualifying poll when manual rows exist → no change", async () => {
    const { commish, race, drivers } = await setup({ status: "DRAFTING" });
    const res = await call<QualifyingView[]>(commish.cookie, "POST", `/races/${race.id}/qualifying`, {
      grid: [
        { driverId: drivers[2]!.id, startPosition: 1 },
        { driverId: drivers[0]!.id, startPosition: 2 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((q) => [q.carNumber, q.startPosition, q.source])).toEqual([
      ["3", 1, "manual"],
      ["1", 2, "manual"],
    ]);

    await applyFeed(race.id, feed("qualifying", [car(1, 1), car(2, 2)]));
    const grid = await call<QualifyingView[]>(commish.cookie, "GET", `/races/${race.id}/qualifying`);
    expect(grid.body.map((q) => q.carNumber)).toEqual(["3", "1"]);
  });

  it("an unknown nascarDriverId whose car number matches a hand-added entry → id backfilled, no duplicate Driver", async () => {
    const { race } = await setup({ status: "LIVE" });
    const oneOff = await prisma.driver.create({ data: { driverName: "One Off", carNumber: "66" } });
    await prisma.raceEntry.create({ data: { raceId: race.id, driverId: oneOff.id, carNumber: "66" } });
    const driversBefore = await prisma.driver.count();

    await applyFeed(race.id, feed("race", [car(1, 1), { ...car(66, 2), nascarDriverId: 7777, driverName: "Feed Name" }]));
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: oneOff.id } })).nascarDriverId).toBe(7777);
    expect(await prisma.driver.count()).toBe(driversBefore);
    expect(await prisma.raceResult.count({ where: { raceId: race.id, driverId: oneOff.id } })).toBe(1);
  });

  it("a car nobody entered still gets a Driver and a RaceResult, so it counts toward fieldSize", async () => {
    const { race } = await setup({ status: "LIVE" });
    await applyFeed(race.id, feed("race", [car(1, 1), { ...car(99, 2), nascarDriverId: 8888 }]));
    const stranger = await prisma.driver.findUniqueOrThrow({ where: { nascarDriverId: 8888 } });
    expect(await prisma.raceEntry.count({ where: { driverId: stranger.id } })).toBe(0);
    expect(await prisma.raceResult.count({ where: { raceId: race.id } })).toBe(2);
  });

  describe("GET /races/:id/live", () => {
    async function draftedRace(status: "LOCKED" | "LIVE") {
      const ctx = await setup({ status });
      const a = await makeUser("MEMBER", "Alice");
      const b = await makeUser("MEMBER", "Bob");
      await prisma.draftOrder.createMany({
        data: [
          { raceId: ctx.race.id, userId: a.user.id, pickPosition: 1 },
          { raceId: ctx.race.id, userId: b.user.id, pickPosition: 2 },
        ],
      });
      // Alice: drivers 1, 4, 5. Bob: drivers 2, 3 and an empty slot.
      const picks: [string, number][] = [[a.user.id, 0], [b.user.id, 1], [b.user.id, 2], [a.user.id, 3], [a.user.id, 4]];
      for (const [i, [userId, d]] of picks.entries()) {
        await prisma.pick.create({
          data: { raceId: ctx.race.id, userId, createdByUserId: userId, driverId: ctx.drivers[d]!.id, overallPickNumber: i + 1, roundNumber: Math.ceil((i + 1) / 2) },
        });
      }
      return { ...ctx, a, b };
    }

    it("with no QualifyingResult rows → rosters without start or change, and no throw", async () => {
      const { a, race } = await draftedRace("LOCKED");
      const res = await call<LiveView>(a.cookie, "GET", `/races/${race.id}/live`);
      expect(res.status).toBe(200);
      expect(res.body.qualifying).toEqual([]);
      expect(res.body.feed).toBeNull();
      expect(res.body.fantasyStandings).toHaveLength(2);
      const bob = res.body.fantasyStandings.find((s) => s.displayName === "Bob")!;
      expect(bob.drivers).toHaveLength(3);
      expect(bob.drivers[2]!.driverId).toBeNull();
      expect(bob.score).toBeNull();
      expect(bob.avgStart).toBeNull();
    });

    it("live: ranks rosters by current positions (empty slot = fieldSize + 1) with start and change columns", async () => {
      const { a, race } = await draftedRace("LOCKED");
      const grid = [1, 2, 3, 4, 5, 6].map((n) => car(n, n));
      await applyFeed(race.id, feed("qualifying", grid));
      await applyFeed(race.id, feed("race", [car(1, 6), car(2, 1), car(3, 2), car(4, 3), car(5, 4), car(6, 5)]));
      setLiveFeedCache(feed("race", []), true);

      const res = await call<LiveView>(a.cookie, "GET", `/races/${race.id}/live`);
      expect(res.body.race.status).toBe("LIVE");
      expect(res.body.fieldSize).toBe(6);
      expect(res.body.stale).toBe(true);
      expect(res.body.feed?.sessionType).toBe("race");
      // Alice: 6, 3, 4 → 4.33. Bob: 1, 2, empty (7) → 3.33.
      expect(res.body.fantasyStandings.map((s) => [s.displayName, s.rank])).toEqual([["Bob", 1], ["Alice", 2]]);
      expect(res.body.fantasyStandings[1]!.score).toBeCloseTo(13 / 3);
      const leader = res.body.runningOrder[0]!;
      expect(leader).toMatchObject({ carNumber: "2", position: 1, startPosition: 2, change: 1, ownerName: "Bob" });
      expect(res.body.runningOrder.find((r) => r.carNumber === "1")).toMatchObject({ startPosition: 1, change: -5 });
    });
  });

  it("entry-list import from the cacher feed adds every car, and a second import adds nothing", async () => {
    const { race } = await setup({ status: "UPCOMING" });
    const raw = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "cacher-2026-1-5630-weekend-feed-prerace-2026-10-02.json"), "utf8"));
    const first = await importEntries(race.id, async () => raw);
    expect(first.added).toBe(36);
    expect(first.entries).toHaveLength(42);
    const second = await importEntries(race.id, async () => raw);
    expect(second.added).toBe(0);
  });

  it("entry-list import without a nascarRaceId → 409; a feed failure → 502", async () => {
    const { commish, race } = await setup({ status: "UPCOMING", nascarRaceId: null });
    const res = await call(commish.cookie, "POST", `/races/${race.id}/entries/import`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_NASCAR_RACE_ID");

    await prisma.race.update({ where: { id: race.id }, data: { nascarRaceId: NASCAR_RACE } });
    await expect(
      importEntries(race.id, async () => {
        throw new Error("down");
      }),
    ).rejects.toMatchObject({ status: 502, code: "FEED_UNAVAILABLE" });
  });
});
