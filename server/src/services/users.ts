import type { Role } from "@prisma/client";
import type { PublicUser } from "@dnd/shared";
import { toPublicUser } from "../auth/publicUser";
import { issueSetupLink } from "../auth/setupTokens";
import { prisma } from "../db";
import { conflict, isUniqueViolation, notFound } from "../errors";

const phoneTaken = () => conflict("PHONE_TAKEN", "Someone already has that phone number.");

export interface NewUser {
  phoneNumber: string;
  displayName: string;
  role?: Role;
}

export type UserPatch = Partial<NewUser & { isActive: boolean; discordUserId: string | null }>;

export async function setNotificationsEnabled(userId: string, notificationsEnabled: boolean): Promise<PublicUser> {
  const user = await prisma.user.update({ where: { id: userId }, data: { notificationsEnabled } });
  return toPublicUser(user);
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { displayName: "asc" }] });
  return users.map(toPublicUser);
}

/** Adds a league member and issues their setup link. */
export async function createUser(input: NewUser): Promise<{ user: PublicUser; setupLink: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: input });
      return { user: toPublicUser(user), setupLink: await issueSetupLink(user.id, tx) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw phoneTaken();
    throw err;
  }
}

export async function updateUser(id: string, patch: UserPatch): Promise<PublicUser> {
  try {
    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw notFound("User");

      const updated = await tx.user.update({ where: { id }, data: patch });

      // Someone has to be able to run the league.
      const activeCommissioners = await tx.user.count({ where: { role: "COMMISSIONER", isActive: true } });
      if (activeCommissioners === 0) {
        throw conflict("LAST_COMMISSIONER", "The league needs at least one active commissioner.");
      }
      // Deactivation takes effect immediately; loadSession also rejects inactive users.
      if (patch.isActive === false) await tx.session.deleteMany({ where: { userId: id } });
      return updated;
    });
    return toPublicUser(user);
  } catch (err) {
    if (isUniqueViolation(err)) throw phoneTaken();
    throw err;
  }
}

/** A fresh setup/reset link for an active user. */
export async function issueUserSetupLink(id: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound("User");
  if (!user.isActive) throw conflict("USER_INACTIVE", "Reactivate this user before sending a setup link.");
  return issueSetupLink(user.id);
}
