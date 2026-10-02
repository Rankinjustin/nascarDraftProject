export type Role = "MEMBER" | "COMMISSIONER";

export interface PublicUser {
  id: string;
  phoneNumber: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  notificationsEnabled: boolean;
  discordUserId: string | null;
  hasPassword: boolean;
}

/** Every error response from the API. */
export interface ApiErrorBody {
  code: string;
  message: string;
}
