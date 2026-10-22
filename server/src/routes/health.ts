import { Router } from "express";
import { prisma } from "../db";
import { jobHealth } from "../jobs/registry";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const health = jobHealth();
  // Real rows, not SELECT 1: Prisma names every column, so a build whose schema doesn't match the database (a rollback
  // past a migration) fails here, where `dnd deploy` and `dnd rollback` look, instead of at the first login.
  const db = await Promise.all([prisma.user.findFirst(), prisma.race.findFirst()]).then(
    () => true,
    (err: unknown) => {
      console.error("Health check: database query failed:", err);
      return false;
    },
  );
  const ok = health.ok && db;
  res.status(ok ? 200 : 503).json({ ...health, ok, db });
});
