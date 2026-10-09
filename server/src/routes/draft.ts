import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth, requireCommissioner } from "../auth/sessions";
import {
  getDraftState,
  listEvents,
  makePick,
  regenerateOrder,
  resetDraft,
  revertLastPick,
  spinWheel,
  swapPick,
} from "../services/draft";
import { idParams } from "./params";

/** Mounted under /races alongside racesRouter (SPEC Section 9, "Draft"). */
export const draftRouter = Router();

const uuid = z.uuid();
const slot = z.coerce.number().int().positive();

const spinBody = z.object({ userIds: z.array(uuid).min(2).max(50).optional() });
const pickBody = z.object({
  driverId: uuid,
  overallPickNumber: slot,
  onBehalfOfUserId: uuid.optional(),
});

draftRouter.post("/:id/draft-order", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { userIds } = spinBody.parse(req.body);
  res.status(201).json(await spinWheel(id, currentUser(req), userIds));
});

draftRouter.get("/:id/draft", requireAuth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await getDraftState(id));
});

draftRouter.post("/:id/picks", requireAuth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { created, state } = await makePick(id, currentUser(req), pickBody.parse(req.body));
  res.status(created ? 201 : 200).json(state);
});

draftRouter.delete("/:id/picks/last", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await revertLastPick(id, currentUser(req)));
});

draftRouter.put("/:id/picks/:overallPickNumber", requireCommissioner, async (req, res) => {
  const { id, overallPickNumber } = z.object({ id: uuid, overallPickNumber: slot }).parse(req.params);
  const { driverId } = z.object({ driverId: uuid }).parse(req.body);
  res.json(await swapPick(id, currentUser(req), overallPickNumber, driverId));
});

draftRouter.post("/:id/draft/reset", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await resetDraft(id, currentUser(req)));
});

draftRouter.post("/:id/draft/regenerate", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await regenerateOrder(id, currentUser(req)));
});

draftRouter.get("/:id/events", requireAuth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await listEvents(id));
});
