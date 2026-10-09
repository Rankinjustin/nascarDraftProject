import type { DraftState } from "@dnd/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { ConfirmRow } from "./ConfirmRow";
import { ErrorText } from "./QueryState";

/**
 * Collapsed by default so nothing here is tapped by accident (SPEC Section 11). The server enforces every
 * rule; this panel only offers the actions and shows the server's refusal when there is one.
 */
export function CommishPanel({
  state,
  meId,
  onBehalf,
  setOnBehalf,
  onState,
}: {
  state: DraftState;
  meId: string;
  onBehalf: boolean;
  setOnBehalf: (on: boolean) => void;
  onState: (state: DraftState) => void;
}) {
  const raceId = state.race.id;
  const editable = state.race.status === "DRAFTING" || state.race.status === "LOCKED";
  const beforeDeadline = Date.parse(state.deadline) > Date.now();
  const onClock = state.onTheClock;

  return (
    <details className="card border-amber-900">
      <summary className="min-h-11 cursor-pointer content-center font-semibold text-amber-200">Commish</summary>
      <div className="mt-3 flex flex-col gap-5">
        {!editable && (
          <p className="text-sm text-slate-400">
            Draft controls work while the race is drafting or locked. Once it's live, rosters are final.
          </p>
        )}

        {state.race.status === "DRAFTING" && onClock && onClock.userId !== meId && (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">Pick on behalf</h3>
            <p className="text-sm text-slate-400">Pick for whoever is on the clock. It's logged for the league.</p>
            <button
              type="button"
              className={onBehalf ? "btn-primary" : "btn-secondary"}
              onClick={() => setOnBehalf(!onBehalf)}
            >
              {onBehalf ? `Picking for ${onClock.displayName} — tap to stop` : `Pick for ${onClock.displayName}`}
            </button>
          </div>
        )}

        {editable && (
          <>
            <RevertLast raceId={raceId} state={state} onState={onState} />
            <SwapPick raceId={raceId} state={state} onState={onState} />
            <Destructive
              title="Reset the draft"
              help="Deletes every pick and keeps the order. Pick 1 is back on the clock."
              word="RESET"
              disabledReason={beforeDeadline ? null : "Picks are closed; use swap and revert instead."}
              action={() => api.resetDraft(raceId)}
              onState={onState}
            />
            <Destructive
              title="Regenerate the order"
              help="Deletes every pick and the draft order, so the wheel can be spun again."
              word="REGENERATE"
              disabledReason={beforeDeadline ? null : "Picks are closed; use swap and revert instead."}
              action={() => api.regenerateOrder(raceId)}
              onState={onState}
            />
          </>
        )}

        <Link to={`/admin/races/${raceId}`} className="text-sm text-sky-400 hover:underline">
          Race admin: entries, status override, details
        </Link>
      </div>
    </details>
  );
}

function RevertLast({ raceId, state, onState }: { raceId: string; state: DraftState; onState: (s: DraftState) => void }) {
  const [confirming, setConfirming] = useState(false);
  const last = state.picks.at(-1);
  const revert = useMutation({
    mutationFn: () => api.revertLastPick(raceId),
    onSuccess: (s) => {
      setConfirming(false);
      onState(s);
    },
  });
  if (!last) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">Revert last pick</h3>
      {confirming ? (
        <ConfirmRow
          label={`Revert pick ${last.overallPickNumber} (${last.driverName})`}
          pending={revert.isPending}
          onConfirm={() => revert.mutate()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
          Revert pick {last.overallPickNumber}: {last.displayName} — {last.driverName}
        </button>
      )}
      <ErrorText error={revert.error} />
    </div>
  );
}

function SwapPick({ raceId, state, onState }: { raceId: string; state: DraftState; onState: (s: DraftState) => void }) {
  // Default to a withdrawn pick, since that's the usual reason to swap.
  const [slot, setSlot] = useState("");
  const [driverId, setDriverId] = useState("");
  const chosenSlot = slot || String(state.picks.find((p) => p.isWithdrawn)?.overallPickNumber ?? "");
  const swap = useMutation({
    mutationFn: () => api.swapPick(raceId, Number(chosenSlot), driverId),
    onSuccess: (s) => {
      setSlot("");
      setDriverId("");
      onState(s);
    },
  });
  if (state.picks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">Swap the driver on a pick</h3>
      <p className="text-sm text-slate-400">For withdrawals: the pick keeps its slot and owner. Ask the member first.</p>
      <select className="input" value={chosenSlot} onChange={(e) => setSlot(e.target.value)}>
        <option value="">Choose a pick…</option>
        {state.picks.map((p) => (
          <option key={p.overallPickNumber} value={p.overallPickNumber}>
            {p.overallPickNumber}. {p.displayName} — #{p.carNumber} {p.driverName}
            {p.isWithdrawn ? " ⚠ withdrawn" : ""}
          </option>
        ))}
      </select>
      <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
        <option value="">Replacement driver…</option>
        {state.availableDrivers.map((d) => (
          <option key={d.driverId} value={d.driverId}>
            #{d.carNumber} {d.driverName}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-secondary"
        disabled={!chosenSlot || !driverId || swap.isPending}
        onClick={() => swap.mutate()}
      >
        Swap
      </button>
      <ErrorText error={swap.error} />
    </div>
  );
}

/** Typed confirmation for the actions that wipe picks (SPEC Section 6). */
function Destructive({
  title,
  help,
  word,
  disabledReason,
  action,
  onState,
}: {
  title: string;
  help: string;
  word: string;
  disabledReason: string | null;
  action: () => Promise<DraftState>;
  onState: (s: DraftState) => void;
}) {
  const [typed, setTyped] = useState("");
  const run = useMutation({
    mutationFn: action,
    onSuccess: (s) => {
      setTyped("");
      onState(s);
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-red-900 p-3">
      <h3 className="font-semibold text-red-300">{title}</h3>
      <p className="text-sm text-slate-400">{help}</p>
      {disabledReason ? (
        <p className="text-sm text-slate-500">{disabledReason}</p>
      ) : (
        <>
          <input
            className="input"
            placeholder={`Type ${word} to confirm`}
            autoCapitalize="characters"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary border-red-800 text-red-200"
            disabled={typed !== word || run.isPending}
            onClick={() => run.mutate()}
          >
            {title}
          </button>
        </>
      )}
      <ErrorText error={run.error} />
    </div>
  );
}
