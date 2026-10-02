import type { RaceStatus, TransitionReason } from "./rules/raceStatus";

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

// Races & entries. Dates are ISO strings; the browser localizes them.


export interface SeasonView {
  id: string;
  year: number;
  seriesId: number;
  name: string;
  isCurrent: boolean;
}

export interface RaceSummary {
  id: string;
  seasonId: string;
  nascarRaceId: number | null;
  raceName: string;
  trackName: string;
  raceDate: string;
  status: RaceStatus;
  scoringRuleKey: string;
  totalLaps: number | null;
  wentLiveAt: string | null;
  completedAt: string | null;
  entryCount: number;
}

export interface RaceEntryView {
  id: string;
  driverId: string;
  driverName: string;
  carNumber: string;
  teamName: string | null;
  isEligible: boolean;
  isDrafted: boolean;
}

export interface DraftOrderView {
  userId: string;
  displayName: string;
  pickPosition: number;
}

export interface PickView {
  overallPickNumber: number;
  roundNumber: number;
  userId: string;
  driverId: string;
  createdByUserId: string;
}

export interface RaceDetail extends RaceSummary {
  entries: RaceEntryView[];
  draftOrder: DraftOrderView[];
  picks: PickView[];
  picksMade: number;
  totalSlots: number;
}

export interface DriverView {
  id: string;
  nascarDriverId: number | null;
  driverName: string;
  carNumber: string;
  teamName: string | null;
  isActive: boolean;
}

/** Reasons the commissioner can apply through POST /races/:id/status (SPEC Section 9). */
export const OVERRIDE_REASONS = ["draft_reopened", "deadline_passed", "green_flag", "false_start"] as const satisfies readonly TransitionReason[];
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

export interface EntryUpdateResult {
  entry: RaceEntryView;
  /** Set when a drafted driver was marked ineligible: the commissioner should swap that pick. */
  warning: string | null;
}

// Draft (SPEC Sections 6 and 10).

export interface DraftPickView extends PickView {
  displayName: string;
  driverName: string;
  carNumber: string;
  createdByName: string;
  /** The driver's entry was struck after the pick; the commissioner should swap it. */
  isWithdrawn: boolean;
}

export interface AvailableDriver {
  driverId: string;
  driverName: string;
  carNumber: string;
  teamName: string | null;
  /** From QualifyingResult, once the grid is captured. */
  startPosition: number | null;
  /** Finish in the most recent completed race, when known. */
  lastFinish: number | null;
}

/** GET /races/:id/draft, and the response to every draft write. */
export interface DraftState {
  race: RaceSummary;
  order: DraftOrderView[];
  /** One userId per slot, in pick order. */
  snake: string[];
  picks: DraftPickView[];
  onTheClock: { userId: string; displayName: string } | null;
  nextOverallPickNumber: number | null;
  totalSlots: number;
  /** ISO; picks close at the published race start time. */
  deadline: string;
  /** Eligible, undrafted drivers. */
  availableDrivers: AvailableDriver[];
}

export type DraftEventType =
  | "ORDER_GENERATED"
  | "ORDER_REGENERATED"
  | "PICK_MADE"
  | "PICK_MADE_ON_BEHALF"
  | "PICK_REVERTED"
  | "PICK_SWAPPED"
  | "DRAFT_RESET"
  | "STATUS_CHANGED"
  | "RESULTS_CORRECTED";

export interface DraftEventView {
  id: string;
  type: DraftEventType;
  /** null = the system (deadline job, poller). */
  actorName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
