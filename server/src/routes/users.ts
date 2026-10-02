
import { normalizePhone } from "@dnd/shared";
import { Router } from "express";
import { z } from "zod";
import { toPublicUser } from "../auth/publicUser";
import { currentUser, requireAuth, requireCommissioner } from "../auth/sessions";
import { issueSetupLink } from "../auth/setupTokens";
import { prisma } from "../db";
import { HttpError, isUniqueViolation, notFound } from "../errors";

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

const phoneTakenError = () => new HttpError(409, "PHONE_TAKEN", "Someone already has that phone number.");


usersRouter.patch("/me/notifications", requireAuth, async (req, res) => {
  const { notificationsEnabled } = z.object({ notificationsEnabled: z.boolean() }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: currentUser(req).id },
    data: { notificationsEnabled },
  });
  res.json(toPublicUser(user));
});

usersRouter.get("/", requireCommissioner, async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { displayName: "asc" }] });
  res.json(users.map(toPublicUser));
});

usersRouter.post("/", requireCommissioner, async (req, res) => {
  const body = z.object({ phoneNumber: phoneField, displayName, role: role.optional() }).parse(req.body);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: body });
      return { user: toPublicUser(user), setupLink: await issueSetupLink(user.id, tx) };
    });
    res.status(201).json(result);
  } catch (err) {
    if (isUniqueViolation(err)) throw phoneTakenError();
    throw err;
  }
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
  const body = patchBody.parse(req.body);
  const id = req.params.id as string;

  try {
    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw notFound("User");

      const updated = await tx.user.update({ where: { id }, data: body });

      // Someone has to be able to run the league.
      const activeCommissioners = await tx.user.count({ where: { role: "COMMISSIONER", isActive: true } });
      if (activeCommissioners === 0) {
        throw new HttpError(409, "LAST_COMMISSIONER", "The league needs at least one active commissioner.");
      }
      // Deactivation takes effect immediately; loadSession also rejects inactive users.
      if (body.isActive === false) await tx.session.deleteMany({ where: { userId: id } });
      return updated;
    });
    res.json(toPublicUser(user));
  } catch (err) {
    if (isUniqueViolation(err)) throw phoneTakenError();
    throw err;
  }
});

usersRouter.post("/:id/setup-link", requireCommissioner, async (req, res) => {
  const id = req.params.id as string;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound("User");
  if (!user.isActive) {
    throw new HttpError(409, "USER_INACTIVE", "Reactivate this user before sending a setup link.");
  }
  res.json({ setupLink: await issueSetupLink(user.id) });
});
