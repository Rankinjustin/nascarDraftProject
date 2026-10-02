import { execSync } from "node:child_process";

/**
 * Brings the test database up to the latest migration before the integration tests run.
 * Each test empties the tables itself (resetDb), so nothing here drops data.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test") || url === process.env.DATABASE_URL) {
    throw new Error(`Refusing to use "${dbName}": TEST_DATABASE_URL must point at a database whose name ends in _test.`);
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
