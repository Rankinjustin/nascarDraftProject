import { normalizePhone } from "@dnd/shared";
import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth, requireCommissioner } from "../auth/sessions";
import { createUser, issueUserSetupLink, listUsers, setNotificationsEnabled, updateUser } from "../services/users";
import { idParams } from "./params";

export const usersRouter = Router();

const phoneField = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Enter a 10-digit US phone number." });
      return z.NEVER;
    }
    return phone;
  });

const displayName = z.string().trim().min(1).max(40);
const role = z.enum(["MEMBER", "COMMISSIONER"]);

usersRouter.patch("/me/notifications", requireAuth, async (req, res) => {
  const { notificationsEnabled } = z.object({ notificationsEnabled: z.boolean() }).parse(req.body);
  res.json(await setNotificationsEnabled(currentUser(req).id, notificationsEnabled));
});

usersRouter.get("/", requireCommissioner, async (_req, res) => {
  res.json(await listUsers());
});

usersRouter.post("/", requireCommissioner, async (req, res) => {
  const body = z.object({ phoneNumber: phoneField, displayName, role: role.optional() }).parse(req.body);
  res.status(201).json(await createUser(body));
});

const patchBody = z.object({
  phoneNumber: phoneField.optional(),
  displayName: displayName.optional(),
  role: role.optional(),
  isActive: z.boolean().optional(),
  discordUserId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "Discord user IDs are numeric.")
    .nullable()
    .optional(),
});

usersRouter.patch("/:id", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await updateUser(id, patchBody.parse(req.body)));
});

usersRouter.post("/:id/setup-link", requireCommissioner, async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json({ setupLink: await issueUserSetupLink(id) });
});
