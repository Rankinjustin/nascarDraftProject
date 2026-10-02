import type { User } from "@prisma/client";
import {
  ROUNDS,
  roundForPick,
  snakeOrder,
  whoseTurn,
  type AvailableDriver,
  type DraftEventView,
  type DraftState,
} from "@dnd/shared";
import { prisma } from "../db";
import { HttpError, isUniqueViolation, notFound } from "../errors";
import { clearAfterRegenerate, clearAfterReset, clearAfterRevert } from "../notifications/ledger";
import { dispatchAfterCommit, type Notice } from "../notifications/notify";
import { withRaceLock, type Tx } from "../races/lock";
import { shuffle } from "../races/shuffle";
import { applyTransition } from "../races/transition";
import { byCarNumber } from "./entries";
import { toRaceSummary } from "./races";

type Db = Tx | typeof prisma;

const conflict = (code: string, message: string) => new HttpError(409, code, message);
const picksClosed = () => conflict("PICKS_CLOSED", "Picks are closed: the race start time has passed.");
const staleBoard = () => conflict("STALE_BOARD", "Someone just picked — here's the updated board.");
const notEditable = () =>
  conflict("DRAFT_NOT_EDITABLE", "The draft can only be changed while it's drafting or locked. Once a race is live, rosters are final.");

/** The snake and turn for a race, read inside the lock so it can't change underneath the caller. */
async function draftContext(db: Db, raceId: string) {
  const order = await db.draftOrder.findMany({ where: { raceId }, orderBy: { pickPosition: "asc" }, include: { user: true } });
  const picksMade = await db.pick.count({ where: { raceId } });
  const snake = snakeOrder(order.map((o) => o.userId), ROUNDS);
  return { order, snake, picksMade, onTheClock: whoseTurn(snake, picksMade) };
}

async function eligibleEntry(tx: Tx, raceId: string, driverId: string) {
  const entry = await tx.raceEntry.findUnique({
    where: { raceId_driverId: { raceId, driverId } },
    include: { driver: true },
  });
  if (!entry || !entry.isEligible) {
    throw new HttpError(400, "DRIVER_NOT_ELIGIBLE", "That driver isn't entered in this race.");
  }
  return entry;
}

async function assertUndrafted(tx: Tx, raceId: string, driverId: string, driverName: string) {
  if (await tx.pick.findUnique({ where: { raceId_driverId: { raceId, driverId } } })) {
    throw conflict("DRIVER_TAKEN", `${driverName} has already been drafted.`);
  }
}

function sortAvailable(drivers: AvailableDriver[]): AvailableDriver[] {
  // Starting position once qualifying is captured; else last race's finish; else car number (SPEC Section 11).
  const field: "startPosition" | "lastFinish" | null = drivers.some((d) => d.startPosition !== null)
    ? "startPosition"
    : drivers.some((d) => d.lastFinish !== null)
      ? "lastFinish"
      : null;
  return [...drivers].sort((a, b) => {
    if (field) {
      const x = a[field] ?? Infinity;
      const y = b[field] ?? Infinity;
      if (x !== y) return x - y;
    }
    return byCarNumber(a, b);
  });
}

