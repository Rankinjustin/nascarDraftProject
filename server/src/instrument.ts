import * as Sentry from "@sentry/node";
import { env } from "./env";

// Imported before anything else so Sentry can instrument Express. env.ts only loads zod, so this stays ahead of Express.
if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
}

/**
 * For failures that are caught and survived (scheduled jobs, notifications, the feed), which would otherwise only
 * reach the journal. Sentry is a no-op until SENTRY_DSN is set.
 */
export function reportError(context: string, err: unknown): void {
  console.error(context, err);
  Sentry.captureException(err, { extra: { context } });
}
