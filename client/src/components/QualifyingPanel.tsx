import type { RaceDetail } from "@dnd/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { keys, useInvalidateRace } from "../queries";
import { CarListField, parseCarList } from "./CarListField";
import { ErrorText } from "./QueryState";

/**
 * Manual starting lineup (SPEC Section 7): the fallback when the feed's qualifying window was missed, or for a
 * rain-out where the lineup is set by formula. Replaces the whole grid and stops the feed from overwriting it.
 */
export function QualifyingPanel({ race }: { race: RaceDetail }) {
  const queryClient = useQueryClient();
  const invalidateRace = useInvalidateRace(race.id);
  const grid = useQuery({ queryKey: keys.qualifying(race.id), queryFn: () => api.getQualifying(race.id) });
  const [text, setText] = useState("");
  const parsed = parseCarList(text, race.entries);

  const save = useMutation({
    mutationFn: () => api.setQualifying(race.id, parsed.driverIds.map((driverId, i) => ({ driverId, startPosition: i + 1 }))),
    onSuccess: (rows) => {
      queryClient.setQueryData(keys.qualifying(race.id), rows);
      invalidateRace();
      setText("");
    },
  });

  const rows = grid.data ?? [];
  const count = parsed.driverIds.length;
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Starting lineup</h2>
        <span className="text-sm text-slate-400">
          {rows.length === 0 ? "Not captured yet" : `${rows.length} cars · ${rows[0]!.source === "manual" ? "entered by hand" : "from the feed"}`}
        </span>
      </div>
      {rows.length > 0 && (
        <ol className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {rows.map((q) => (
            <li key={q.driverId} className="truncate">
              <span className="inline-block w-7 text-right text-slate-500">{q.startPosition}.</span>{" "}
              <span className="font-mono text-slate-400">#{q.carNumber}</span> {q.driverName}
            </li>
          ))}
        </ol>
      )}
      <CarListField label="Paste the lineup: one car number per line, pole first" value={text} onChange={setText} parsed={parsed} />
      <ErrorText error={save.error} />
      <button type="button" className="btn-secondary" disabled={!parsed.valid || save.isPending} onClick={() => save.mutate()}>
        {count ? `Save lineup (${count} cars)` : "Save lineup"}
      </button>
      <p className="text-xs text-slate-500">Saving replaces the whole grid. The feed won't overwrite a lineup entered here.</p>
    </section>
  );
}
