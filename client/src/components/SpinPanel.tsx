import { ROUNDS, type DraftState } from "@dnd/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useUsers } from "../queries";
import { ErrorText } from "./QueryState";

/** Commissioner-only: choose who's in this week, then spin. The server decides the order. */
export function SpinPanel({ state, onSpun }: { state: DraftState; onSpun: (s: DraftState) => void }) {
  const users = useUsers();
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
      <ErrorText error={spin.error} />
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
