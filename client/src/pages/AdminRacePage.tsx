import {
  checkTransition,
  OVERRIDE_REASONS,
  SCORING_RULES,
  TRANSITIONS,
  type OverrideReason,
  type RaceDetail,
  type RaceEntryView,
} from "@dnd/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { formatRaceDate, fromDatetimeLocal, toDatetimeLocal } from "../dates";
import { racesKey } from "./AdminRacesTab";

const raceKey = (id: string) => ["race", id] as const;

export function AdminRacePage() {
  const { raceId = "" } = useParams();
  const race = useQuery({ queryKey: raceKey(raceId), queryFn: () => api.getRace(raceId) });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link to="/admin" className="flex min-h-11 items-center gap-2 text-slate-400 hover:text-white">
        <ArrowLeft size={18} />
        All races
      </Link>
      {race.isPending && <p className="text-slate-400">Loading…</p>}
      {race.isError && <p className="text-red-400">{race.error.message}</p>}
      {race.data && (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{race.data.raceName}</h1>
              <StatusBadge status={race.data.status} raceDate={race.data.raceDate} />
            </div>
            <div className="text-slate-400">
              {race.data.trackName} · {formatRaceDate(race.data.raceDate)}
            </div>
            <Link to={`/draft/${race.data.id}`} className="mt-2 inline-block text-sky-400 hover:underline">
              {race.data.status === "UPCOMING" ? "Spin the wheel in the draft room" : "Open the draft room"}
            </Link>
          </div>
          <StatusPanel race={race.data} />
          {/* Keyed so the form resets to the saved values after another commissioner's edit lands. */}
          <DetailsForm key={`${race.data.raceDate}|${race.data.raceName}`} race={race.data} />
          <EntriesPanel race={race.data} />
        </>
      )}
    </div>
  );
}

function useRaceInvalidation(raceId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: raceKey(raceId) });
    void queryClient.invalidateQueries({ queryKey: racesKey });
  };
}

const OVERRIDE_LABELS: Record<OverrideReason, { label: string; help: string }> = {
  deadline_passed: { label: "Close the draft now", help: "Locks the draft early. Empty slots score as DNS." },
  draft_reopened: { label: "Reopen the draft", help: "Back to drafting. Only before the start time, and never after the race went live." },
  green_flag: { label: "Mark the race live", help: "Use when the feed didn't promote it (or there's no feed)." },
  false_start: { label: "Undo going live", help: "Back to locked, for when a feed glitch promoted it early." },
};

function StatusPanel({ race }: { race: RaceDetail }) {
  const invalidate = useRaceInvalidation(race.id);
  const [pending, setPending] = useState<OverrideReason | null>(null);
  const [note, setNote] = useState("");
  const override = useMutation({
    mutationFn: (reason: OverrideReason) => api.overrideStatus(race.id, reason, note || undefined),
    onSuccess: () => {
      setPending(null);
      setNote("");
      invalidate();
    },
  });

  // The server decides; this only hides buttons that can't apply to the current status.
  const ctx = {
    now: new Date(),
    raceDate: new Date(race.raceDate),
    picksMade: race.picksMade,
    totalSlots: race.totalSlots,
    hasBeenLive: race.wentLiveAt !== null,
  };
  // Only reasons that start from this status; time-based refusals stay visible with their explanation.
  const options = OVERRIDE_REASONS.filter((reason) => TRANSITIONS[reason].from.includes(race.status)).map((reason) => ({
    reason,
    refusal: checkTransition(race.status, reason, ctx),
  }));

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Status override</h2>
        {race.totalSlots > 0 && (
          <span className="text-sm text-slate-400">
            {race.picksMade} of {race.totalSlots} picks
          </span>
        )}
      </div>
      {options.length === 0 && (
        <p className="text-sm text-slate-400">
          {race.status === "UPCOMING"
            ? "The draft opens when the wheel is spun in the draft room."
            : "No overrides apply right now."}
        </p>
      )}
      {options.map(({ reason, refusal }) =>
        pending === reason ? (
          <div key={reason} className="flex flex-col gap-2 rounded-lg border border-amber-700 p-3">
            <div className="font-semibold">{OVERRIDE_LABELS[reason].label}?</div>
            <p className="text-sm text-slate-400">{OVERRIDE_LABELS[reason].help} This is logged for the league.</p>
            <input
              className="input"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={override.isPending}
                onClick={() => override.mutate(reason)}
              >
                Confirm
              </button>
              <button type="button" className="btn-secondary" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div key={reason}>
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={refusal !== null || override.isPending}
              onClick={() => {
                override.reset();
                setPending(reason);
              }}
            >
              {OVERRIDE_LABELS[reason].label}
            </button>
            {refusal && <p className="mt-1 text-xs text-slate-500">{refusal}</p>}
          </div>
        ),
      )}
      {override.isError && <p className="text-sm text-red-400">{override.error.message}</p>}
    </section>
  );
}

