import { defineConfig } from "vitest/config";

// Integration tests run against TEST_DATABASE_URL, never DATABASE_URL. Without it they're skipped.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env (CI sets variables directly).
}
const testDb = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    // One database, so integration test files must not run at the same time.
    fileParallelism: false,
    globalSetup: testDb ? ["./test/globalSetup.ts"] : [],
    env: testDb ? { DATABASE_URL: testDb, NODE_ENV: "test" } : {},
  },
});
