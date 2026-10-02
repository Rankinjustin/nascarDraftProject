import type { RequestHandler } from "express";
import { env } from "../env";
import { HttpError } from "../errors";

/**
 * Version floor (SPEC Section 11): a client build older than MIN_CLIENT_VERSION gets 426 and reloads.
 * Requests without the header (uptime monitor, curl) are let through.
 */
export const clientVersionFloor: RequestHandler = (req, _res, next) => {
  const header = req.get("x-app-version");
  if (env.MIN_CLIENT_VERSION !== undefined && header !== undefined) {
    const version = Number(header);
    if (!Number.isFinite(version) || version < env.MIN_CLIENT_VERSION) {
      throw new HttpError(426, "CLIENT_OUTDATED", "A new version of the app is available. Reloading…");
    }
  }
  next();
};