export async function getDraftState(raceId: string, db: Db = prisma): Promise<DraftState> {
  const race = await db.race.findUnique({
    where: { id: raceId },
    include: {
      _count: { select: { entries: true } },
      entries: { include: { driver: true } },
      draftOrders: { orderBy: { pickPosition: "asc" }, include: { user: true } },
      picks: { orderBy: { overallPickNumber: "asc" }, include: { driver: true, user: true, creator: true } },
      qualifying: true,
    },
  });
  if (!race) throw notFound("Race");

  const snake = snakeOrder(race.draftOrders.map((o) => o.userId), ROUNDS);
  const onTheClock = whoseTurn(snake, race.picks.length);
  const entryByDriver = new Map(race.entries.map((e) => [e.driverId, e]));
  const drafted = new Set(race.picks.map((p) => p.driverId));
  const startByDriver = new Map(race.qualifying.map((q) => [q.driverId, q.startPosition]));

  const lastRace = await db.race.findFirst({
    where: { status: "COMPLETED", raceDate: { lt: race.raceDate } },
    orderBy: { raceDate: "desc" },
    select: { results: { select: { driverId: true, finishPosition: true } } },
  });
  const lastFinishByDriver = new Map(lastRace?.results.map((r) => [r.driverId, r.finishPosition]) ?? []);

  const onTheClockUser = race.draftOrders.find((o) => o.userId === onTheClock)?.user;

  return {
    race: toRaceSummary(race),
    order: race.draftOrders.map((o) => ({ userId: o.userId, displayName: o.user.displayName, pickPosition: o.pickPosition })),
    snake,
    picks: race.picks.map((p) => {
      const entry = entryByDriver.get(p.driverId);
      return {
        overallPickNumber: p.overallPickNumber,
        roundNumber: p.roundNumber,
        userId: p.userId,
        driverId: p.driverId,
        createdByUserId: p.createdByUserId,
        displayName: p.user.displayName,
        driverName: p.driver.driverName,
        carNumber: entry?.carNumber ?? p.driver.carNumber,
        createdByName: p.creator.displayName,
        isWithdrawn: !entry || !entry.isEligible,
      };
    }),
    onTheClock: onTheClockUser ? { userId: onTheClockUser.id, displayName: onTheClockUser.displayName } : null,
    nextOverallPickNumber: onTheClock ? race.picks.length + 1 : null,
    totalSlots: snake.length,
    deadline: race.raceDate.toISOString(),
    availableDrivers: sortAvailable(
      race.entries
        .filter((e) => e.isEligible && !drafted.has(e.driverId))
        .map((e) => ({
          driverId: e.driverId,
          driverName: e.driver.driverName,
          carNumber: e.carNumber,
          teamName: e.driver.teamName,
          startPosition: startByDriver.get(e.driverId) ?? null,
          lastFinish: lastFinishByDriver.get(e.driverId) ?? null,
        })),
    ),
  };
}

/** POST /races/:id/draft-order — spin the wheel (SPEC Section 10). */
export async function spinWheel(raceId: string, actor: User, userIds?: string[], now = new Date()): Promise<DraftState> {
  const notices: Notice[] = [];
  await withRaceLock(raceId, async (tx, race) => {
    if (race.status !== "UPCOMING") throw conflict("ORDER_EXISTS", "This race already has a draft order.");
    if (now >= race.raceDate) throw picksClosed();
    if ((await tx.draftOrder.count({ where: { raceId } })) > 0) {
      throw conflict("ORDER_EXISTS", "This race already has a draft order.");
    }

    const participants = userIds
      ? await tx.user.findMany({ where: { id: { in: userIds }, isActive: true } })
      : await tx.user.findMany({ where: { isActive: true } });
    if (userIds && participants.length !== new Set(userIds).size) {
      throw new HttpError(400, "INVALID_PARTICIPANTS", "Every player in the draft must be an active member.");
    }
    if (participants.length < 2) {
      throw new HttpError(400, "INVALID_PARTICIPANTS", "A draft needs at least 2 players.");
    }

    const eligible = await tx.raceEntry.count({ where: { raceId, isEligible: true } });
    const needed = participants.length * ROUNDS;
    if (eligible < needed) {
      throw conflict(
        "NOT_ENOUGH_DRIVERS",
        `${participants.length} players need at least ${needed} eligible drivers; this race has ${eligible}.`,
      );
    }

    const order = shuffle(participants).map((u, i) => ({ userId: u.id, displayName: u.displayName, pickPosition: i + 1 }));
    await tx.draftOrder.createMany({ data: order.map(({ userId, pickPosition }) => ({ raceId, userId, pickPosition })) });
    await tx.draftEvent.create({
      data: { raceId, actorUserId: actor.id, type: "ORDER_GENERATED", payload: { order } },
    });
    await applyTransition(tx, race, "order_generated", { actorUserId: actor.id, now });
    notices.push(
      { raceId, kind: "draft_open", overallPickNumber: 0, to: "league" },
      { raceId, kind: "on_the_clock", overallPickNumber: 1, to: { userId: order[0]!.userId } },
    );
  });
  dispatchAfterCommit(notices);
  return getDraftState(raceId);
}

export interface PickInput {
  driverId: string;
  overallPickNumber: number;
  onBehalfOfUserId?: string;
}

