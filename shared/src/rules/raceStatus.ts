export type RaceStatus = "UPCOMING" | "DRAFTING" | "LOCKED" | "LIVE" | "COMPLETED" | "CORRECTING";

export type TransitionReason =
  | "order_generated"      // UPCOMING  → DRAFTING   (wheel spin)
  | "order_regenerated"    // DRAFTING | LOCKED → UPCOMING   (only before raceDate)
  | "draft_filled"         // DRAFTING  → LOCKED     (last pick made)
  | "deadline_passed"      // DRAFTING  → LOCKED     (system at raceDate, or commish closing early — any time)
  | "draft_reopened"       // LOCKED    → DRAFTING   (revert/reset before raceDate, or commish override)
  | "green_flag"           // LOCKED    → LIVE       (poller, or commish override)
  | "false_start"          // LIVE      → LOCKED     (commish override: feed glitch promoted it early)
  | "completed"            // LIVE | CORRECTING → COMPLETED (completion transaction only)
  | "reopened";            // COMPLETED → CORRECTING

export interface TransitionContext {
  now: Date;
  raceDate: Date;
  picksMade: number;
  totalSlots: number;
  /** `race.wentLiveAt !== null` */
  hasBeenLive: boolean;
}

interface Transition {
  from: RaceStatus[];
  to: RaceStatus;
  /** Extra condition beyond the arrow; returns a reason string when it fails. */
  guard?: (ctx: TransitionContext) => string | null;
}

const beforeRaceDate = (ctx: TransitionContext) =>
  ctx.now < ctx.raceDate ? null : "Picks are closed: the race start time has passed.";

export const TRANSITIONS: Record<TransitionReason, Transition> = {
  order_generated: { from: ["UPCOMING"], to: "DRAFTING" },
  order_regenerated: { from: ["DRAFTING", "LOCKED"], to: "UPCOMING", guard: beforeRaceDate },
  draft_filled: {
    from: ["DRAFTING"],
    to: "LOCKED",
    guard: (ctx) =>
      ctx.picksMade === ctx.totalSlots
        ? null
        : `The draft is not full (${ctx.picksMade} of ${ctx.totalSlots} picks made).`,
  },
  deadline_passed: { from: ["DRAFTING"], to: "LOCKED" },
  draft_reopened: {
    from: ["LOCKED"],
    to: "DRAFTING",
    guard: (ctx) =>
      ctx.hasBeenLive ? "The race has already gone live; the draft can't be reopened." : beforeRaceDate(ctx),
  },
  // The caller sets wentLiveAt if it is null.
  green_flag: { from: ["LOCKED"], to: "LIVE" },
  false_start: { from: ["LIVE"], to: "LOCKED" },
  // Only the completion transaction may use this; the status override endpoint must reject it.
  completed: { from: ["LIVE", "CORRECTING"], to: "COMPLETED" },
  reopened: { from: ["COMPLETED"], to: "CORRECTING" },
};

/** The status a transition leads to. */
export function transitionTarget(reason: TransitionReason): RaceStatus {
  return TRANSITIONS[reason].to;
}

/** Returns null if allowed, or a human-readable reason it is not. Pure; the caller supplies `now`. */
export function checkTransition(
  from: RaceStatus,
  reason: TransitionReason,
  ctx: TransitionContext,
): string | null {
  const transition = TRANSITIONS[reason];
  if (!transition) return `Unknown transition "${reason}".`;
  if (!transition.from.includes(from)) {
    return `Can't apply "${reason}" to a ${from} race.`;
  }
  return transition.guard?.(ctx) ?? null;
}
