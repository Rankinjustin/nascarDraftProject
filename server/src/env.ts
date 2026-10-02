import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default("dnd_session"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  // Number of proxy hops in front of the app (Vercel rewrite + host load balancer). See SPEC Section 5.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SENTRY_DSN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
