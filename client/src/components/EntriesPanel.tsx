import type { RaceDetail, RaceEntryView } from "@dnd/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { keys, useInvalidateRace, useRaces } from "../queries";
import { ErrorText } from "./QueryState";
import { SearchInput } from "./SearchInput";

/** The race's entry list: import from the feed, copy from another race, add, withdraw, remove. */
export function EntriesPanel({ race }: { race: RaceDetail }) {
  const invalidate = useInvalidateRace(race.id);
  const races = useRaces();
  const drivers = useQuery({ queryKey: keys.drivers, queryFn: api.listDrivers });
  const [warning, setWarning] = useState<string | null>(null);

  // Default copy source: the latest earlier race that has entries.
  const sources = (races.data ?? []).filter((r) => r.id !== race.id && r.entryCount > 0);
  const defaultSource = [...sources].reverse().find((r) => Date.parse(r.raceDate) < Date.parse(race.raceDate)) ?? sources.at(-1);
  const [sourceId, setSourceId] = useState("");
  const chosenSource = sourceId || defaultSource?.id || "";

  const entered = useMemo(() => new Set(race.entries.map((e) => e.driverId)), [race.entries]);
  const notEntered = (drivers.data ?? []).filter((d) => !entered.has(d.id));

  const copy = useMutation({ mutationFn: () => api.copyEntries(race.id, chosenSource), onSuccess: invalidate });
  const importFeed = useMutation({ mutationFn: () => api.importEntries(race.id), onSuccess: invalidate });
  const addAll = useMutation({
    mutationFn: () => api.addEntries(race.id, notEntered.map((d) => d.id)),
    onSuccess: invalidate,
  });
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
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={importFeed.isPending || race.nascarRaceId === null}
            onClick={() => importFeed.mutate()}
          >
            {importFeed.isPending ? "Importing…" : "Import entry list from NASCAR"}
          </button>
          {race.nascarRaceId === null && (
            <p className="text-xs text-slate-500">Set the NASCAR race ID under Race details to import.</p>
          )}
          {importFeed.isSuccess && (
            <p className="text-sm text-green-400">
              Added {importFeed.data.added}, updated {importFeed.data.updated} car number
              {importFeed.data.updated === 1 ? "" : "s"}. Nothing is removed — withdraw anyone who isn't running.
            </p>
          )}
        </div>
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
            Add all {notEntered.length} {race.entries.length ? "remaining " : ""}drivers
          </button>
        )}
        <ErrorText error={copy.error ?? addAll.error ?? importFeed.error} />
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
      <ErrorText error={toggle.error ?? remove.error} />
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
      <SearchInput placeholder="Name or car number" value={query} onChange={setQuery} />
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
      <ErrorText error={add.error} />
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
      <ErrorText error={create.error} />
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
