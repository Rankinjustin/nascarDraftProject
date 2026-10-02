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

// Live race and qualifying (SPEC Sections 7 and 11).

export type FeedSessionType = "practice" | "qualifying" | "race" | "unknown";

export interface QualifyingView {
  driverId: string;
  driverName: string;
  carNumber: string;
  startPosition: number;
  /** null when rained out or the lineup was set by formula. */
  qualifyingTime: number | null;
  qualifyingSpeed: number | null;
  isPole: boolean;
  source: "feed" | "manual";
}

export interface LiveDriverRow {
  driverId: string;
  driverName: string;
  carNumber: string;
  /** Current position: runningPosition while live, finishPosition once completed. */
  position: number | null;
  startPosition: number | null;
  /** start − current: positive = positions gained. null without both. */
  change: number | null;
  lapsCompleted: number;
  status: string;
  ownerUserId: string | null;
  ownerName: string | null;
}

export interface RosterSlot {
  /** null = empty slot (the draft closed before it was filled). */
  driverId: string | null;
  driverName: string | null;
  carNumber: string | null;
  startPosition: number | null;
  position: number | null;
  isWithdrawn: boolean;
}

export interface FantasyStanding {
  userId: string;
  displayName: string;
  pickPosition: number;
  /** null before any results exist. */
  score: number | null;
  rank: number | null;
  avgStart: number | null;
  avgCurrent: number | null;
  drivers: RosterSlot[];
}

/** GET /races/:id/live — both halves of the race page in one poll. */
export interface LiveView {
  race: RaceSummary & {
    currentLap: number | null;
    totalLaps: number | null;
    flagState: number | null;
    feedUpdatedAt: string | null;
    checkeredSeenAt: string | null;
  };
  /** The poller's last feed, only when it's for this race. null after a restart or for another race. */
  feed: {
    sessionType: FeedSessionType;
    flagState: number | null;
    currentLap: number | null;
    totalLaps: number | null;
    fetchedAt: string;
  } | null;
  /** The last feed fetch failed; `feed` is the last good copy. */
  stale: boolean;
  fieldSize: number;
  qualifying: QualifyingView[];
  runningOrder: LiveDriverRow[];
  fantasyStandings: FantasyStanding[];
}

export interface EntryImportResult {
  entries: RaceEntryView[];
  added: number;
  updated: number;
}

// Completion, history, and season stats (SPEC Sections 8 and 12, Phases 6–7).

/** One roster slot in a frozen week. An empty slot has driverId null and driverName "No pick". */
export interface DriverFinish {
  driverId: string | null;
  driverName: string;
  carNumber: string | null;
  finishPosition: number | null;
}

export interface WeeklyResultView {
  userId: string;
  displayName: string;
  score: number;
  /** Ties share a rank; every rank-1 row is a weekly winner. */
  rank: number;
  scoringRuleKey: string;
  fieldSize: number;
  driverFinishes: DriverFinish[];
}

/** GET /races/:id/standings */
export type StandingsView =
  | { final: true; results: WeeklyResultView[] }
  | { final: false; projected: FantasyStanding[] };

export interface HistoryWeek {
  race: RaceSummary;
  results: WeeklyResultView[];
}

export interface WeekRef {
  raceId: string;
  raceName: string;
  score: number;
  rank: number;
}

export interface UserSeasonStats {
  userId: string;
  displayName: string;
  weeksPlayed: number;
  /** Count of rank-1 weeks, so a tie is a win for each co-winner. */
  wins: number;
  avgScore: number | null;
  bestWeek: WeekRef | null;
  worstWeek: WeekRef | null;
  driversDrafted: number;
  /** Share of this user's drafted drivers who finished in the top 10; null with no drafted drivers. */
  top10Rate: number | null;
}

export interface DraftedDriverStats {
  driverId: string;
  driverName: string;
  carNumber: string | null;
  timesDrafted: number;
  avgFinish: number | null;
}

/** GET /seasons/:id/stats — read only from WeeklyResult snapshots. */
export interface SeasonStats {
  season: SeasonView;
  weeksCompleted: number;
  users: UserSeasonStats[];
  mostDrafted: DraftedDriverStats[];
}

export interface ResultInput {
  driverId: string;
  finishPosition: number;
  lapsCompleted?: number;
  status?: string;
}
