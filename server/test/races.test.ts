import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  call,
  draftRace,
  hasTestDb,
  makeDrivers,
  makeRace,
  makeSeason,
  makeUser,
  prisma,
  resetDb,
  startServer,
  stopServer,
} from "./helpers";

const DAY = 86_400_000;

describe.skipIf(!hasTestDb)("races & entries (integration)", () => {
  beforeAll(startServer);
  afterAll(stopServer);
  beforeEach(resetDb);

  async function setup() {
    const commish = await makeUser("COMMISSIONER", "Commish");
    const member = await makeUser("MEMBER", "Member");
    const season = await makeSeason();
    return { commish, member, season };
  }

  describe("race CRUD", () => {
    it("creates a race in the current season and lists it", async () => {
      const { commish, member } = await setup();
      const created = await call(commish.cookie, "POST", "/races", {
        raceName: "YellaWood 500",
        trackName: "Talladega Superspeedway",
        raceDate: "2026-10-18T18:00:00.000Z",
        nascarRaceId: 5630,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ status: "UPCOMING", raceDate: "2026-10-18T18:00:00.000Z", entryCount: 0 });

      const list = await call(member.cookie, "GET", "/races");
      expect(list.body.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
    });

    it("members can read races but not create them", async () => {
      const { member } = await setup();
      const res = await call(member.cookie, "POST", "/races", {
        raceName: "X",
        trackName: "Y",
        raceDate: "2026-10-18T18:00:00Z",
      });
      expect(res.status).toBe(403);
    });

    it("a duplicate nascarRaceId is a 409", async () => {
      const { commish, season } = await setup();
      await makeRace(season.id, { nascarRaceId: 1 });
      const other = await makeRace(season.id);
      const res = await call(commish.cookie, "PATCH", `/races/${other.id}`, { nascarRaceId: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NASCAR_RACE_ID_TAKEN");
    });

    it("PATCH cannot set status", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id);
      const res = await call(commish.cookie, "PATCH", `/races/${race.id}`, { status: "LIVE" });
      expect(res.status).toBe(400);
      expect((await prisma.race.findUniqueOrThrow({ where: { id: race.id } })).status).toBe("UPCOMING");
    });

    it("changing raceDate clears deadline_warning and draft_closed notification rows only", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id, { status: "LOCKED" });
      for (const kind of ["deadline_warning", "draft_closed", "on_the_clock"]) {
        await prisma.notificationLog.create({ data: { raceId: race.id, channel: "discord", kind } });
      }
      const newDate = new Date(race.raceDate.getTime() + DAY).toISOString();
      const res = await call(commish.cookie, "PATCH", `/races/${race.id}`, { raceDate: newDate });
      expect(res.status).toBe(200);
      const kinds = (await prisma.notificationLog.findMany({ where: { raceId: race.id } })).map((n) => n.kind);
      expect(kinds).toEqual(["on_the_clock"]);
    });

    it("scoringRuleKey: unknown key is 400, and it can't change once COMPLETED", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id, { status: "COMPLETED" });
      expect((await call(commish.cookie, "PATCH", `/races/${race.id}`, { scoringRuleKey: "nope" })).status).toBe(400);
      await prisma.race.update({ where: { id: race.id }, data: { scoringRuleKey: "legacy" } });
      const res = await call(commish.cookie, "PATCH", `/races/${race.id}`, { scoringRuleKey: "average_finish" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RACE_COMPLETED");
    });

    it("GET /races/current returns the active race", async () => {
      const { member, season } = await setup();
      await makeRace(season.id, { raceName: "Later", raceDate: new Date(Date.now() + 10 * DAY) });
      const drafting = await makeRace(season.id, { raceName: "This week", status: "DRAFTING" });
      const res = await call(member.cookie, "GET", "/races/current");
      expect(res.body.id).toBe(drafting.id);
    });
  });

  describe("status override", () => {
    it("a disallowed transition (LOCKED → COMPLETED) is 409 and changes nothing", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id, { status: "LOCKED" });
      const res = await call(commish.cookie, "POST", `/races/${race.id}/status`, { reason: "completed" });
      expect(res.status).toBe(409);
      expect((await prisma.race.findUniqueOrThrow({ where: { id: race.id } })).status).toBe("LOCKED");
      expect(await prisma.draftEvent.count()).toBe(0);
    });

    it("green_flag sets wentLiveAt and logs STATUS_CHANGED with the actor and note", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id, { status: "LOCKED" });
      const res = await call(commish.cookie, "POST", `/races/${race.id}/status`, {
        reason: "green_flag",
        note: "feed is down",
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("LIVE");
      expect(res.body.wentLiveAt).not.toBeNull();

      const [event] = await prisma.draftEvent.findMany({ where: { raceId: race.id } });
      expect(event).toMatchObject({ type: "STATUS_CHANGED", actorUserId: commish.user.id });
      expect(event!.payload).toMatchObject({ from: "LOCKED", to: "LIVE", reason: "green_flag", note: "feed is down" });
    });

    it("draft_reopened on a race that went LIVE then false_start → 409", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id, { status: "LOCKED" });
      const status = (reason: string) => call(commish.cookie, "POST", `/races/${race.id}/status`, { reason });

      expect((await status("green_flag")).status).toBe(200);
      expect((await status("false_start")).body.status).toBe("LOCKED");
      const reopen = await status("draft_reopened");
      expect(reopen.status).toBe(409);
      expect(reopen.body.code).toBe("INVALID_TRANSITION");
    });

    it("draft_reopened deletes the draft_closed notification row", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id, { status: "LOCKED" });
      await prisma.notificationLog.create({ data: { raceId: race.id, channel: "discord", kind: "draft_closed" } });
      const res = await call(commish.cookie, "POST", `/races/${race.id}/status`, { reason: "draft_reopened" });
      expect(res.body.status).toBe("DRAFTING");
      expect(await prisma.notificationLog.count({ where: { raceId: race.id } })).toBe(0);
    });

    it("members can't override status", async () => {
      const { member, season } = await setup();
      const race = await makeRace(season.id, { status: "LOCKED" });
      expect((await call(member.cookie, "POST", `/races/${race.id}/status`, { reason: "green_flag" })).status).toBe(403);
    });

    it("the race lock serializes concurrent overrides: one wins, one gets 409", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id, { status: "LOCKED" });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => call(commish.cookie, "POST", `/races/${race.id}/status`, { reason: "green_flag" })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
      expect(await prisma.draftEvent.count({ where: { raceId: race.id } })).toBe(1);
    });

    it("unknown race is 404", async () => {
      const { commish } = await setup();
      const res = await call(commish.cookie, "POST", `/races/00000000-0000-4000-8000-000000000000/status`, {
        reason: "green_flag",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("entries", () => {
    it("adds existing drivers (skipping duplicates) and a new hand-added driver", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id);
      const [d1, d2] = await makeDrivers(2);

      await call(commish.cookie, "POST", `/races/${race.id}/entries`, { driverIds: [d1!.id] });
      const res = await call(commish.cookie, "POST", `/races/${race.id}/entries`, { driverIds: [d1!.id, d2!.id] });
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(2);

      const added = await call(commish.cookie, "POST", `/races/${race.id}/entries`, {
        newDriver: { driverName: "One Off", carNumber: "66" },
      });
      expect(added.body.map((e: { driverName: string }) => e.driverName)).toContain("One Off");
      const oneOff = await prisma.driver.findFirstOrThrow({ where: { driverName: "One Off" } });
      expect(oneOff.nascarDriverId).toBeNull();
    });

    it("copy-from copies the source race's eligible entries and skips ones already entered", async () => {
      const { commish, season } = await setup();
      const last = await makeRace(season.id, { raceDate: new Date(Date.now() - 4 * DAY) });
      const next = await makeRace(season.id);
      const [d1, d2, d3] = await makeDrivers(3);
      await prisma.raceEntry.createMany({
        data: [
          { raceId: last.id, driverId: d1!.id, carNumber: "1" },
          { raceId: last.id, driverId: d2!.id, carNumber: "2" },
          { raceId: last.id, driverId: d3!.id, carNumber: "3", isEligible: false },
          { raceId: next.id, driverId: d1!.id, carNumber: "1" },
        ],
      });
      const res = await call(commish.cookie, "POST", `/races/${next.id}/entries/copy-from`, { sourceRaceId: last.id });
      expect(res.status).toBe(200);
      expect(res.body.map((e: { carNumber: string }) => e.carNumber)).toEqual(["1", "2"]);
    });

    it("deleting a drafted entry is 409; marking it ineligible warns", async () => {
      const { commish, member, season } = await setup();
      const race = await makeRace(season.id, { status: "DRAFTING" });
      const [d1] = await makeDrivers(1);
      const entry = await prisma.raceEntry.create({ data: { raceId: race.id, driverId: d1!.id, carNumber: "1" } });
      await draftRace(race.id, [member.user.id], [[member.user.id, d1!.id]]);

      const del = await call(commish.cookie, "DELETE", `/races/${race.id}/entries/${entry.id}`);
      expect(del.status).toBe(409);
      expect(del.body.code).toBe("ENTRY_DRAFTED");

      const patch = await call(commish.cookie, "PATCH", `/races/${race.id}/entries/${entry.id}`, { isEligible: false });
      expect(patch.status).toBe(200);
      expect(patch.body.entry).toMatchObject({ isEligible: false, isDrafted: true });
      expect(patch.body.warning).toMatch(/already drafted/);
    });

    it("deleting an undrafted entry works", async () => {
      const { commish, season } = await setup();
      const race = await makeRace(season.id);
      const [d1] = await makeDrivers(1);
      const entry = await prisma.raceEntry.create({ data: { raceId: race.id, driverId: d1!.id, carNumber: "1" } });
      expect((await call(commish.cookie, "DELETE", `/races/${race.id}/entries/${entry.id}`)).status).toBe(204);
      expect(await prisma.raceEntry.count()).toBe(0);
    });

    it("an entry from another race is 404", async () => {
      const { commish, season } = await setup();
      const a = await makeRace(season.id);
      const b = await makeRace(season.id);
      const [d1] = await makeDrivers(1);
      const entry = await prisma.raceEntry.create({ data: { raceId: a.id, driverId: d1!.id, carNumber: "1" } });
      expect((await call(commish.cookie, "DELETE", `/races/${b.id}/entries/${entry.id}`)).status).toBe(404);
    });
  });
});
