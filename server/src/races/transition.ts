import type { Prisma, Race } from "@prisma/client";
import {
  checkTransition,
  ROUNDS,
  transitionTarget,
  type DraftEventPayloads,
  type DraftEventType,
  type TransitionReason,
} from "@dnd/shared";
import { conflict } from "../errors";
import type { Tx } from "./lock";

/** Appends to a race's audit log; the payload shape is checked against its type. */
export async function logDraftEvent<T extends DraftEventType>(
  tx: Tx,
  raceId: string,
  actorUserId: string | null,
  type: T,
  payload: DraftEventPayloads[T],
): Promise<void> {
  await tx.draftEvent.create({ data: { raceId, actorUserId, type, payload: payload as Prisma.InputJsonObject } });
}

/**
 * The only code that writes Race.status (SPEC Section 4). Call it inside withRaceLock.
 * Validates with checkTransition, applies the side effects tied to the transition, and logs STATUS_CHANGED.
 */
export async function applyTransition(
  tx: Tx,
  race: Race,
  reason: TransitionReason,
  opts: { actorUserId: string | null; now?: Date; note?: string },
): Promise<Race> {
  const now = opts.now ?? new Date();
  const picksMade = await tx.pick.count({ where: { raceId: race.id } });
  const drafters = await tx.draftOrder.count({ where: { raceId: race.id } });
  const totalSlots = drafters * ROUNDS;

  const refusal = checkTransition(race.status, reason, {
    now,
    raceDate: race.raceDate,
    picksMade,
    totalSlots,
    hasBeenLive: race.wentLiveAt !== null,
  });
  if (refusal) throw conflict("INVALID_TRANSITION", refusal);

  const to = transitionTarget(reason);
  const updated = await tx.race.update({
    where: { id: race.id },
    data: {
      status: to,
      ...(reason === "green_flag" && race.wentLiveAt === null ? { wentLiveAt: now } : {}),
    },
  });

  // A reopened draft can close again, and that close should be announced again (SPEC Section 6).
  if (reason === "draft_reopened") {
    await tx.notificationLog.deleteMany({ where: { raceId: race.id, kind: "draft_closed" } });
  }

  await logDraftEvent(tx, race.id, opts.actorUserId, "STATUS_CHANGED", {
    from: race.status,
    to,
    reason,
    picksMade,
    totalSlots,
    ...(opts.note ? { note: opts.note } : {}),
  });
  return updated;
}
