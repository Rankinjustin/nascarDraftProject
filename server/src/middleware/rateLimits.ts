import { normalizePhone } from "@dnd/shared";
import { rateLimit } from "express-rate-limit";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const message = { code: "RATE_LIMITED", message: "Too many login attempts. Try again in 15 minutes." };

// Two limiters, both applied to login: one per client IP (needs `trust proxy` set correctly,
// SPEC Section 5) and one per phone number.
export const loginLimitByIp = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_ATTEMPTS,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
});

export const loginLimitByPhone = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_ATTEMPTS,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
  keyGenerator: (req) => {
    const raw = typeof req.body?.phoneNumber === "string" ? req.body.phoneNumber : "";
    return `phone:${normalizePhone(raw) ?? "invalid"}`;
  },
});
