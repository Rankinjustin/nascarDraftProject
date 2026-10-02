import { z } from "zod";

// A variable left blank in .env arrives as "", which should mean "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default("dnd_session"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  // Number of proxy hops in front of the app (Vercel rewrite + host load balancer). See SPEC Section 5.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SENTRY_DSN: optional(z.string()),
  // Oldest client build the API accepts (SPEC Section 11, "App updates"). Unset = accept everything.
  MIN_CLIENT_VERSION: optional(z.coerce.number().int().nonnegative()),

  VAPID_PUBLIC_KEY: optional(z.string()),
  VAPID_PRIVATE_KEY: optional(z.string()),
  VAPID_SUBJECT: optional(z.string()),
  DISCORD_WEBHOOK_URL: optional(z.string().url()),

  LEAGUE_TIMEZONE: z.string().default("America/Chicago"),
  // Equal start and end means no quiet hours.
  QUIET_HOURS_START: clock.default("22:00"),
  QUIET_HOURS_END: clock.default("08:00"),
  PICK_REMINDER_HOURS: z.coerce.number().positive().default(12),
  DEADLINE_WARNING_HOURS: z.coerce.number().positive().default(12),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
