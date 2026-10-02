/**
 * Scheduled jobs report each successful run here; GET /api/health reads it.
 * Jobs register as they're built (deadline, poller, sweeper in later phases).
 */
interface JobState {
  intervalMs: number;
  lastRunAt: Date | null;
}

const jobs = new Map<string, JobState>();
const startedAt = new Date();

export function registerJob(name: string, intervalMs: number): void {
  jobs.set(name, { intervalMs, lastRunAt: null });
}

export function recordJobRun(name: string): void {
  const job = jobs.get(name);
  if (job) job.lastRunAt = new Date();
}

export function jobHealth(now = new Date()) {
  let ok = true;
  const report: Record<string, { lastRunAt: string | null; overdue: boolean }> = {};
  for (const [name, job] of jobs) {
    // A job that hasn't run yet is measured from server start.
    const since = (job.lastRunAt ?? startedAt).getTime();
    const overdue = now.getTime() - since > job.intervalMs * 3;
    if (overdue) ok = false;
    report[name] = { lastRunAt: job.lastRunAt?.toISOString() ?? null, overdue };
  }
  return { ok, jobs: report };
}
