import * as Sentry from "@sentry/node";
import { env } from "./env";

// Imported before anything else so Sentry can instrument Express. env.ts only loads zod, so this stays ahead of Express.
if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
}
