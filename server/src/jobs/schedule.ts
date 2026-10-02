import cron from "node-cron";
import { env } from "../env";
import { runDeadlineJob } from "./deadline";
import { runPoller } from "./poller";
import { recordJobRun, registerJob } from "./registry";
import { runSweeper } from "./sweeper";

/**
 * Starts the scheduled jobs. Exactly one backend instance runs, so these assume they're the only copy.
 * Each job skips a tick while its previous run is still going.
 */
function schedule(name: string, expression: string, intervalMs: number, run: () => Promise<unknown>) {
  registerJob(name, intervalMs);
  let running = false;
  cron.schedule(expression, async () => {
    if (running) return;
    running = true;
    try {
      await run();
      recordJobRun(name);
    } catch (err) {
      console.error(`Job ${name} failed:`, err);
    } finally {
      running = false;
    }
  });
}

export function startJobs(): void {
  schedule("deadline", "* * * * *", 60_000, () => runDeadlineJob());
  schedule("sweeper", "*/5 * * * *", 5 * 60_000, () => runSweeper());
  if (env.FEED_POLL_ENABLED) schedule("poller", "*/20 * * * * *", 20_000, () => runPoller());
  else console.log("Live-feed poller is off (FEED_POLL_ENABLED is not true).");
}
