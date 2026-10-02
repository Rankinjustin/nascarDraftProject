export type NotificationKind =
  | "draft_open"
  | "on_the_clock"
  | "pick_reminder"
  | "deadline_warning"
  | "draft_complete"
  | "draft_closed"
  | "results_posted"
  | "complete_reminder";

export type ChannelKey = "web_push" | "discord";

/** Turn notifications go only to the person on the clock. */
export const TURN_KINDS: readonly NotificationKind[] = ["on_the_clock", "pick_reminder"];
/** Held during quiet hours; the sweeper delivers them afterwards (SPEC Section 14). */
export const HELD_KINDS: readonly NotificationKind[] = ["on_the_clock", "pick_reminder", "complete_reminder"];
/** Sent to the whole league. */
export const BROADCAST_KINDS: readonly NotificationKind[] = ["draft_open", "draft_complete", "draft_closed", "results_posted"];

export interface NotificationPayload {
  raceId: string;
  /** null = broadcast to the whole league, delivered as one message (Discord). */
  userId: string | null;
  kind: NotificationKind;
  /** The slot for turn kinds; 0 for non-slot notifications. */
  overallPickNumber: number;
  title: string;
  body: string;
  /** Deep link path, e.g. /draft/:raceId */
  url: string;
}

export interface NotificationChannel {
  key: ChannelKey;
  /**
   * true: a broadcast is one message with userId null (Discord).
   * false: a broadcast is one send per league member (web push), so one failed phone retries alone.
   */
  broadcastAsOne: boolean;
  /** Returns false if this channel can't reach this recipient (no subscription, kind not posted here, etc.). */
  canReach(payload: NotificationPayload): Promise<boolean>;
  send(payload: NotificationPayload): Promise<void>;
}
