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
