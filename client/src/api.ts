/**
 * The only module that talks to the backend (SPEC Section 15: keep every API call in one client module).
 */
import type {
  ApiErrorBody,
  DraftEventView,
  DraftState,
  DriverView,
  EntryImportResult,
  EntryUpdateResult,
  HistoryWeek,
  LiveView,
  PublicUser,
  PushSubscriptionInput,
  QualifyingView,
  RaceDetail,
  RaceEntryView,
  RaceInput,
  RaceSummary,
  ResultInput,
  SeasonStats,
  SeasonView,
  TransitionReason,
  WeeklyResultView,
} from "@dnd/shared";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The server refused this build (426, SPEC Section 11 "Version floor"): fetch the new service worker and reload.
 * Guarded so a server misconfiguration can't put the app in a reload loop.
 */
async function forceReload(): Promise<void> {
  const KEY = "dnd:forcedReloadAt";
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage unavailable: reload anyway.
  }
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  await registration?.update().catch(() => undefined);
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  window.location.reload();
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      "X-App-Version": APP_VERSION,
      // Every mutating request is JSON, even with no body — the server's CSRF guard requires it.
      ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return undefined as T;
  if (res.status === 426) void forceReload();

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as Partial<ApiErrorBody> | null;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

interface CreatedUser {
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

  listSeasons: () => request<SeasonView[]>("GET", "/seasons"),

  listRaces: (seasonId?: string) =>
    request<RaceSummary[]>("GET", `/races${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ""}`),
  currentRace: () => request<RaceSummary | null>("GET", "/races/current"),
  getRace: (id: string) => request<RaceDetail>("GET", `/races/${id}`),
  createRace: (body: RaceInput) => request<RaceSummary>("POST", "/races", body),
  updateRace: (id: string, body: Partial<RaceInput>) => request<RaceSummary>("PATCH", `/races/${id}`, body),
  overrideStatus: (id: string, reason: TransitionReason, note?: string) =>
    request<RaceSummary>("POST", `/races/${id}/status`, { reason, note }),

  listDrivers: () => request<DriverView[]>("GET", "/drivers"),
  addEntries: (raceId: string, driverIds: string[]) =>
    request<RaceEntryView[]>("POST", `/races/${raceId}/entries`, { driverIds }),
  addNewDriver: (raceId: string, newDriver: { driverName: string; carNumber: string; teamName?: string | null }) =>
    request<RaceEntryView[]>("POST", `/races/${raceId}/entries`, { newDriver }),
  importEntries: (raceId: string) => request<EntryImportResult>("POST", `/races/${raceId}/entries/import`),
  copyEntries: (raceId: string, sourceRaceId: string) =>
    request<RaceEntryView[]>("POST", `/races/${raceId}/entries/copy-from`, { sourceRaceId }),
  updateEntry: (raceId: string, entryId: string, body: { isEligible?: boolean; carNumber?: string }) =>
    request<EntryUpdateResult>("PATCH", `/races/${raceId}/entries/${entryId}`, body),
  deleteEntry: (raceId: string, entryId: string) =>
    request<void>("DELETE", `/races/${raceId}/entries/${entryId}`),

  getDraft: (raceId: string) => request<DraftState>("GET", `/races/${raceId}/draft`),
  spinWheel: (raceId: string, userIds?: string[]) =>
    request<DraftState>("POST", `/races/${raceId}/draft-order`, userIds ? { userIds } : {}),
  makePick: (raceId: string, body: { driverId: string; overallPickNumber: number; onBehalfOfUserId?: string }) =>
    request<DraftState>("POST", `/races/${raceId}/picks`, body),
  revertLastPick: (raceId: string, overallPickNumber: number) =>
    request<DraftState>("DELETE", `/races/${raceId}/picks/last`, { overallPickNumber }),
  swapPick: (raceId: string, overallPickNumber: number, driverId: string) =>
    request<DraftState>("PUT", `/races/${raceId}/picks/${overallPickNumber}`, { driverId }),
  resetDraft: (raceId: string) => request<DraftState>("POST", `/races/${raceId}/draft/reset`),
  regenerateOrder: (raceId: string) => request<DraftState>("POST", `/races/${raceId}/draft/regenerate`),
  listEvents: (raceId: string) => request<DraftEventView[]>("GET", `/races/${raceId}/events`),

  getLive: (raceId: string) => request<LiveView>("GET", `/races/${raceId}/live`),
  getQualifying: (raceId: string) => request<QualifyingView[]>("GET", `/races/${raceId}/qualifying`),
  setQualifying: (raceId: string, grid: { driverId: string; startPosition: number }[]) =>
    request<QualifyingView[]>("POST", `/races/${raceId}/qualifying`, { grid }),

  completeRace: (raceId: string) => request<WeeklyResultView[]>("POST", `/races/${raceId}/complete`),
  reopenRace: (raceId: string, note?: string) => request<void>("POST", `/races/${raceId}/reopen`, { note }),
  replaceResults: (raceId: string, results: ResultInput[]) => request<LiveView>("PUT", `/races/${raceId}/results`, { results }),
  patchResults: (raceId: string, results: ResultInput[]) => request<LiveView>("PATCH", `/races/${raceId}/results`, { results }),
  history: (seasonId?: string) =>
    request<HistoryWeek[]>("GET", `/races/history${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ""}`),
  seasonStats: (seasonId: string) => request<SeasonStats>("GET", `/seasons/${seasonId}/stats`),

  subscribePush: (subscription: PushSubscriptionInput) => request<void>("POST", "/notifications/subscribe", subscription),
  unsubscribePush: (endpoint: string) => request<void>("DELETE", "/notifications/subscribe", { endpoint }),
  testPush: () => request<{ devices: number }>("POST", "/notifications/test"),
};
