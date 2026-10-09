import type { RaceSummary } from "@dnd/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { QueryState, ErrorText } from "../components/QueryState";
import { RaceCard } from "../components/RaceCard";
import { RaceFields, raceFormValues } from "../components/RaceFields";
import { keys, useRaces } from "../queries";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_LIVE_MS = DAY_MS;
/** How close to the start a race without a NASCAR id gets flagged. */
const FEED_ID_WARNING_MS = 3 * DAY_MS;

export function AdminRacesTab() {
  const races = useRaces();
  const [showPast, setShowPast] = useState(false);
  const [creating, setCreating] = useState(false);

  const now = Date.now();
  const all = races.data ?? [];
  // A race stays in the main list until it's completed, so nothing in progress gets hidden.
  const isPast = (r: RaceSummary) => r.status === "COMPLETED" || (r.status === "UPCOMING" && Date.parse(r.raceDate) < now);
  const alerts = [
    ...all
      .filter((r) => r.status === "LIVE" && now - Date.parse(r.raceDate) > STALE_LIVE_MS)
      .map((r) => ({
        race: r,
        title: "Complete this race",
        body: `${r.raceName} is still live a day after it started. Until it's completed it can hide next week's draft.`,
      })),
    // The poller ignores a race without its NASCAR id: no live results, no qualifying capture (SPEC Section 7).
    ...all
      .filter(
        (r) =>
          (r.status === "DRAFTING" || r.status === "LOCKED") &&
          r.nascarRaceId === null &&
          Date.parse(r.raceDate) - now < FEED_ID_WARNING_MS,
      )
      .map((r) => ({
        race: r,
        title: "Set the NASCAR race ID",
        body: `${r.raceName} has no NASCAR race ID, so the live feed won't capture qualifying or results for it.`,
      })),
  ];
  const shown = showPast ? all : all.filter((r) => !isPast(r));

  return (
    <section className="flex flex-col gap-4">
      {alerts.map((a) => (
        <Link key={`${a.title}-${a.race.id}`} to={`/admin/races/${a.race.id}`} className="card flex items-start gap-3 border-amber-700">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={20} />
          <div>
            <div className="font-semibold text-amber-200">{a.title}</div>
            <div className="text-sm text-slate-300">{a.body}</div>
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

      <QueryState query={races} />
      {races.isSuccess && all.length === 0 && <p className="text-slate-400">No races in the current season yet.</p>}

      <ul className="flex flex-col gap-2">
        {shown.map((r) => (
          <li key={r.id}>
            <Link to={`/admin/races/${r.id}`} className="block rounded-xl hover:opacity-90">
              <RaceCard race={r} compact>
                <div className="text-sm text-slate-400">{r.entryCount ? `${r.entryCount} entries` : "no entries"}</div>
              </RaceCard>
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
  const create = useMutation({
    mutationFn: (form: HTMLFormElement) => api.createRace(raceFormValues(form)),
    onSuccess: (race) => {
      void queryClient.invalidateQueries({ queryKey: keys.races });
      void queryClient.invalidateQueries({ queryKey: keys.currentRace });
      navigate(`/admin/races/${race.id}`);
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    create.mutate(e.currentTarget);
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3">
      <div className="font-semibold">New race</div>
      <RaceFields />
      <ErrorText error={create.error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1" disabled={create.isPending}>
          Create race
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
