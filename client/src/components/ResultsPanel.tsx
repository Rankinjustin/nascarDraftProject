import type { RaceDetail } from "@dnd/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";

/** One car number per line, "#" optional. */
function carLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/^#/, ""))
    .filter(Boolean);
}

/**
 * Completion and corrections (SPEC Section 8). Complete is always available on a LIVE or CORRECTING race; reopening a
 * completed one lets the commissioner fix positions, and re-completing keeps every fix.
 */
export function ResultsPanel({ race, onChanged }: { race: RaceDetail; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const editable = race.status === "LIVE" || race.status === "CORRECTING";
  const liveKey = ["live", race.id];
  const live = useQuery({ queryKey: liveKey, queryFn: () => api.getLive(race.id), enabled: editable });
  const [confirming, setConfirming] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const [paste, setPaste] = useState("");
  const [fixes, setFixes] = useState<Record<string, string>>({});

  const refresh = () => {
    onChanged();
    void queryClient.invalidateQueries({ queryKey: liveKey });
  };
  const complete = useMutation({
    mutationFn: () => api.completeRace(race.id),
    onSuccess: () => {
      setConfirming(false);
      refresh();
    },
  });
  const reopen = useMutation({
    mutationFn: () => api.reopenRace(race.id, reopenNote || undefined),
    onSuccess: () => {
      setReopenNote("");
      refresh();
    },
  });

  // Pasted finishing order maps car numbers through this race's entries.
  const byCar = new Map(race.entries.map((e) => [e.carNumber, e]));
  const lines = carLines(paste);
  const unmatched = [...new Set(lines.filter((l) => !byCar.has(l)))];
  const duplicates = [...new Set(lines.filter((l, i) => lines.indexOf(l) !== i))];
  const replace = useMutation({
    mutationFn: () =>
      api.replaceResults(
        race.id,
        lines.map((car, i) => ({ driverId: byCar.get(car)!.driverId, finishPosition: i + 1 })),
      ),
    onSuccess: (view) => {
      queryClient.setQueryData(liveKey, view);
      setPaste("");
    },
  });

  const pending = Object.entries(fixes).filter(([, v]) => v !== "");
  const patch = useMutation({
    mutationFn: () => api.patchResults(race.id, pending.map(([driverId, v]) => ({ driverId, finishPosition: Number(v) }))),
    onSuccess: (view) => {
      queryClient.setQueryData(liveKey, view);
      setFixes({});
    },
  });

  if (race.status === "COMPLETED") {
    return (
      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">Results</h2>
        <p className="text-sm text-slate-400">
          This week is final. Reopen it to fix a finishing position (a DQ, a scoring error). The week is re-scored when
          you complete it again, and the league isn't notified a second time.
        </p>
        <input
          className="input"
          placeholder="Reason (optional, logged)"
          value={reopenNote}
          onChange={(e) => setReopenNote(e.target.value)}
        />
        <button type="button" className="btn-secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
          Reopen for corrections
        </button>
        {reopen.isError && <p className="text-sm text-red-400">{reopen.error.message}</p>}
      </section>
    );
  }
  if (!editable) return null;

  const rows = live.data?.runningOrder ?? [];
  return (
    <section className="card flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Results</h2>
        <span className="text-sm text-slate-400">{race.status === "CORRECTING" ? "Reopened for corrections" : "Live"}</span>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-700 p-3">
          <div className="font-semibold">Complete {race.raceName}?</div>
          {race.status === "LIVE" && live.data && !live.data.race.checkeredSeenAt && (
            <p className="text-sm text-amber-200">The feed hasn't reported a checkered flag. Complete anyway?</p>
          )}
          <p className="text-sm text-slate-400">
            Current positions become finishing positions (ones entered by hand are kept), the week is scored, and the
            league is notified.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={complete.isPending} onClick={() => complete.mutate()}>
              {complete.isPending ? "Completing…" : "Complete the race"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setConfirming(true)}>
          Complete the race
        </button>
      )}
      {complete.isError && <p className="text-sm text-red-400">{complete.error.message}</p>}

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label">Fix individual finishing positions</span>
          <ul className="flex max-h-96 flex-col divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
            {rows.map((r) => (
              <li key={r.driverId} className="flex items-center gap-2 px-2 py-1">
                <span className="w-8 text-right font-bold tabular-nums">{r.position ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-mono text-slate-400">#{r.carNumber}</span> {r.driverName}
                </span>
                <input
                  className="input min-h-9 w-20"
                  inputMode="numeric"
                  placeholder="New"
                  aria-label={`New finishing position for ${r.driverName}`}
                  value={fixes[r.driverId] ?? ""}
                  onChange={(e) => setFixes((f) => ({ ...f, [r.driverId]: e.target.value.replace(/\D/g, "") }))}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending.length === 0 || patch.isPending}
            onClick={() => patch.mutate()}
          >
            {pending.length ? `Save ${pending.length} fix${pending.length === 1 ? "" : "es"}` : "Save fixes"}
          </button>
          {patch.isError && <p className="text-sm text-red-400">{patch.error.message}</p>}
        </div>
      )}

      <label>
        <span className="label">
          {rows.length ? "Or replace the whole finishing order" : "No results from the feed — paste the finishing order"}:
          one car number per line, winner first
        </span>
        <textarea className="input min-h-32 py-2 font-mono" value={paste} onChange={(e) => setPaste(e.target.value)} />
      </label>
      {unmatched.length > 0 && (
        <p className="text-sm text-amber-300">Not in this race's entries: {unmatched.map((c) => `#${c}`).join(", ")}</p>
      )}
      {duplicates.length > 0 && <p className="text-sm text-amber-300">Listed twice: {duplicates.map((c) => `#${c}`).join(", ")}</p>}
      <button
        type="button"
        className="btn-secondary"
        disabled={lines.length === 0 || unmatched.length > 0 || duplicates.length > 0 || replace.isPending}
        onClick={() => replace.mutate()}
      >
        {lines.length ? `Save finishing order (${lines.length} cars)` : "Save finishing order"}
      </button>
      {replace.isError && <p className="text-sm text-red-400">{replace.error.message}</p>}
    </section>
  );
}
