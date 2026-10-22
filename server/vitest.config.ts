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
    env: {
      ...(testDb ? { DATABASE_URL: testDb, NODE_ENV: "test" } : {}),
      // Tests run at any hour; equal start and end turns quiet hours off. Quiet hours have their own unit test.
      QUIET_HOURS_START: "00:00",
      QUIET_HOURS_END: "00:00",
      MIN_CLIENT_VERSION: "100",
      // As behind Caddy: req.ip comes from X-Forwarded-For, so the login rate limit can be tested per client address.
      TRUST_PROXY: "1",
      // Real channels stay off; tests install fakes.
      VAPID_PUBLIC_KEY: "",
      DISCORD_WEBHOOK_URL: "",
    },
  },
});
