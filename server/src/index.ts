import "./instrument";
import { createApp } from "./app";
import { getDummyHash } from "./auth/passwords";
import { prisma } from "./db";
import { env } from "./env";
import { startJobs, stopJobs } from "./jobs/schedule";
import { settleNotifications } from "./notifications/notify";

await getDummyHash();
const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
startJobs();

/**
 * systemd sends SIGTERM on every deploy and restart. Stop taking work, let requests in flight finish, then wait for their
 * after-commit notifications: a broadcast cut off before its ledger row is written is never retried. Capped, so a hung
 * send can't hold up a deploy.
 */
async function shutDown(signal: string): Promise<void> {
  console.log(`${signal}: shutting down`);
  const drained = (async () => {
    await stopJobs();
    await new Promise((resolve) => server.close(resolve));
    await settleNotifications();
  })();
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGTERM", () => void shutDown("SIGTERM"));
process.once("SIGINT", () => void shutDown("SIGINT"));