/** POST /races/:id/picks (SPEC Section 6, "Making a pick"). `created` is false for an idempotent retry. */
export async function makePick(
  raceId: string,
  actor: User,
  input: PickInput,
  now = new Date(),
): Promise<{ created: boolean; state: DraftState }> {
  const notices: Notice[] = [];
  let created = false;
  try {
    await withRaceLock(raceId, async (tx, race) => {
      // 1. A repeat of a pick that already succeeded (double tap, phone retry). Checked first: the
      //    original may have been the last pick, which already locked the race.
      const inSlot = await tx.pick.findUnique({
        where: { raceId_overallPickNumber: { raceId, overallPickNumber: input.overallPickNumber } },
      });
      if (inSlot && inSlot.driverId === input.driverId && inSlot.createdByUserId === actor.id) return;

      if (race.status !== "DRAFTING") throw conflict("DRAFT_NOT_OPEN", "The draft isn't open.");
      if (now >= race.raceDate) throw picksClosed();

      const { order, snake, picksMade, onTheClock } = await draftContext(tx, raceId);
      if (onTheClock === null) throw conflict("DRAFT_COMPLETE", "Every pick has been made.");
      if (input.overallPickNumber !== picksMade + 1) throw staleBoard();

      const onBehalf = input.onBehalfOfUserId !== undefined && input.onBehalfOfUserId !== actor.id;
      if (onBehalf) {
        if (actor.role !== "COMMISSIONER") throw new HttpError(403, "FORBIDDEN", "Only a commissioner can pick for someone else.");
        // The commissioner picks for whoever is on the clock, never out of order.
        if (input.onBehalfOfUserId !== onTheClock) throw staleBoard();
      } else if (actor.id !== onTheClock) {
        throw new HttpError(403, "NOT_YOUR_TURN", "It's not your turn.");
      }

      const entry = await eligibleEntry(tx, raceId, input.driverId);
      await assertUndrafted(tx, raceId, input.driverId, entry.driver.driverName);

      const overallPickNumber = picksMade + 1;
      const roundNumber = roundForPick(overallPickNumber, order.length);
      const owner = order.find((o) => o.userId === onTheClock)!.user;
      await tx.pick.create({
        data: { raceId, userId: onTheClock, driverId: input.driverId, createdByUserId: actor.id, overallPickNumber, roundNumber },
      });
      await tx.draftEvent.create({
        data: {
          raceId,
          actorUserId: actor.id,
          type: onBehalf ? "PICK_MADE_ON_BEHALF" : "PICK_MADE",
          payload: {
            overallPickNumber,
            roundNumber,
            userId: owner.id,
            displayName: owner.displayName,
            driverId: input.driverId,
            driverName: entry.driver.driverName,
            carNumber: entry.carNumber,
          },
        },
      });
      created = true;

      if (overallPickNumber === snake.length) {
        await applyTransition(tx, race, "draft_filled", { actorUserId: actor.id, now });
        notices.push({ raceId, kind: "draft_complete", overallPickNumber: 0, to: "league" });
      } else {
        // Keyed off whoseTurn, not off who submitted: an on-behalf pick still notifies the next person.
        notices.push({
          raceId,
          kind: "on_the_clock",
          overallPickNumber: overallPickNumber + 1,
          to: { userId: snake[overallPickNumber]! },
        });
      }
    });
  } catch (err) {
    // Two requests for the same slot that slipped past the checks: the unique constraint is the backstop.
    if (isUniqueViolation(err)) throw staleBoard();
    throw err;
  }
  dispatchAfterCommit(notices);
  return { created, state: await getDraftState(raceId) };
}

function assertEditable(status: string): void {
  if (status !== "DRAFTING" && status !== "LOCKED") throw notEditable();
}

/** DELETE /races/:id/picks/last — only ever the last pick, so pick numbers stay contiguous. */
export async function revertLastPick(raceId: string, actor: User, now = new Date()): Promise<DraftState> {
  const notices: Notice[] = [];
  await withRaceLock(raceId, async (tx, race) => {
    assertEditable(race.status);
    const last = await tx.pick.findFirst({
      where: { raceId },
      orderBy: { overallPickNumber: "desc" },
      include: { driver: true, user: true },
    });
    if (!last) throw conflict("NO_PICKS", "There are no picks to revert.");

    await tx.pick.delete({ where: { id: last.id } });
    await tx.draftEvent.create({
      data: {
        raceId,
        actorUserId: actor.id,
        type: "PICK_REVERTED",
        payload: {
          overallPickNumber: last.overallPickNumber,
          userId: last.userId,
          displayName: last.user.displayName,
          driverId: last.driverId,
          driverName: last.driver.driverName,
        },
      },
    });
    await clearAfterRevert(tx, raceId, last.overallPickNumber);

    let status = race.status;
    // Before the deadline a locked draft reopens; after it, the slot is simply empty again.
    if (race.status === "LOCKED" && now < race.raceDate && race.wentLiveAt === null) {
      status = (await applyTransition(tx, race, "draft_reopened", { actorUserId: actor.id, now })).status;
    }
    if (status === "DRAFTING") {
      notices.push({ raceId, kind: "on_the_clock", overallPickNumber: last.overallPickNumber, to: { userId: last.userId } });
    }
  });
  dispatchAfterCommit(notices);
  return getDraftState(raceId);
}

