import type { DraftEventView } from "@dnd/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { formatRaceDate } from "../dates";

const REASONS: Record<string, string> = {
  order_generated: "draft opened",
  order_regenerated: "order thrown out",
  draft_filled: "draft complete",
  deadline_passed: "picks closed",
  draft_reopened: "draft reopened",
  green_flag: "race live",
  false_start: "back to locked",
  completed: "race completed",
  reopened: "reopened for corrections",
};

type Payload = Record<string, any>;

/** One line per event, e.g. "Commish picked #9 Chase Elliott for Kyle (pick 7)". */
export function describeEvent(e: DraftEventView): string {
  const p = e.payload as Payload;
  const who = e.actorName ?? "System";
  switch (e.type) {
    case "ORDER_GENERATED":
      return `${who} spun the wheel: ${(p.order as Payload[]).map((o) => `${o.pickPosition}. ${o.displayName}`).join(", ")}`;
    case "ORDER_REGENERATED":
      return `${who} threw out the draft order (${p.picksDeleted} picks deleted) for a new spin`;
    case "PICK_MADE":
      return `${p.displayName} took #${p.carNumber} ${p.driverName} (pick ${p.overallPickNumber})`;
    case "PICK_MADE_ON_BEHALF":
      return `${who} picked #${p.carNumber} ${p.driverName} for ${p.displayName} (pick ${p.overallPickNumber})`;
    case "PICK_REVERTED":
      return `${who} reverted pick ${p.overallPickNumber} (${p.driverName} from ${p.displayName})`;
    case "PICK_SWAPPED":
      return `${who} swapped pick ${p.overallPickNumber} for ${p.displayName}: ${p.from?.driverName} → ${p.to?.driverName}`;
    case "DRAFT_RESET":
      return `${who} reset the draft (${p.picksDeleted} picks deleted)`;
    case "STATUS_CHANGED":
      return `${who}: ${REASONS[p.reason] ?? p.reason} (${p.from} → ${p.to})${p.note ? ` — “${p.note}”` : ""}`;
    case "RESULTS_CORRECTED":
      return `${who} corrected results`;
  }
}

function EventList({ raceId }: { raceId: string }) {
  const events = useQuery({
    queryKey: ["events", raceId],
    queryFn: () => api.listEvents(raceId),
    refetchInterval: 10_000,
  });
  if (events.isPending) return <p className="text-sm text-slate-400">Loading…</p>;
  if (events.isError) return <p className="text-sm text-red-400">{events.error.message}</p>;
  if (events.data.length === 0) return <p className="text-sm text-slate-400">Nothing yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {events.data.map((e) => (
        <li key={e.id} className="text-sm">
          <div className={e.type === "PICK_MADE" ? "text-slate-300" : "text-amber-200"}>{describeEvent(e)}</div>
          <div className="text-xs text-slate-500">{formatRaceDate(e.createdAt)}</div>
        </li>
      ))}
    </ol>
  );
}

/** Every commissioner action is visible to the league (SPEC Section 1). Loads only when opened. */
export function AuditLog({ raceId }: { raceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="card" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer content-center font-semibold">Draft log</summary>
      <div className="mt-3">{open && <EventList raceId={raceId} />}</div>
    </details>
  );
}
