import type { User } from "@prisma/client";
import type { PublicUser } from "@dnd/shared";

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    notificationsEnabled: user.notificationsEnabled,
    discordUserId: user.discordUserId,
    hasPassword: user.passwordHash !== null,
  };
}
