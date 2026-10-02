import { roundForPick, ROUNDS, type DraftState, type PublicUser } from "@dnd/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api";
import { useMe } from "../auth";
import { AuditLog } from "../components/AuditLog";
import { CommishPanel } from "../components/CommishPanel";
import { CurrentRaceRedirect } from "../components/CurrentRaceRedirect";
import { DraftBoard } from "../components/DraftBoard";
import { DriverPicker } from "../components/DriverPicker";
import { StatusBadge } from "../components/StatusBadge";
import { WheelSpinner } from "../components/WheelSpinner";
import { formatRaceDate, formatTime, timeUntil } from "../dates";

export const draftKey = (raceId: string) => ["draft", raceId] as const;

export function DraftPage() {
  const { raceId } = useParams();
  return raceId ? <DraftRoom key={raceId} raceId={raceId} /> : <CurrentRaceRedirect basePath="/draft" />;
}

/** Polls every 3s, or 10s while it's your turn — you're the one acting (SPEC Section 6, "Polling"). */
export function useDraft(raceId: string | undefined, meId: string | undefined, poll = true) {
  return useQuery({
    queryKey: draftKey(raceId ?? ""),
    queryFn: () => api.getDraft(raceId!),
    enabled: Boolean(raceId),
    refetchInterval: (query) => {
      if (!poll) return false;
      const state = query.state.data;
      if (!state) return 3_000;
      if (state.race.status === "UPCOMING" || state.race.status === "DRAFTING") {
        return state.onTheClock?.userId === meId ? 10_000 : 3_000;
      }
      return 30_000;
    },
  });
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
  const nextUserId = state.snake[slot] ?? null;
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

  const setState = (state: DraftState) => queryClient.setQueryData(draftKey(raceId), state);
  const state = draft.data;

  // Picking on behalf only ever means "for whoever is on the clock now"; drop it when the turn moves on.
  const onClockId = state?.onTheClock?.userId;
  useEffect(() => setOnBehalf(false), [onClockId]);

  const pick = useMutation({
    mutationFn: ({ driverId, slot, forUserId }: { driverId: string; slot: number; forUserId?: string }) =>
      api.makePick(raceId, { driverId, overallPickNumber: slot, ...(forUserId ? { onBehalfOfUserId: forUserId } : {}) }),
    onMutate: async ({ driverId }) => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: draftKey(raceId) });
      const previous = queryClient.getQueryData<DraftState>(draftKey(raceId));
      if (previous && me) setState(withOptimisticPick(previous, driverId, me));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) setState(ctx.previous);
      const raced = err instanceof ApiError && ["STALE_BOARD", "DRIVER_TAKEN", "NOT_YOUR_TURN"].includes(err.code);
      setNotice(raced ? "Someone just picked — here's the updated board." : err.message);
      void queryClient.invalidateQueries({ queryKey: draftKey(raceId) });
    },
    onSuccess: (next) => {
      setState(next);
      setOnBehalf(false);
    },
  });

  if (draft.isPending) return <p className="text-slate-400">Loading…</p>;
  if (draft.isError && !state) return <p className="text-red-400">{draft.error.message}</p>;
  if (!state || !me) return null;

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
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{state.race.raceName}</h1>
          <StatusBadge status={state.race.status} raceDate={state.race.raceDate} />
        </div>
        <div className="text-sm text-slate-400">
          {state.race.trackName}
          {draft.isError && ` · Offline — showing the last update from ${formatTime(draft.dataUpdatedAt)}`}
        </div>
      </div>

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
              <SpinPanel state={state} onSpun={setState} />
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
            <CommishPanel state={state} meId={me.id} onBehalf={onBehalf} setOnBehalf={setOnBehalf} onState={setState} />
          )}
          <AuditLog raceId={raceId} />
        </>
      )}
    </div>
  );
}

/** Persistent, high-contrast turn banner (SPEC Section 11). Shared with the dashboard. */
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

/** Commissioner-only: choose who's in this week, then spin. The server decides the order. */
function SpinPanel({ state, onSpun }: { state: DraftState; onSpun: (s: DraftState) => void }) {
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const active = (users.data ?? []).filter((u) => u.isActive);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const players = active.filter((u) => !excluded.has(u.id));
  const needed = players.length * ROUNDS;
  const eligible = state.availableDrivers.length;
  const closed = Date.parse(state.deadline) <= Date.now();

  const spin = useMutation({
    mutationFn: () => api.spinWheel(state.race.id, excluded.size > 0 ? players.map((u) => u.id) : undefined),
    onSuccess: onSpun,
  });

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Spin the wheel</h2>
      <p className="text-sm text-slate-400">
        The server sets the order the moment you tap; the wheel just reveals it. Uncheck anyone who's out this week.
      </p>
      {users.isPending && <p className="text-sm text-slate-400">Loading members…</p>}
      <ul className="flex flex-col gap-1">
        {active.map((u) => (
          <li key={u.id}>
            <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-slate-800">
              <input type="checkbox" className="h-5 w-5" checked={!excluded.has(u.id)} onChange={() => toggle(u.id)} />
              {u.displayName}
            </label>
          </li>
        ))}
      </ul>
      <p className={`text-sm ${eligible < needed ? "text-amber-300" : "text-slate-400"}`}>
        {players.length} players need {needed} eligible drivers; this race has {eligible}.{" "}
        {eligible < needed && (
          <Link to={`/admin/races/${state.race.id}`} className="underline">
            Manage entries
          </Link>
        )}
      </p>
      {closed && <p className="text-sm text-amber-300">The start time has passed; this race can't be drafted.</p>}
      {spin.isError && <p className="text-sm text-red-400">{spin.error.message}</p>}
      <button
        type="button"
        className="btn-primary"
        disabled={spin.isPending || players.length < 2 || eligible < needed || closed}
        onClick={() => spin.mutate()}
      >
        {spin.isPending ? "Spinning…" : `Spin for ${players.length} players`}
      </button>
    </section>
  );
}
