import cron, { type ScheduledTask } from "node-cron";
import { env } from "../env";
import { reportError } from "../instrument";
import { runDeadlineJob } from "./deadline";
import { runPoller } from "./poller";
import { recordJobRun, registerJob } from "./registry";
import { runSweeper } from "./sweeper";

const tasks: ScheduledTask[] = [];

/**
 * Starts the scheduled jobs. Exactly one backend instance runs, so these assume they're the only copy.
 * Each job skips a tick while its previous run is still going.
 */
function schedule(name: string, expression: string, intervalMs: number, run: () => Promise<unknown>) {
  registerJob(name, intervalMs);
  let running = false;
  const task = cron.schedule(expression, async () => {
    if (running) return;
    running = true;
    try {
      await run();
      recordJobRun(name);
    } catch (err) {
      reportError(`Job ${name} failed:`, err);
    } finally {
      running = false;
    }
  });
  tasks.push(task);
}

export function startJobs(): void {
  schedule("deadline", "* * * * *", 60_000, () => runDeadlineJob());
  schedule("sweeper", "*/5 * * * *", 5 * 60_000, () => runSweeper());
  if (env.FEED_POLL_ENABLED) schedule("poller", "*/20 * * * * *", 20_000, () => runPoller());
  else console.log("Live-feed poller is off (FEED_POLL_ENABLED is not true).");
}

/**
 * No new ticks. A run already going is left to finish or be cut off, which is safe: its race writes are transactions
 * that roll back, and a send it had claimed is retried by the next sweeper once the claim expires.
 */
export async function stopJobs(): Promise<void> {
  await Promise.all(tasks.map((task) => task.stop()));
}