/** PUT /races/:id/picks/:overallPickNumber — how withdrawals are handled. The pick keeps its slot and owner. */
export async function swapPick(raceId: string, actor: User, overallPickNumber: number, driverId: string): Promise<DraftState> {
  await withRaceLock(raceId, async (tx, race) => {
    assertEditable(race.status);
    const pick = await tx.pick.findUnique({
      where: { raceId_overallPickNumber: { raceId, overallPickNumber } },
      include: { driver: true, user: true },
    });
    if (!pick) throw notFound("Pick");
    if (pick.driverId === driverId) throw new HttpError(400, "SAME_DRIVER", "That pick already has this driver.");

    const entry = await eligibleEntry(tx, raceId, driverId);
    await assertUndrafted(tx, raceId, driverId, entry.driver.driverName);

    await tx.pick.update({ where: { id: pick.id }, data: { driverId } });
    await tx.draftEvent.create({
      data: {
        raceId,
        actorUserId: actor.id,
        type: "PICK_SWAPPED",
        payload: {
          overallPickNumber,
          userId: pick.userId,
          displayName: pick.user.displayName,
          from: { driverId: pick.driverId, driverName: pick.driver.driverName },
          to: { driverId, driverName: entry.driver.driverName },
        },
      },
    });
  });
  return getDraftState(raceId);
}

/** POST /races/:id/draft/reset — deletes every pick, keeps the order. */
export async function resetDraft(raceId: string, actor: User, now = new Date()): Promise<DraftState> {
  const notices: Notice[] = [];
  await withRaceLock(raceId, async (tx, race) => {
    assertEditable(race.status);
    if (now >= race.raceDate) throw picksClosed();

    const { count } = await tx.pick.deleteMany({ where: { raceId } });
    await tx.draftEvent.create({ data: { raceId, actorUserId: actor.id, type: "DRAFT_RESET", payload: { picksDeleted: count } } });
    await clearAfterReset(tx, raceId);
    if (race.status === "LOCKED") await applyTransition(tx, race, "draft_reopened", { actorUserId: actor.id, now });

    const { snake } = await draftContext(tx, raceId);
    if (snake[0]) notices.push({ raceId, kind: "on_the_clock", overallPickNumber: 1, to: { userId: snake[0] } });
  });
  dispatchAfterCommit(notices);
  return getDraftState(raceId);
}

/** POST /races/:id/draft/regenerate — deletes picks and order; back to UPCOMING for a new spin. */
export async function regenerateOrder(raceId: string, actor: User, now = new Date()): Promise<DraftState> {
  await withRaceLock(raceId, async (tx, race) => {
    assertEditable(race.status);
    if (now >= race.raceDate) throw picksClosed();

    const { order } = await draftContext(tx, raceId);
    const { count } = await tx.pick.deleteMany({ where: { raceId } });
    await tx.draftOrder.deleteMany({ where: { raceId } });
    await tx.draftEvent.create({
      data: {
        raceId,
        actorUserId: actor.id,
        type: "ORDER_REGENERATED",
        payload: { previousOrder: order.map((o) => o.user.displayName), picksDeleted: count },
      },
    });
    await clearAfterRegenerate(tx, raceId);
    await applyTransition(tx, race, "order_regenerated", { actorUserId: actor.id, now });
  });
  return getDraftState(raceId);
}

/** GET /races/:id/events — the audit log, newest first. */
export async function listEvents(raceId: string): Promise<DraftEventView[]> {
  const race = await prisma.race.findUnique({ where: { id: raceId }, select: { id: true } });
  if (!race) throw notFound("Race");
  const events = await prisma.draftEvent.findMany({
    where: { raceId },
    orderBy: { createdAt: "desc" },
    include: { actor: true },
  });
  return events.map((e) => ({
    id: e.id,
    type: e.type,
    actorName: e.actor?.displayName ?? null,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    createdAt: e.createdAt.toISOString(),
  }));
}
