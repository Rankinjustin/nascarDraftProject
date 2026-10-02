import { Router } from "express";
import { requireCommissioner } from "../auth/sessions";
import { listDrivers } from "../services/entries";

export const driversRouter = Router();

// The driver catalog, for adding entries by hand.
driversRouter.get("/", requireCommissioner, async (_req, res) => {
  res.json(await listDrivers());
});
