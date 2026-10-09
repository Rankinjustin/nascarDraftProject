import { SCORING_RULES, TRANSITIONS, type TransitionReason } from "@dnd/shared";
import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth, requireCommissioner } from "../auth/sessions";
import { listHistory } from "../services/completion";
import {
  addEntries,
  copyEntriesFrom,
  deleteEntry,
  importEntries,
  listEntries,
  updateEntry,
} from "../services/entries";
import { createRace, getCurrentRace, getRaceDetail, listRaces, overrideStatus, updateRace } from "../services/races";
import { idParams } from "./params";

export const racesRouter = Router();

const id = z.uuid();
const entryParams = z.object({ id, entryId: id });

// Shown as an image, so only https links or one of the app's own files (e.g. /tracks/charlotte.svg).
const imageLink = z
  .union([z.url({ protocol: /^https$/ }), z.string().regex(/^\/[\w./-]+$/)])
  .pipe(z.string().max(2000))
  .nullable();

const raceFields = {
  raceName: z.string().trim().min(1).max(120),
  trackName: z.string().trim().min(1).max(120),
  // The browser converts the commissioner's local time to an ISO instant; stored as UTC.
  raceDate: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  qualifyingAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)).nullable(),
  trackMapUrl: imageLink,
  imageUrl: imageLink,
  nascarRaceId: z.number().int().positive().nullable(),
  totalLaps: z.number().int().positive().nullable(),
  scoringRuleKey: z.string().refine((key) => key in SCORING_RULES, "Unknown scoring rule."),
};

// The RaceInput wire shape: name, track, and date required; everything else optional.
const createBody = z
  .object({ seasonId: id, ...raceFields })
  .partial()
  .required({ raceName: true, trackName: true, raceDate: true });

const patchBody = z
  .object(raceFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

// Every reason is accepted here so the service can answer a disallowed one with 409 (SPEC Section 13).
const statusBody = z.object({
  reason: z.enum(Object.keys(TRANSITIONS) as [TransitionReason, ...TransitionReason[]]),
  note: z.string().trim().max(500).optional(),
});

const newDriver = z.object({
  driverName: z.string().trim().min(1).max(80),
  carNumber: z.string().trim().regex(/^\d{1,3}$/, "Car numbers are 1–3 digits."),
  teamName: z.string().trim().max(80).nullable().optional(),
});
const addEntriesBody = z.union([
  z.object({ driverIds: z.array(id).min(1).max(100) }),
  z.object({ newDriver }),
]);

const entryPatch = z
  .object({
    isEligible: z.boolean(),
    carNumber: newDriver.shape.carNumber,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

racesRouter.get("/", requireAuth, async (req, res) => {
  const { seasonId } = z.object({ seasonId: id.optional() }).parse(req.query);
  res.json(await listRaces(seasonId));
});

racesRouter.get("/current", requireAuth, async (_req, res) => {
  res.json(await getCurrentRace());
});

// Completed weeks with their frozen results, newest first. Before /:id so "history" isn't read as a race id.
racesRouter.get("/history", requireAuth, async (req, res) => {
  const { seasonId } = z.object({ seasonId: id.optional() }).parse(req.query);
  res.json(await listHistory(seasonId));
});

racesRouter.get("/:id", requireAuth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await getRaceDetail(id));
});

racesRouter.post("/", requireCommissioner, async (req, res) => {
  res.status(201).json(await createRace(createBody.parse(req.body)));
});

racesRouter.patch("/:id", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await updateRace(id, patchBody.parse(req.body)));
});

racesRouter.post("/:id/status", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { reason, note } = statusBody.parse(req.body);
  res.json(await overrideStatus(id, reason, currentUser(req).id, note));
});

racesRouter.get("/:id/entries", requireAuth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await listEntries(id));
});

racesRouter.post("/:id/entries", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(201).json(await addEntries(id, addEntriesBody.parse(req.body)));
});

racesRouter.post("/:id/entries/import", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await importEntries(id));
});

racesRouter.post("/:id/entries/copy-from", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { sourceRaceId } = z.object({ sourceRaceId: z.uuid() }).parse(req.body);
  res.json(await copyEntriesFrom(id, sourceRaceId));
});

racesRouter.patch("/:id/entries/:entryId", requireCommissioner, async (req, res) => {
  const { id, entryId } = entryParams.parse(req.params);
  res.json(await updateEntry(id, entryId, entryPatch.parse(req.body)));
});

racesRouter.delete("/:id/entries/:entryId", requireCommissioner, async (req, res) => {
  const { id, entryId } = entryParams.parse(req.params);
  await deleteEntry(id, entryId);
  res.status(204).end();
});
