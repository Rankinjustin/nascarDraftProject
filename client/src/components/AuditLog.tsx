import type { DraftEventView, TransitionReason } from "@dnd/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { formatRaceDate } from "../dates";
import { keys } from "../queries";
import { QueryState } from "./QueryState";

const REASONS: Record<TransitionReason, string> = {
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

/** One line per event, e.g. "Commish picked #9 Chase Elliott for Kyle (pick 7)". */
function describeEvent(e: DraftEventView): string {
  const who = e.actorName ?? "System";
  switch (e.type) {
    case "ORDER_GENERATED":
      return `${who} spun the wheel: ${e.payload.order.map((o) => `${o.pickPosition}. ${o.displayName}`).join(", ")}`;
    case "ORDER_REGENERATED":
      return `${who} threw out the draft order (${e.payload.picksDeleted} picks deleted) for a new spin`;
    case "PICK_MADE":
      return `${e.payload.displayName} took #${e.payload.carNumber} ${e.payload.driverName} (pick ${e.payload.overallPickNumber})`;
    case "PICK_MADE_ON_BEHALF":
      return `${who} picked #${e.payload.carNumber} ${e.payload.driverName} for ${e.payload.displayName} (pick ${e.payload.overallPickNumber})`;
    case "PICK_REVERTED":
      return `${who} reverted pick ${e.payload.overallPickNumber} (${e.payload.driverName} from ${e.payload.displayName})`;
    case "PICK_SWAPPED":
      return `${who} swapped pick ${e.payload.overallPickNumber} for ${e.payload.displayName}: ${e.payload.from.driverName} → ${e.payload.to.driverName}`;
    case "DRAFT_RESET":
      return `${who} reset the draft (${e.payload.picksDeleted} picks deleted)`;
    case "STATUS_CHANGED": {
      const p = e.payload;
      return `${who}: ${REASONS[p.reason] ?? p.reason} (${p.from} → ${p.to})${p.note ? ` — “${p.note}”` : ""}`;
    }
    case "RESULTS_CORRECTED":
      return `${who} corrected results`;
    default:
      // An event type newer than this build: still say something readable.
      return `${who}: ${String((e as { type: unknown }).type).toLowerCase().replace(/_/g, " ")}`;
  }
}

function EventList({ raceId }: { raceId: string }) {
  const events = useQuery({
    queryKey: keys.events(raceId),
    queryFn: () => api.listEvents(raceId),
    refetchInterval: 10_000,
  });
  if (!events.data) return <QueryState query={events} />;
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
