import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/sessions";
import { listSeasons } from "../services/seasons";
import { getSeasonStats } from "../services/stats";

export const seasonsRouter = Router();

seasonsRouter.get("/", requireAuth, async (_req, res) => {
  res.json(await listSeasons());
});

seasonsRouter.get("/:id/stats", requireAuth, async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  res.json(await getSeasonStats(id));
});
