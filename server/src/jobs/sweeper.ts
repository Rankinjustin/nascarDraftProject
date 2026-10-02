import { ROUNDS, snakeOrder, whoseTurn } from "@dnd/shared";
import { prisma } from "../db";
import { env } from "../env";
import { notify, retryRow } from "../notifications/notify";
import { BROADCAST_KINDS } from "../notifications/types";

const HOUR = 60 * 60 * 1000;

/**
 * When the current slot opened: the latest event that put someone on the clock (SPEC Section 14).
 * A swap doesn't count — it doesn't change whose turn it is.
 */
async function slotOpenSince(raceId: string): Promise<Date | null> {
  const event = await prisma.draftEvent.findFirst({
    where: {
      raceId,
      OR: [
        { type: { in: ["ORDER_GENERATED", "PICK_MADE", "PICK_MADE_ON_BEHALF", "PICK_REVERTED", "DRAFT_RESET"] } },
        { type: "STATUS_CHANGED", payload: { path: ["reason"], equals: "draft_reopened" } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return event?.createdAt ?? null;
}

/**
 * Every 5 minutes, around the clock: the safety net that makes delivery reliable without a queue.
 * The ledger dedupes everything, so re-notifying here only sends what hasn't succeeded yet.
 * Quiet hours are enforced inside notify (held kinds are recorded but not sent).
 */
export async function runSweeper(now = new Date()): Promise<void> {
  const races = await prisma.race.findMany({
    where: { status: "DRAFTING" },
    include: { draftOrders: { orderBy: { pickPosition: "asc" } }, _count: { select: { picks: true } } },
  });

  for (const race of races) {
    const snake = snakeOrder(race.draftOrders.map((o) => o.userId), ROUNDS);
    const onTheClock = whoseTurn(snake, race._count.picks);
    if (!onTheClock) continue;
    const slot = race._count.picks + 1;

    // 1–2. Whoever is on the clock has been told (covers failures, quiet-hours holds, restarts).
    await notify({ raceId: race.id, kind: "on_the_clock", overallPickNumber: slot, to: { userId: onTheClock } }, now);

    // 3. One reminder per slot once it has been open long enough.
    const since = await slotOpenSince(race.id);
    if (since && now.getTime() - since.getTime() >= env.PICK_REMINDER_HOURS * HOUR) {
      await notify({ raceId: race.id, kind: "pick_reminder", overallPickNumber: slot, to: { userId: onTheClock } }, now);
    }

    // 4. The draft is still incomplete close to the deadline.
    const untilDeadline = race.raceDate.getTime() - now.getTime();
    if (untilDeadline > 0 && untilDeadline <= env.DEADLINE_WARNING_HOURS * HOUR) {
      await notify({ raceId: race.id, kind: "deadline_warning", overallPickNumber: 0, to: "commissioners" }, now);
    }
  }

  // 5. complete_reminder arrives with race completion (Phase 6).

  // 6. Broadcast rows that failed (per-user web-push rows and Discord BROADCAST rows).
  const failed = await prisma.notificationLog.findMany({
    where: { succeeded: false, attempts: { lt: 5 }, kind: { in: [...BROADCAST_KINDS] } },
  });
  for (const row of failed) await retryRow(row, now);
}
