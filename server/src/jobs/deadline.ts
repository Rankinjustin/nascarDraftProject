import { prisma } from "../db";
import { dispatchAfterCommit } from "../notifications/notify";
import { withRaceLock } from "../races/lock";
import { applyTransition } from "../races/transition";

/**
 * Every minute: lock each DRAFTING race whose start time has passed (SPEC Section 6, "Deadline job").
 * Empty slots stay empty and score as DNS. Returns the ids of the races it closed.
 */
export async function runDeadlineJob(now = new Date()): Promise<string[]> {
  const due = await prisma.race.findMany({
    where: { status: "DRAFTING", raceDate: { lte: now } },
    select: { id: true },
  });
  const closed: string[] = [];
  for (const { id } of due) {
    try {
      const didClose = await withRaceLock(id, async (tx, race) => {
        // Re-checked under the lock: a commissioner may have changed it since the query above.
        if (race.status !== "DRAFTING" || race.raceDate > now) return false;
        await applyTransition(tx, race, "deadline_passed", { actorUserId: null, now });
        return true;
      });
      if (didClose) {
        closed.push(id);
        dispatchAfterCommit([{ raceId: id, kind: "draft_closed", overallPickNumber: 0, to: "league" }]);
      }
    } catch (err) {
      console.error(`Deadline job failed for race ${id}:`, err);
    }
  }
  return closed;
}
