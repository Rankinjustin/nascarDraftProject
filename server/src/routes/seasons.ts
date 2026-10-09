import { Router } from "express";
import { requireAuth } from "../auth/sessions";
import { listSeasons } from "../services/seasons";
import { getSeasonStats } from "../services/stats";
import { idParams } from "./params";

export const seasonsRouter = Router();

seasonsRouter.get("/", requireAuth, async (_req, res) => {
  res.json(await listSeasons());
});

seasonsRouter.get("/:id/stats", requireAuth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await getSeasonStats(id));
});
