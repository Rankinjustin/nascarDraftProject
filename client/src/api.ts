/**
 * The only module that talks to the backend (SPEC Section 15: keep every API call in one client module).
 */
import type { ApiErrorBody, PublicUser } from "@dnd/shared";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    // Every mutating request is JSON, even with no body — the server's CSRF guard requires it.
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as Partial<ApiErrorBody> | null;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export interface CreatedUser {
  user: PublicUser;
  setupLink: string;
}

export const api = {
  me: () => request<PublicUser>("GET", "/auth/me"),
  login: (phoneNumber: string, password: string) =>
    request<PublicUser>("POST", "/auth/login", { phoneNumber, password }),
  logout: () => request<void>("POST", "/auth/logout"),
  setPassword: (token: string, password: string) =>
    request<PublicUser>("POST", "/auth/set-password", { token, password }),

  listUsers: () => request<PublicUser[]>("GET", "/users"),
  createUser: (body: { phoneNumber: string; displayName: string; role?: PublicUser["role"] }) =>
    request<CreatedUser>("POST", "/users", body),
  updateUser: (
    id: string,
    body: Partial<Pick<PublicUser, "phoneNumber" | "displayName" | "role" | "isActive" | "discordUserId">>,
  ) => request<PublicUser>("PATCH", `/users/${id}`, body),
  newSetupLink: (id: string) => request<{ setupLink: string }>("POST", `/users/${id}/setup-link`),
  setNotifications: (notificationsEnabled: boolean) =>
    request<PublicUser>("PATCH", "/users/me/notifications", { notificationsEnabled }),
};
