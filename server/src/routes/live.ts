import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth, requireCommissioner } from "../auth/sessions";
import { completeRace, getStandings, patchResults, reopenRace, replaceResults } from "../services/completion";
import { getLiveView } from "../services/live";
import { getQualifying, setManualQualifying } from "../services/qualifying";

/** Mounted under /races (SPEC Section 9, "Live & standings", plus complete and reopen). */
export const liveRouter = Router();

const resultRow = z.object({
  driverId: z.uuid(),
  finishPosition: z.number().int().positive().max(100),
  lapsCompleted: z.number().int().nonnegative().optional(),
  status: z.enum(["RUNNING", "OUT", "FINISHED"]).optional(),
});
const resultsBody = z.object({ results: z.array(resultRow).min(1).max(100) });

const raceParams = z.object({ id: z.uuid() });

const gridBody = z.object({
  grid: z
    .array(
      z.object({
        driverId: z.uuid(),
        startPosition: z.number().int().positive().max(100),
        qualifyingTime: z.number().positive().nullable().optional(),
        qualifyingSpeed: z.number().positive().nullable().optional(),
      }),
    )
    .min(1)
    .max(100),
});

liveRouter.get("/:id/live", requireAuth, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  res.json(await getLiveView(id));
});

liveRouter.get("/:id/qualifying", requireAuth, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  res.json(await getQualifying(id));
});

liveRouter.post("/:id/qualifying", requireCommissioner, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  res.json(await setManualQualifying(id, gridBody.parse(req.body).grid));
});

liveRouter.get("/:id/standings", requireAuth, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  res.json(await getStandings(id));
});

liveRouter.post("/:id/complete", requireCommissioner, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  res.json(await completeRace(id, currentUser(req)));
});

liveRouter.post("/:id/reopen", requireCommissioner, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body);
  await reopenRace(id, currentUser(req), note);
  res.status(204).end();
});

liveRouter.put("/:id/results", requireCommissioner, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  await replaceResults(id, currentUser(req), resultsBody.parse(req.body).results);
  res.json(await getLiveView(id));
});

liveRouter.patch("/:id/results", requireCommissioner, async (req, res) => {
  const { id } = raceParams.parse(req.params);
  await patchResults(id, currentUser(req), resultsBody.parse(req.body).results);
  res.json(await getLiveView(id));
});
