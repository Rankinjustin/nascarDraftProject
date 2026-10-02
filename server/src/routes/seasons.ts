import { Router } from "express";
import { requireAuth } from "../auth/sessions";
import { listSeasons } from "../services/seasons";

export const seasonsRouter = Router();

seasonsRouter.get("/", requireAuth, async (_req, res) => {
  res.json(await listSeasons());
});
