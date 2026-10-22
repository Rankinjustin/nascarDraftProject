import { roundForPick, whoseTurn, type DraftState, type PublicUser } from "@dnd/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api, ApiError } from "../api";
import { useMe } from "../auth";
import { AuditLog } from "../components/AuditLog";
import { CommishPanel } from "../components/CommishPanel";
import { CurrentRaceRedirect } from "../components/CurrentRaceRedirect";
import { DraftBoard } from "../components/DraftBoard";
import { DriverPicker } from "../components/DriverPicker";
import { QueryState } from "../components/QueryState";
import { RaceCard } from "../components/RaceCard";
import { SpinPanel } from "../components/SpinPanel";
import { TurnBanner } from "../components/TurnBanner";
import { WheelSpinner } from "../components/WheelSpinner";
import { formatTime } from "../dates";
import { keys, useDraft, useInvalidateRace } from "../queries";

export function DraftPage() {
  const { raceId } = useParams();
  return raceId ? <DraftRoom key={raceId} raceId={raceId} /> : <CurrentRaceRedirect basePath="/draft" />;
}

// The wheel reveal plays once per order per device; "Replay the spin" brings it back (SPEC Section 10).
const wheelKey = (raceId: string) => `dnd:wheelSeen:${raceId}`;
const orderSignature = (state: DraftState) => state.order.map((o) => o.userId).join(",");
function hasSeenWheel(state: DraftState): boolean {
  try {
    return localStorage.getItem(wheelKey(state.race.id)) === orderSignature(state);
  } catch {
    return false;
  }
}
function markWheelSeen(state: DraftState): void {
  try {
    localStorage.setItem(wheelKey(state.race.id), orderSignature(state));
  } catch {
    // Private mode or blocked storage: the reveal will just play again next time.
  }
}

/** Applies a pick locally so the board updates before the server answers. The server's response replaces it. */
function withOptimisticPick(state: DraftState, driverId: string, me: PublicUser): DraftState {
  const driver = state.availableDrivers.find((d) => d.driverId === driverId);
  const slot = state.nextOverallPickNumber;
  if (!driver || !slot || !state.onTheClock) return state;
  // `slot` picks will have been made once this one lands.
  const nextUserId = whoseTurn(state.snake, slot);
  const next = state.order.find((o) => o.userId === nextUserId);
  return {
    ...state,
    picks: [
      ...state.picks,
      {
        overallPickNumber: slot,
        roundNumber: roundForPick(slot, state.order.length),
        userId: state.onTheClock.userId,
        displayName: state.onTheClock.displayName,
        driverId,
        driverName: driver.driverName,
        carNumber: driver.carNumber,
        createdByUserId: me.id,
        createdByName: me.displayName,
        isWithdrawn: false,
      },
    ],
    availableDrivers: state.availableDrivers.filter((d) => d.driverId !== driverId),
    onTheClock: next ? { userId: next.userId, displayName: next.displayName } : null,
    nextOverallPickNumber: next ? slot + 1 : null,
  };
}

