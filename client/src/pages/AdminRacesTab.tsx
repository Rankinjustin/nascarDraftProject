import type { RaceSummary } from "@dnd/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { formatRaceDate, fromDatetimeLocal } from "../dates";

export const racesKey = ["races"] as const;
const STALE_LIVE_MS = 24 * 60 * 60 * 1000;

export function AdminRacesTab() {
  const races = useQuery({ queryKey: racesKey, queryFn: () => api.listRaces() });
  const [showPast, setShowPast] = useState(false);
  const [creating, setCreating] = useState(false);

  const now = Date.now();
  const all = races.data ?? [];
  // A race stays in the main list until it's completed, so nothing in progress gets hidden.
  const isPast = (r: RaceSummary) => r.status === "COMPLETED" || (r.status === "UPCOMING" && Date.parse(r.raceDate) < now);
  const stale = all.filter((r) => r.status === "LIVE" && now - Date.parse(r.raceDate) > STALE_LIVE_MS);
  const shown = showPast ? all : all.filter((r) => !isPast(r));

  return (
    <section className="flex flex-col gap-4">
      {stale.map((r) => (
        <Link key={r.id} to={`/admin/races/${r.id}`} className="card flex items-start gap-3 border-amber-700">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={20} />
          <div>
            <div className="font-semibold text-amber-200">Complete this race</div>
            <div className="text-sm text-slate-300">
              {r.raceName} is still live a day after it started. Until it's completed it can hide next week's draft.
            </div>
          </div>
        </Link>
      ))}

      {creating ? (
        <NewRaceForm onDone={() => setCreating(false)} />
      ) : (
        <button type="button" className="btn-secondary gap-2" onClick={() => setCreating(true)}>
          <Plus size={18} />
          New race
        </button>
      )}

      {races.isPending && <p className="text-slate-400">Loading…</p>}
      {races.isError && <p className="text-red-400">{races.error.message}</p>}
      {races.isSuccess && all.length === 0 && <p className="text-slate-400">No races in the current season yet.</p>}

      <ul className="flex flex-col gap-2">
        {shown.map((r) => (
          <li key={r.id}>
            <Link to={`/admin/races/${r.id}`} className="card flex items-center gap-3 hover:border-slate-600">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{r.raceName}</span>
                  <StatusBadge status={r.status} raceDate={r.raceDate} />
                </div>
                <div className="truncate text-sm text-slate-400">{r.trackName}</div>
                <div className="text-sm text-slate-400">
                  {formatRaceDate(r.raceDate)} · {r.entryCount ? `${r.entryCount} entries` : "no entries"}
                </div>
              </div>
              <ChevronRight className="shrink-0 text-slate-500" size={20} />
            </Link>
          </li>
        ))}
      </ul>

      {all.some(isPast) && (
        <button type="button" className="btn-secondary" onClick={() => setShowPast((v) => !v)}>
          {showPast ? "Hide past races" : `Show past races (${all.filter(isPast).length})`}
        </button>
      )}
    </section>
  );
}

function NewRaceForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [raceName, setRaceName] = useState("");
  const [trackName, setTrackName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [nascarRaceId, setNascarRaceId] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createRace({
        raceName,
        trackName,
        raceDate: fromDatetimeLocal(raceDate),
        nascarRaceId: nascarRaceId ? Number(nascarRaceId) : null,
      }),
    onSuccess: (race) => {
      void queryClient.invalidateQueries({ queryKey: racesKey });
      navigate(`/admin/races/${race.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3">
      <div className="font-semibold">New race</div>
      <label>
        <span className="label">Race name</span>
        <input className="input" value={raceName} onChange={(e) => setRaceName(e.target.value)} />
      </label>
      <label>
        <span className="label">Track</span>
        <input className="input" value={trackName} onChange={(e) => setTrackName(e.target.value)} />
      </label>
      <label>
        <span className="label">Published start time (your time zone) — picks close then</span>
        <input
          className="input"
          type="datetime-local"
          value={raceDate}
          onChange={(e) => setRaceDate(e.target.value)}
        />
      </label>
      <label>
        <span className="label">NASCAR race ID (optional, needed before race weekend)</span>
        <input
          className="input"
          inputMode="numeric"
          value={nascarRaceId}
          onChange={(e) => setNascarRaceId(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      {create.isError && <p className="text-sm text-red-400">{create.error.message}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={create.isPending || !raceName || !trackName || !raceDate}
        >
          Create race
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
