import type { RaceDetail } from "@dnd/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { keys, useInvalidateRace, useLive } from "../queries";
import { CarListField, parseCarList } from "./CarListField";
import { ConfirmRow } from "./ConfirmRow";
import { ErrorText } from "./QueryState";

/**
 * Completion and corrections (SPEC Section 8). Complete is always available on a LIVE or CORRECTING race; reopening a
 * completed one lets the commissioner fix positions, and re-completing keeps every fix.
 */
export function ResultsPanel({ race }: { race: RaceDetail }) {
  const queryClient = useQueryClient();
  const refresh = useInvalidateRace(race.id);
  const editable = race.status === "LIVE" || race.status === "CORRECTING";
  const live = useLive(race.id, editable);
  const [confirming, setConfirming] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const [paste, setPaste] = useState("");
  const [fixes, setFixes] = useState<Record<string, string>>({});

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

  const parsed = parseCarList(paste, race.entries);
  const pasted = parsed.driverIds.length;
  const replace = useMutation({
    mutationFn: () => api.replaceResults(race.id, parsed.driverIds.map((driverId, i) => ({ driverId, finishPosition: i + 1 }))),
    onSuccess: (view) => {
      queryClient.setQueryData(keys.live(race.id), view);
      refresh();
      setPaste("");
    },
  });

  const pending = Object.entries(fixes).filter(([, v]) => v !== "");
  const patch = useMutation({
    mutationFn: () => api.patchResults(race.id, pending.map(([driverId, v]) => ({ driverId, finishPosition: Number(v) }))),
    onSuccess: (view) => {
      queryClient.setQueryData(keys.live(race.id), view);
      refresh();
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
        <ErrorText error={reopen.error} />
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
          <ConfirmRow
            label={complete.isPending ? "Completing…" : "Complete the race"}
            pending={complete.isPending}
            onConfirm={() => complete.mutate()}
            onCancel={() => setConfirming(false)}
          />
        </div>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setConfirming(true)}>
          Complete the race
        </button>
      )}
      <ErrorText error={complete.error} />

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
          <ErrorText error={patch.error} />
        </div>
      )}

      <CarListField
        label={`${rows.length ? "Or replace the whole finishing order" : "No results from the feed — paste the finishing order"}: one car number per line, winner first`}
        value={paste}
        onChange={setPaste}
        parsed={parsed}
      />
      <button type="button" className="btn-secondary" disabled={!parsed.valid || replace.isPending} onClick={() => replace.mutate()}>
        {pasted ? `Save finishing order (${pasted} cars)` : "Save finishing order"}
      </button>
      <ErrorText error={replace.error} />
    </section>
  );
}