function DraftRoom({ raceId }: { raceId: string }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const draft = useDraft(raceId, me?.id);
  const [onBehalf, setOnBehalf] = useState(false);
  const [wheel, setWheel] = useState<"auto" | "show" | "hidden">("auto");
  const [notice, setNotice] = useState<string | null>(null);

  const invalidateRace = useInvalidateRace(raceId);
  // Local only: the optimistic pick and its rollback.
  const setState = (state: DraftState) => queryClient.setQueryData(keys.draft(raceId), state);
  // A write's response. The draft is fresh, and every other view of the race (live page, audit log, race card) isn't.
  const applyResult = (state: DraftState) => {
    setState(state);
    invalidateRace();
  };
  const state = draft.data;

  // Picking on behalf only ever means "for whoever is on the clock now"; drop it when the turn moves on.
  const onClockId = state?.onTheClock?.userId;
  useEffect(() => setOnBehalf(false), [onClockId]);

  const pick = useMutation({
    mutationFn: ({ driverId, slot, forUserId }: { driverId: string; slot: number; forUserId?: string }) =>
      api.makePick(raceId, { driverId, overallPickNumber: slot, ...(forUserId ? { onBehalfOfUserId: forUserId } : {}) }),
    onMutate: async ({ driverId }) => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: keys.draft(raceId) });
      const previous = queryClient.getQueryData<DraftState>(keys.draft(raceId));
      if (previous && me) setState(withOptimisticPick(previous, driverId, me));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) setState(ctx.previous);
      const raced = err instanceof ApiError && ["STALE_BOARD", "DRIVER_TAKEN", "NOT_YOUR_TURN"].includes(err.code);
      setNotice(raced ? "Someone just picked — here's the updated board." : err.message);
      void queryClient.invalidateQueries({ queryKey: keys.draft(raceId) });
    },
    onSuccess: (next) => {
      applyResult(next);
      setOnBehalf(false);
    },
  });

  if (!state) return <QueryState query={draft} />;
  if (!me) return null;

  const isCommish = me.role === "COMMISSIONER";
  const hasOrder = state.order.length > 0;
  const showWheel = hasOrder && (wheel === "show" || (wheel === "auto" && !hasSeenWheel(state)));
  const myTurn = state.race.status === "DRAFTING" && state.onTheClock?.userId === me.id;
  const canPick = state.race.status === "DRAFTING" && (myTurn || (isCommish && onBehalf));

  const submitPick = (driverId: string) => {
    if (!state.nextOverallPickNumber || !state.onTheClock) return;
    pick.mutate({
      driverId,
      slot: state.nextOverallPickNumber,
      forUserId: onBehalf && !myTurn ? state.onTheClock.userId : undefined,
    });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-20">
      <RaceCard race={state.race} heading="h1">
        {draft.isError && (
          <div className="text-sm text-amber-300">Offline — showing the last update from {formatTime(draft.dataUpdatedAt)}</div>
        )}
        <QualifyingLine state={state} />
      </RaceCard>

      {showWheel ? (
        <WheelSpinner
          order={state.order}
          onDone={() => {
            markWheelSeen(state);
            setWheel("hidden");
          }}
        />
      ) : (
        <>
          <TurnBanner state={state} meId={me.id} />
          {notice && (
            <div className="card border-amber-700 text-sm text-amber-200" role="status">
              {notice}
            </div>
          )}

          {state.race.status === "UPCOMING" &&
            (isCommish ? (
              <SpinPanel state={state} onSpun={applyResult} />
            ) : (
              <p className="card text-slate-300">The draft opens when the commissioner spins the wheel.</p>
            ))}

          {hasOrder && (
            <>
              <DraftBoard state={state} meId={me.id} />
              <button
                type="button"
                className="self-start text-sm text-sky-400 hover:underline"
                onClick={() => setWheel("show")}
              >
                Replay the spin
              </button>
            </>
          )}

          {state.race.status === "DRAFTING" && (
            <DriverPicker
              drivers={state.availableDrivers}
              canPick={canPick}
              pickingFor={onBehalf && !myTurn ? (state.onTheClock?.displayName ?? null) : null}
              pending={pick.isPending}
              onPick={submitPick}
            />
          )}

          {isCommish && hasOrder && (
            <CommishPanel state={state} meId={me.id} onBehalf={onBehalf} setOnBehalf={setOnBehalf} onState={applyResult} />
          )}
          <AuditLog raceId={raceId} />
        </>
      )}
    </div>
  );
}

/** Before the race, once qualifying is in: the driver list is sorted by the grid. The time itself is on the race card. */
function QualifyingLine({ state }: { state: DraftState }) {
  if (state.race.status !== "UPCOMING" && state.race.status !== "DRAFTING" && state.race.status !== "LOCKED") return null;
  const gridIn = state.availableDrivers.some((d) => d.startPosition !== null);
  if (!gridIn) return null;
  return <div className="text-sm text-green-400">Starting grid is in — drivers are sorted by start position</div>;
}