function DetailsForm({ race }: { race: RaceDetail }) {
  const invalidate = useRaceInvalidation(race.id);
  const [raceName, setRaceName] = useState(race.raceName);
  const [trackName, setTrackName] = useState(race.trackName);
  const [raceDate, setRaceDate] = useState(toDatetimeLocal(race.raceDate));
  const [nascarRaceId, setNascarRaceId] = useState(race.nascarRaceId?.toString() ?? "");
  const [scoringRuleKey, setScoringRuleKey] = useState(race.scoringRuleKey);
  const [saved, setSaved] = useState(false);
  const isFinal = race.status === "COMPLETED" || race.status === "CORRECTING";

  const save = useMutation({
    mutationFn: () =>
      api.updateRace(race.id, {
        raceName,
        trackName,
        raceDate: fromDatetimeLocal(raceDate),
        nascarRaceId: nascarRaceId ? Number(nascarRaceId) : null,
        ...(isFinal ? {} : { scoringRuleKey }),
      }),
    onSuccess: () => {
      setSaved(true);
      invalidate();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3">
      <h2 className="font-semibold">Race details</h2>
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
        <span className="label">NASCAR race ID</span>
        <input
          className="input"
          inputMode="numeric"
          value={nascarRaceId}
          onChange={(e) => setNascarRaceId(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      <label>
        <span className="label">Scoring</span>
        <select
          className="input"
          value={scoringRuleKey}
          disabled={isFinal}
          onChange={(e) => setScoringRuleKey(e.target.value)}
        >
          {Object.values(SCORING_RULES).map((rule) => (
            <option key={rule.key} value={rule.key}>
              {rule.label}
            </option>
          ))}
        </select>
      </label>
      {save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}
      {saved && !save.isPending && <p className="text-sm text-green-400">Saved.</p>}
      <button type="submit" className="btn-primary" disabled={save.isPending || !raceName || !trackName || !raceDate}>
        Save details
      </button>
    </form>
  );
}

function EntriesPanel({ race }: { race: RaceDetail }) {
  const invalidate = useRaceInvalidation(race.id);
  const races = useQuery({ queryKey: racesKey, queryFn: () => api.listRaces() });
  const drivers = useQuery({ queryKey: ["drivers"], queryFn: api.listDrivers });
  const [warning, setWarning] = useState<string | null>(null);

  // Default copy source: the latest earlier race that has entries.
  const sources = (races.data ?? []).filter((r) => r.id !== race.id && r.entryCount > 0);
  const defaultSource = [...sources].reverse().find((r) => Date.parse(r.raceDate) < Date.parse(race.raceDate)) ?? sources.at(-1);
  const [sourceId, setSourceId] = useState("");
  const chosenSource = sourceId || defaultSource?.id || "";

  const entered = useMemo(() => new Set(race.entries.map((e) => e.driverId)), [race.entries]);
  const notEntered = (drivers.data ?? []).filter((d) => d.isActive && !entered.has(d.id));

  const copy = useMutation({ mutationFn: () => api.copyEntries(race.id, chosenSource), onSuccess: invalidate });
  const addAll = useMutation({
    mutationFn: () => api.addEntries(race.id, notEntered.map((d) => d.id)),
    onSuccess: invalidate,
  });
  const error = copy.error ?? addAll.error;
  const eligible = race.entries.filter((e) => e.isEligible).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Entry list</h2>
        <span className="text-sm text-slate-400">
          {eligible} eligible{race.entries.length > eligible ? ` of ${race.entries.length}` : ""}
        </span>
      </div>

      <div className="card flex flex-col gap-3">
        {sources.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="label">Copy eligible entries from another race</span>
            <select className="input" value={chosenSource} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.raceName} ({r.entryCount})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary"
              disabled={copy.isPending || !chosenSource}
              onClick={() => copy.mutate()}
            >
              Copy entries
            </button>
          </div>
        )}
        {notEntered.length > 0 && (
          <button type="button" className="btn-secondary" disabled={addAll.isPending} onClick={() => addAll.mutate()}>
            Add all {notEntered.length} {race.entries.length ? "remaining " : ""}active drivers
          </button>
        )}
        {error && <p className="text-sm text-red-400">{error.message}</p>}
      </div>

      <AddDriver raceId={race.id} candidates={notEntered} onAdded={invalidate} />

      {warning && (
        <div className="card border-amber-700 text-sm text-amber-200">
          {warning}{" "}
          <button type="button" className="underline" onClick={() => setWarning(null)}>
            Dismiss
          </button>
        </div>
      )}

      {race.entries.length === 0 ? (
        <p className="text-slate-400">No entries yet. The draft needs at least 3 eligible drivers per player.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-800 rounded-xl border border-slate-800">
          {race.entries.map((entry) => (
            <EntryRow key={entry.id} raceId={race.id} entry={entry} onChanged={invalidate} onWarning={setWarning} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EntryRow({
  raceId,
  entry,
  onChanged,
  onWarning,
}: {
  raceId: string;
  entry: RaceEntryView;
  onChanged: () => void;
  onWarning: (warning: string) => void;
}) {
  const toggle = useMutation({
    mutationFn: () => api.updateEntry(raceId, entry.id, { isEligible: !entry.isEligible }),
    onSuccess: ({ warning }) => {
      if (warning) onWarning(warning);
      onChanged();
    },
  });
  const remove = useMutation({ mutationFn: () => api.deleteEntry(raceId, entry.id), onSuccess: onChanged });
  const error = toggle.error ?? remove.error;

  return (
    <li className={`flex flex-col gap-1 px-3 py-2 ${entry.isEligible ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3">
        <span className="w-10 shrink-0 text-right font-mono text-lg font-bold text-slate-300">#{entry.carNumber}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {entry.driverName}
            {entry.isDrafted && <span className="ml-2 text-xs font-normal text-sky-300">drafted</span>}
            {!entry.isEligible && <span className="ml-2 text-xs font-normal text-amber-300">⚠ withdrawn</span>}
          </div>
          {entry.teamName && <div className="truncate text-xs text-slate-500">{entry.teamName}</div>}
        </div>
        <button
          type="button"
          className="btn-secondary px-3 text-sm"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {entry.isEligible ? "Withdraw" : "Reinstate"}
        </button>
        <button
          type="button"
          aria-label={`Remove ${entry.driverName}`}
          title={entry.isDrafted ? "Drafted drivers can't be removed; withdraw them instead." : "Remove"}
          className="btn-secondary px-3"
          disabled={entry.isDrafted || remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </li>
  );
}

function AddDriver({
  raceId,
  candidates,
  onAdded,
}: {
  raceId: string;
  candidates: { id: string; driverName: string; carNumber: string }[];
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const add = useMutation({
    mutationFn: (driverId: string) => api.addEntries(raceId, [driverId]),
    onSuccess: () => {
      setQuery("");
      onAdded();
    },
  });

  const q = query.trim().toLowerCase();
  const matches = q
    ? candidates.filter((d) => d.driverName.toLowerCase().includes(q) || d.carNumber === q.replace("#", "")).slice(0, 8)
    : [];

  return (
    <div className="card flex flex-col gap-2">
      <span className="label">Add a driver</span>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
        <input
          className="input pl-10"
          placeholder="Name or car number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {matches.map((d) => (
        <button
          key={d.id}
          type="button"
          className="btn-secondary justify-start gap-3"
          disabled={add.isPending}
          onClick={() => add.mutate(d.id)}
        >
          <span className="w-10 text-right font-mono">#{d.carNumber}</span>
          {d.driverName}
        </button>
      ))}
      {q && matches.length === 0 && <p className="text-sm text-slate-400">No match among drivers not yet entered.</p>}
      {add.isError && <p className="text-sm text-red-400">{add.error.message}</p>}
      {showNew ? (
        <NewDriverForm raceId={raceId} onDone={() => setShowNew(false)} onAdded={onAdded} />
      ) : (
        <button type="button" className="text-left text-sm text-sky-400 hover:underline" onClick={() => setShowNew(true)}>
          Driver not listed? Add a new one
        </button>
      )}
    </div>
  );
}

function NewDriverForm({ raceId, onDone, onAdded }: { raceId: string; onDone: () => void; onAdded: () => void }) {
  const [driverName, setDriverName] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const create = useMutation({
    mutationFn: () => api.addNewDriver(raceId, { driverName, carNumber, teamName: teamName || null }),
    onSuccess: () => {
      onAdded();
      onDone();
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 p-3">
      <input className="input" placeholder="Driver name" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
      <input
        className="input"
        placeholder="Car number"
        inputMode="numeric"
        value={carNumber}
        onChange={(e) => setCarNumber(e.target.value.replace(/\D/g, "").slice(0, 3))}
      />
      <input className="input" placeholder="Team (optional)" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
      {create.isError && <p className="text-sm text-red-400">{create.error.message}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={create.isPending || !driverName || !carNumber}
          onClick={() => create.mutate()}
        >
          Add driver
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
