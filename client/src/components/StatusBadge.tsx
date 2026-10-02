import type { RaceStatus } from "@dnd/shared";

const STYLES: Record<RaceStatus, { label: string; className: string }> = {
  UPCOMING: { label: "Upcoming", className: "bg-slate-800 text-slate-300" },
  DRAFTING: { label: "Drafting", className: "bg-sky-900 text-sky-200" },
  LOCKED: { label: "Locked", className: "bg-amber-900 text-amber-200" },
  LIVE: { label: "Live", className: "bg-green-900 text-green-200" },
  COMPLETED: { label: "Completed", className: "bg-slate-700 text-slate-200" },
  CORRECTING: { label: "Correcting", className: "bg-purple-900 text-purple-200" },
};

const NOT_DRAFTED = { label: "Not drafted", className: "border border-slate-700 text-slate-500" };

/** An UPCOMING race whose start time has passed was never drafted (e.g. before the league started). */
export function StatusBadge({ status, raceDate }: { status: RaceStatus; raceDate: string }) {
  const { label, className } =
    status === "UPCOMING" && Date.parse(raceDate) <= Date.now() ? NOT_DRAFTED : STYLES[status];
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}
