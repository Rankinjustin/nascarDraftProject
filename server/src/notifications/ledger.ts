import type { Tx } from "../races/lock";
import { TURN_KINDS, type NotificationKind } from "./types";

/**
 * Clearing the NotificationLog so the right people are notified again after a draft is rewound
 * (SPEC Section 14, "Clearing the ledger"). All of these run inside the race lock with the change itself.
 */

/** Revert of slot N: turn rows for slots ≥ N, and draft_complete. */
export async function clearAfterRevert(tx: Tx, raceId: string, slot: number): Promise<void> {
  await tx.notificationLog.deleteMany({
    where: {
      raceId,
      OR: [{ kind: { in: [...TURN_KINDS] }, overallPickNumber: { gte: slot } }, { kind: "draft_complete" }],
    },
  });
}

/** Reset: every turn row, plus draft_complete and draft_closed. */
export async function clearAfterReset(tx: Tx, raceId: string): Promise<void> {
  const kinds: NotificationKind[] = [...TURN_KINDS, "draft_complete", "draft_closed"];
  await tx.notificationLog.deleteMany({ where: { raceId, kind: { in: kinds } } });
}

/** Regenerate: every draft row, including draft_open. */
export async function clearAfterRegenerate(tx: Tx, raceId: string): Promise<void> {
  const kinds: NotificationKind[] = [...TURN_KINDS, "draft_open", "deadline_warning", "draft_complete", "draft_closed"];
  await tx.notificationLog.deleteMany({ where: { raceId, kind: { in: kinds } } });
}
