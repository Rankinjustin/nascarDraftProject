import { Router } from "express";
import { jobHealth } from "../jobs/registry";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const health = jobHealth();
  res.status(health.ok ? 200 : 503).json(health);
});
