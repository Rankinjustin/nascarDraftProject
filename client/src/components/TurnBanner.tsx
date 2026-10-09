import { roundForPick, ROUNDS, type DraftState } from "@dnd/shared";
import { Link } from "react-router";
import { formatRaceDate, timeUntil } from "../dates";

/** Persistent, high-contrast turn banner (SPEC Section 11). Shown in the draft room and on the dashboard. */
export function TurnBanner({ state, meId }: { state: DraftState; meId: string }) {
  const status = state.race.status;
  const made = state.picks.length;
  const deadline = (
    <div className="text-sm opacity-80">
      Picks close {formatRaceDate(state.deadline)} ({timeUntil(state.deadline)})
    </div>
  );

  if (status === "DRAFTING" && state.onTheClock) {
    const slot = state.nextOverallPickNumber;
    if (state.onTheClock.userId === meId) {
      return (
        <div className="rounded-xl bg-sky-500 p-4 text-slate-950">
          <div className="text-xl font-extrabold">You're on the clock</div>
          <div className="font-semibold">
            Pick {slot} of {state.totalSlots} · Round {roundForPick(slot!, state.order.length)} of {ROUNDS}
          </div>
          {deadline}
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="text-lg font-bold">
          Waiting on {state.onTheClock.displayName} — pick {slot} of {state.totalSlots}
        </div>
        {deadline}
      </div>
    );
  }
  if (status === "UPCOMING") {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="text-lg font-bold">The draft hasn't opened yet</div>
        {deadline}
      </div>
    );
  }
  if (status === "LOCKED") {
    return (
      <div className="rounded-xl border border-amber-800 bg-amber-950 p-4 text-amber-100">
        <div className="text-lg font-bold">{made === state.totalSlots ? "The draft is complete" : "Picks are closed"}</div>
        <div className="text-sm">
          {made === state.totalSlots
            ? "Every pick is in. Rosters lock at the green flag."
            : `${made} of ${state.totalSlots} picks were made. Empty slots score as DNS.`}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <div className="text-lg font-bold">Rosters are final</div>
      <Link to={`/live/${state.race.id}`} className="text-sm text-sky-400 hover:underline">
        Go to the race
      </Link>
    </div>
  );
}
