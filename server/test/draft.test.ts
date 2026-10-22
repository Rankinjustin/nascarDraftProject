import type { DraftState } from "@dnd/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runDeadlineJob } from "../src/jobs/deadline";
import { runSweeper } from "../src/jobs/sweeper";
import { notify, setChannels, settleNotifications } from "../src/notifications/notify";
import { env } from "../src/env";
import {
  call,
  enterDrivers,
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
const DAY = 24 * HOUR;


describe.skipIf(!hasTestDb)("draft (integration)", () => {
  let push: ReturnType<typeof fakeChannel>;

  beforeAll(startServer);
  afterAll(stopServer);
  beforeEach(async () => {
    await settleNotifications();
    await resetDb();
    push = fakeChannel();
    setChannels([push]);
  });

  async function setup({ players = 3, drivers = 12, raceDate }: { players?: number; drivers?: number; raceDate?: Date } = {}) {
    const commish = await makeUser("COMMISSIONER", "Commish");
    const members = [];
    for (let i = 2; i <= players; i++) members.push(await makeUser("MEMBER", `Player ${i}`));
    const everyone = [commish, ...members];
    const season = await makeSeason();
    const race = await makeRace(season.id, raceDate ? { raceDate } : {});
    const ds = await makeDrivers(drivers);
    await enterDrivers(race.id, ds);
    return { commish, members, everyone, race, drivers: ds };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const cookieFor = (ctx: Ctx, userId: string) => ctx.everyone.find((u) => u.user.id === userId)!.cookie;
  const getState = async (ctx: Ctx) => (await call<DraftState>(ctx.commish.cookie, "GET", `/races/${ctx.race.id}/draft`)).body;

  async function spin(ctx: Ctx): Promise<DraftState> {
    const res = await call<DraftState>(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft-order`);
    expect(res.status).toBe(201);
    return res.body;
  }

  /** The user on the clock picks the first available driver. */
  async function pickNext(ctx: Ctx, state: DraftState, driverIndex = 0) {
    // Untyped body: a DraftState on success, { code, message } on refusal.
    return call(cookieFor(ctx, state.onTheClock!.userId), "POST", `/races/${ctx.race.id}/picks`, {
      driverId: state.availableDrivers[driverIndex]!.driverId,
      overallPickNumber: state.nextOverallPickNumber,
    });
  }

  async function pickSlots(ctx: Ctx, count: number): Promise<DraftState> {
    let state = await getState(ctx);
    for (let i = 0; i < count; i++) {
      const res = await pickNext(ctx, state);
      expect(res.status).toBe(201);
      state = res.body;
    }
    return state;
  }

  async function pickNumbers(raceId: string) {
    const picks = await prisma.pick.findMany({ where: { raceId }, orderBy: { overallPickNumber: "asc" } });
    return picks.map((p) => p.overallPickNumber);
  }

  describe("wheel spin", () => {
    it("generates an order, opens the draft, and notifies the league then pick 1", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      expect(state.race.status).toBe("DRAFTING");
      expect(state.order).toHaveLength(3);
      expect(state.snake).toHaveLength(9);
      expect(state.onTheClock?.userId).toBe(state.order[0]!.userId);
      expect(await prisma.draftEvent.count({ where: { raceId: ctx.race.id, type: "ORDER_GENERATED" } })).toBe(1);

      await settleNotifications();
      expect(ofKind(push.sent, "draft_open")).toHaveLength(3);
      expect(ofKind(push.sent, "on_the_clock").map((p) => [p.userId, p.overallPickNumber])).toEqual([
        [state.order[0]!.userId, 1],
      ]);
    });

    it("can't spin twice", async () => {
      const ctx = await setup();
      await spin(ctx);
      const again = await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft-order`);
      expect(again.status).toBe(409);
      expect(await prisma.draftOrder.count()).toBe(3);
    });

    it("after raceDate → 409 PICKS_CLOSED, no DraftOrder rows", async () => {
      const ctx = await setup({ raceDate: new Date(Date.now() - HOUR) });
      const res = await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft-order`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PICKS_CLOSED");
      expect(await prisma.draftOrder.count()).toBe(0);
    });

    it("needs participants × 3 eligible drivers", async () => {
      const ctx = await setup({ players: 3, drivers: 8 });
      const res = await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft-order`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NOT_ENOUGH_DRIVERS");
    });

    it("runs a short week with only the chosen players", async () => {
      const ctx = await setup({ players: 3, drivers: 6 });
      const userIds = [ctx.commish.user.id, ctx.members[0]!.user.id];
      const res = await call<DraftState>(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft-order`, { userIds });
      expect(res.status).toBe(201);
      expect(res.body.order.map((o) => o.userId).sort()).toEqual([...userIds].sort());
      expect(res.body.totalSlots).toBe(6);
    });

    it("members can't spin", async () => {
      const ctx = await setup();
      expect((await call(ctx.members[0]!.cookie, "POST", `/races/${ctx.race.id}/draft-order`)).status).toBe(403);
    });
  });

  describe("picks", () => {
    it("two simultaneous picks for the same slot with different drivers → one 201, one 409, one Pick row", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      const results = await Promise.all([pickNext(ctx, state, 0), pickNext(ctx, state, 1)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.pick.count()).toBe(1);
    });

    it("a pick and a revert fired together, 50 times → pick numbers stay contiguous", async () => {
      const ctx = await setup({ players: 3, drivers: 15 });
      await spin(ctx);
      for (let i = 0; i < 50; i++) {
        const state = await getState(ctx);
        const pick = state.onTheClock ? pickNext(ctx, state) : Promise.resolve(null);
        const revert = call(ctx.commish.cookie, "DELETE", `/races/${ctx.race.id}/picks/last`, {
          overallPickNumber: state.picks.at(-1)?.overallPickNumber ?? 1,
        });
        await Promise.all([pick, revert]);
        const numbers = await pickNumbers(ctx.race.id);
        expect(numbers).toEqual(numbers.map((_, idx) => idx + 1));
      }
    });

    it("a stale overallPickNumber → 409 STALE_BOARD", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      const res = await call(cookieFor(ctx, state.onTheClock!.userId), "POST", `/races/${ctx.race.id}/picks`, {
        driverId: state.availableDrivers[0]!.driverId,
        overallPickNumber: 2,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_BOARD");
    });

    it("a member picking out of turn → 403", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      const notMe = state.order.find((o) => o.userId !== state.onTheClock!.userId)!;
      const res = await call(cookieFor(ctx, notMe.userId), "POST", `/races/${ctx.race.id}/picks`, {
        driverId: state.availableDrivers[0]!.driverId,
        overallPickNumber: 1,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_YOUR_TURN");
    });

    it("no eligible entry → 400; already drafted → 409 DRIVER_TAKEN", async () => {
      const ctx = await setup();
      let state = await spin(ctx);
      const [outsider] = await makeDrivers(1);
      const cookie = cookieFor(ctx, state.onTheClock!.userId);
      const bad = await call(cookie, "POST", `/races/${ctx.race.id}/picks`, { driverId: outsider!.id, overallPickNumber: 1 });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("DRIVER_NOT_ELIGIBLE");

      const first = await pickNext(ctx, state);
      const taken = first.body.picks[0]!.driverId;
      state = first.body;
      const dup = await call(cookieFor(ctx, state.onTheClock!.userId), "POST", `/races/${ctx.race.id}/picks`, {
        driverId: taken,
        overallPickNumber: 2,
      });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe("DRIVER_TAKEN");
    });

    it("a pick after raceDate → 409 PICKS_CLOSED; the deadline job then locks it with a null actor", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      await prisma.race.update({ where: { id: ctx.race.id }, data: { raceDate: new Date(Date.now() - 1000) } });

      const res = await pickNext(ctx, state);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PICKS_CLOSED");

      expect(await runDeadlineJob()).toEqual([ctx.race.id]);
      const race = await prisma.race.findUniqueOrThrow({ where: { id: ctx.race.id } });
      expect(race.status).toBe("LOCKED");
      const event = await prisma.draftEvent.findFirstOrThrow({
        where: { raceId: ctx.race.id, type: "STATUS_CHANGED" },
        orderBy: { createdAt: "desc" },
      });
      expect(event.actorUserId).toBeNull();
      expect(event.payload).toMatchObject({ reason: "deadline_passed", picksMade: 0, totalSlots: 9 });

      await settleNotifications();
      expect(ofKind(push.sent, "draft_closed")).toHaveLength(3);
    });

    it("full draft → LOCKED and draft_complete; revert before the deadline → DRAFTING with contiguous picks", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      const full = await pickSlots(ctx, 6);
      expect(full.race.status).toBe("LOCKED");
      expect(full.onTheClock).toBeNull();
      await settleNotifications();
      expect(ofKind(push.sent, "draft_complete")).toHaveLength(2);

      const reverted = await call<DraftState>(ctx.commish.cookie, "DELETE", `/races/${ctx.race.id}/picks/last`, {
        overallPickNumber: 6,
      });
      expect(reverted.status).toBe(200);
      expect(reverted.body.race.status).toBe("DRAFTING");
      expect(await pickNumbers(ctx.race.id)).toEqual([1, 2, 3, 4, 5]);

      // The user back on the clock for slot 6 is re-notified.
      await settleNotifications();
      const slot6 = ofKind(push.sent, "on_the_clock").filter((p) => p.overallPickNumber === 6);
      expect(slot6).toHaveLength(2);
    });

    it("swap the driver on pick 4 of 20 → pick 4 changes, picks 5–20 untouched", async () => {
      const ctx = await setup({ players: 7, drivers: 25 });
      await spin(ctx);
      const state = await pickSlots(ctx, 20);
      const before = await prisma.pick.findMany({ where: { raceId: ctx.race.id }, orderBy: { overallPickNumber: "asc" } });
      const replacement = state.availableDrivers[0]!.driverId;

      const res = await call<DraftState>(ctx.commish.cookie, "PUT", `/races/${ctx.race.id}/picks/4`, { driverId: replacement });
      expect(res.status).toBe(200);
      const after = await prisma.pick.findMany({ where: { raceId: ctx.race.id }, orderBy: { overallPickNumber: "asc" } });
      expect(after[3]).toMatchObject({ driverId: replacement, userId: before[3]!.userId, overallPickNumber: 4 });
      expect(after.slice(4).map((p) => p.driverId)).toEqual(before.slice(4).map((p) => p.driverId));
      expect(await prisma.draftEvent.count({ where: { type: "PICK_SWAPPED" } })).toBe(1);
    });

    it("swap works on a reopened race but not a completed one", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      const state = await pickSlots(ctx, 6);
      const replacement = state.availableDrivers[0]!.driverId;
      const url = `/races/${ctx.race.id}/picks/2`;

      await prisma.race.update({ where: { id: ctx.race.id }, data: { status: "COMPLETED" } });
      expect((await call(ctx.commish.cookie, "PUT", url, { driverId: replacement })).status).toBe(409);

      await prisma.race.update({ where: { id: ctx.race.id }, data: { status: "CORRECTING" } });
      expect((await call(ctx.commish.cookie, "PUT", url, { driverId: replacement })).status).toBe(200);
      const pick = await prisma.pick.findFirstOrThrow({ where: { raceId: ctx.race.id, overallPickNumber: 2 } });
      expect(pick.driverId).toBe(replacement);
    });

    it("a slot missed at the deadline can be filled for its owner, next slot only", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      const state = await pickSlots(ctx, 5);
      const owner = state.snake[5]!;
      const [a, b] = state.availableDrivers.map((d) => d.driverId);
      const fill = (n: number, driverId: string) =>
        call<DraftState>(ctx.commish.cookie, "PUT", `/races/${ctx.race.id}/picks/${n}`, { driverId });

      // Still drafting: that's pick-on-behalf's job.
      expect((await fill(6, a!)).status).toBe(409);

      await prisma.race.update({ where: { id: ctx.race.id }, data: { status: "LIVE" } });
      expect((await fill(7, a!)).status).toBe(400);
      const res = await fill(6, a!);
      expect(res.status).toBe(200);
      expect(res.body.picks[5]).toMatchObject({ overallPickNumber: 6, userId: owner, driverId: a });
      expect((await fill(7, b!)).status).toBe(400);
    });

    it("withdrawn drafted drivers are flagged on the board", async () => {
      const ctx = await setup();
      await spin(ctx);
      const state = await pickSlots(ctx, 1);
      const entry = await prisma.raceEntry.findFirstOrThrow({ where: { driverId: state.picks[0]!.driverId } });
      await call(ctx.commish.cookie, "PATCH", `/races/${ctx.race.id}/entries/${entry.id}`, { isEligible: false });
      expect((await getState(ctx)).picks[0]!.isWithdrawn).toBe(true);
    });

    it("the commissioner picks on behalf of whoever is on the clock, and the next person is notified", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      const onClock = state.onTheClock!.userId;
      const res = await call<DraftState>(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/picks`, {
        driverId: state.availableDrivers[0]!.driverId,
        overallPickNumber: 1,
        onBehalfOfUserId: onClock,
      });
      expect(res.status).toBe(201);
      expect(res.body.picks[0]).toMatchObject({ userId: onClock, createdByUserId: ctx.commish.user.id });
      expect(await prisma.draftEvent.count({ where: { type: onClock === ctx.commish.user.id ? "PICK_MADE" : "PICK_MADE_ON_BEHALF" } })).toBe(1);

      await settleNotifications();
      expect(ofKind(push.sent, "on_the_clock").at(-1)).toMatchObject({ userId: state.snake[1], overallPickNumber: 2 });
    });

    it("on-behalf for someone not on the clock → 409 STALE_BOARD; members can't pick on behalf", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      const onClock = state.onTheClock!.userId;
      const bystander = state.order.find((o) => o.userId !== onClock && o.userId !== ctx.commish.user.id)!.userId;
      const wrong = await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/picks`, {
        driverId: state.availableDrivers[0]!.driverId,
        overallPickNumber: 1,
        onBehalfOfUserId: bystander,
      });
      expect(wrong.status).toBe(409);
      expect(wrong.body.code).toBe("STALE_BOARD");

      const member = ctx.members.find((m) => m.user.id !== onClock)!;
      const res = await call(member.cookie, "POST", `/races/${ctx.race.id}/picks`, {
        driverId: state.availableDrivers[0]!.driverId,
        overallPickNumber: 1,
        onBehalfOfUserId: onClock,
      });
      expect(res.status).toBe(403);
    });

    it("the same pick sent twice → both 2xx, one Pick, one PICK_MADE, one on_the_clock", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      await settleNotifications();
      const first = await pickNext(ctx, state);
      const second = await pickNext(ctx, state);
      expect([first.status, second.status]).toEqual([201, 200]);
      expect(await prisma.pick.count()).toBe(1);
      expect(await prisma.draftEvent.count({ where: { type: "PICK_MADE" } })).toBe(1);
      await settleNotifications();
      expect(ofKind(push.sent, "on_the_clock").filter((p) => p.overallPickNumber === 2)).toHaveLength(1);
    });

    it("the same final pick sent twice (the retry arrives after LOCKED) → both 2xx, one draft_complete each", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      const state = await pickSlots(ctx, 5);
      const first = await pickNext(ctx, state);
      const second = await pickNext(ctx, state);
      expect([first.status, second.status]).toEqual([201, 200]);
      expect(second.body.race.status).toBe("LOCKED");
      expect(await prisma.pick.count()).toBe(6);
      await settleNotifications();
      expect(ofKind(push.sent, "draft_complete")).toHaveLength(2);
    });
  });

  describe("commissioner controls", () => {
    it("revert on a COMPLETED race → 409, no rows deleted", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      await pickSlots(ctx, 2);
      await prisma.race.update({ where: { id: ctx.race.id }, data: { status: "COMPLETED" } });
      const res = await call(ctx.commish.cookie, "DELETE", `/races/${ctx.race.id}/picks/last`, { overallPickNumber: 2 });
      expect(res.status).toBe(409);
      expect(await prisma.pick.count()).toBe(2);
    });

    it("revert of a pick that's no longer last (someone picked since) → 409 STALE_BOARD, nothing deleted", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      await pickSlots(ctx, 3);
      const res = await call(ctx.commish.cookie, "DELETE", `/races/${ctx.race.id}/picks/last`, { overallPickNumber: 2 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("STALE_BOARD");
      expect(await pickNumbers(ctx.race.id)).toEqual([1, 2, 3]);
    });

    it("reset and regenerate after raceDate → 409 PICKS_CLOSED, no rows deleted", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      await pickSlots(ctx, 2);
      await prisma.race.update({ where: { id: ctx.race.id }, data: { raceDate: new Date(Date.now() - 1000) } });
      for (const path of ["reset", "regenerate"]) {
        const res = await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft/${path}`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("PICKS_CLOSED");
      }
      expect(await prisma.pick.count()).toBe(2);
      expect(await prisma.draftOrder.count()).toBe(2);
    });

    it("reset → the re-draft's first on_the_clock is delivered again", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      await pickSlots(ctx, 3);
      await settleNotifications();
      const before = ofKind(push.sent, "on_the_clock").filter((p) => p.overallPickNumber === 1).length;

      const res = await call<DraftState>(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft/reset`);
      expect(res.status).toBe(200);
      expect(res.body.picks).toHaveLength(0);
      expect(res.body.nextOverallPickNumber).toBe(1);
      await settleNotifications();
      expect(ofKind(push.sent, "on_the_clock").filter((p) => p.overallPickNumber === 1)).toHaveLength(before + 1);
    });

    it("regenerate → back to UPCOMING with no order, and the wheel can spin again", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      await pickSlots(ctx, 2);
      const res = await call<DraftState>(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/draft/regenerate`);
      expect(res.body.race.status).toBe("UPCOMING");
      expect(res.body.order).toHaveLength(0);
      expect(await prisma.pick.count()).toBe(0);
      await spin(ctx);
      await settleNotifications();
      expect(ofKind(push.sent, "draft_open")).toHaveLength(4);
    });

    it("members can't revert, swap, reset, or regenerate", async () => {
      const ctx = await setup();
      await spin(ctx);
      const m = ctx.members[0]!.cookie;
      expect((await call(m, "DELETE", `/races/${ctx.race.id}/picks/last`)).status).toBe(403);
      expect((await call(m, "PUT", `/races/${ctx.race.id}/picks/1`, { driverId: ctx.drivers[0]!.id })).status).toBe(403);
      expect((await call(m, "POST", `/races/${ctx.race.id}/draft/reset`)).status).toBe(403);
      expect((await call(m, "POST", `/races/${ctx.race.id}/draft/regenerate`)).status).toBe(403);
    });

    it("the audit log names the commissioner on an on-behalf pick", async () => {
      const ctx = await setup();
      const state = await spin(ctx);
      await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/picks`, {
        driverId: state.availableDrivers[0]!.driverId,
        overallPickNumber: 1,
        onBehalfOfUserId: state.onTheClock!.userId,
      });
      const events = await call(ctx.members[0]!.cookie, "GET", `/races/${ctx.race.id}/events`);
      expect(events.status).toBe(200);
      expect(events.body[0]).toMatchObject({ actorName: "Commish", payload: { overallPickNumber: 1 } });
    });
  });

  describe("deadline and postponement", () => {
    it("closes incomplete → raceDate moved later → reopen → closes again → a second draft_closed is sent", async () => {
      const ctx = await setup({ players: 2, drivers: 8 });
      await spin(ctx);
      await pickSlots(ctx, 2);
      const firstDeadline = new Date(Date.now() + DAY);
      await call(ctx.commish.cookie, "PATCH", `/races/${ctx.race.id}`, { raceDate: firstDeadline.toISOString() });

      await runDeadlineJob(new Date(firstDeadline.getTime() + 1000));
      await settleNotifications();
      expect(ofKind(push.sent, "draft_closed")).toHaveLength(2);

      // Postponed: deadline moves out a week (relative to the real clock, since the routes use it).
      const newDeadline = new Date(Date.now() + 7 * DAY);
      await call(ctx.commish.cookie, "PATCH", `/races/${ctx.race.id}`, { raceDate: newDeadline.toISOString() });
      const reopened = await call(ctx.commish.cookie, "POST", `/races/${ctx.race.id}/status`, { reason: "draft_reopened" });
      expect(reopened.body.status).toBe("DRAFTING");

      await runDeadlineJob(new Date(newDeadline.getTime() + 1000));
      await settleNotifications();
      expect(ofKind(push.sent, "draft_closed")).toHaveLength(4);
    });
  });

  describe("notification delivery", () => {
    it("a failed send is recorded; the sweeper retries it; a second sweep sends nothing", async () => {
      const ctx = await setup();
      push.failUsers = new Set(ctx.everyone.map((u) => u.user.id));
      const state = await spin(ctx);
      await settleNotifications();
      const row = await prisma.notificationLog.findFirstOrThrow({ where: { kind: "on_the_clock", overallPickNumber: 1 } });
      expect(row).toMatchObject({ succeeded: false, attempts: 1, claimedAt: null });

      push.failUsers.clear();
      await runSweeper();
      expect(ofKind(push.sent, "on_the_clock")).toEqual([
        expect.objectContaining({ userId: state.onTheClock!.userId, overallPickNumber: 1 }),
      ]);
      const sentBefore = push.sent.length;
      await runSweeper();
      expect(push.sent.length).toBe(sentBefore);
      expect(await prisma.notificationLog.count({ where: { succeeded: false } })).toBe(0);
    });

    it("after-commit dispatch and a sweeper run racing on the same unsent row → exactly one send", async () => {
      const ctx = await setup();
      push.delayMs = 150;
      await spin(ctx);
      await Promise.all([settleNotifications(), runSweeper(), runSweeper()]);
      await settleNotifications();
      expect(ofKind(push.attempts, "on_the_clock")).toHaveLength(1);
      expect(ofKind(push.attempts, "draft_open")).toHaveLength(3);
    });

    it("a web-push broadcast where one of nine sends fails → only that user's row is retried", async () => {
      const ctx = await setup({ players: 9, drivers: 27 });
      const unlucky = ctx.members[4]!.user.id;
      push.failUsers = new Set([unlucky]);
      await spin(ctx);
      await settleNotifications();
      expect(ofKind(push.sent, "draft_open")).toHaveLength(8);

      push.failUsers.clear();
      const attemptsBefore = ofKind(push.attempts, "draft_open").length;
      await runSweeper();
      const retried = ofKind(push.attempts, "draft_open").slice(attemptsBefore);
      expect(retried.map((p) => p.userId)).toEqual([unlucky]);
    });

    it("Discord delivers a broadcast as one message, and muted users get no turn pings", async () => {
      const discord = fakeChannel("discord", true);
      setChannels([push, discord]);
      const ctx = await setup();
      await prisma.user.updateMany({ data: { notificationsEnabled: false } });
      await spin(ctx);
      await settleNotifications();
      expect(ofKind(discord.sent, "draft_open").map((p) => p.userId)).toEqual([null]);
      expect(ofKind(discord.sent, "on_the_clock")).toHaveLength(0);
      expect(push.sent).toHaveLength(0);
      expect(await prisma.notificationLog.findFirst({ where: { channel: "discord", userId: "BROADCAST" } })).not.toBeNull();
    });

    it("the sweeper sends one pick_reminder per slot and one deadline_warning per commissioner", async () => {
      const ctx = await setup({ raceDate: new Date(Date.now() + 2 * DAY) });
      await spin(ctx);
      await settleNotifications();

      const later = new Date(Date.now() + (env.PICK_REMINDER_HOURS + 1) * HOUR);
      await runSweeper(later);
      await runSweeper(later);
      expect(ofKind(push.sent, "pick_reminder")).toHaveLength(1);

      const nearDeadline = new Date(ctx.race.raceDate.getTime() - HOUR);
      await runSweeper(nearDeadline);
      await runSweeper(nearDeadline);
      expect(ofKind(push.sent, "deadline_warning").map((p) => p.userId)).toEqual([ctx.commish.user.id]);
    });

    it("notify never throws when a channel blows up", async () => {
      const ctx = await setup();
      setChannels([
        {
          ...fakeChannel(),
          async canReach() {
            throw new Error("db down");
          },
        },
      ]);
      await expect(
        notify({ raceId: ctx.race.id, kind: "draft_open", overallPickNumber: 0, to: "league" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("version floor", () => {
    it("X-App-Version below MIN_CLIENT_VERSION → 426 CLIENT_OUTDATED; no header passes", async () => {
      const { cookie } = await makeUser();
      expect((await call(cookie, "GET", "/auth/me")).status).toBe(200);
      const old = await call(cookie, "GET", "/auth/me", undefined, { "X-App-Version": "99" });
      expect(old.status).toBe(426);
      expect(old.body.code).toBe("CLIENT_OUTDATED");
      const current = await call(cookie, "GET", "/auth/me", undefined, { "X-App-Version": "100" });
      expect(current.status).toBe(200);
    });
  });

  describe("health", () => {
    it("reads the database, and needs no login or version header", async () => {
      const res = await call(null, "GET", "/health");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, db: true });
    });
  });
});
