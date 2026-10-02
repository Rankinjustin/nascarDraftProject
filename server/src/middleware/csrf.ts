import type { RequestHandler } from "express";
import { env } from "../env";
import { HttpError } from "../errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * SameSite=Lax covers most CSRF. On top of that, mutating requests must be JSON
 * (a cross-site form can't send that without a CORS preflight) and must not come
 * from a foreign Origin.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  if (origin && origin !== env.FRONTEND_ORIGIN) {
    throw new HttpError(403, "BAD_ORIGIN", "Request origin not allowed.");
  }
  if (!req.is("application/json")) {
    throw new HttpError(415, "JSON_REQUIRED", "Requests must use Content-Type: application/json.");
  }
  next();
};
