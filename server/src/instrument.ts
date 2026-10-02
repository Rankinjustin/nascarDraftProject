import * as Sentry from "@sentry/node";

// Imported before anything else so Sentry can instrument Express.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
}
