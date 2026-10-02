import type { AvailableDriver } from "@dnd/shared";
import { Search } from "lucide-react";
import { useState } from "react";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * Single scrollable column with search (SPEC Section 11). The server sorts it: starting position once
 * qualifying is in, else last race's finish, else car number.
 */
export function DriverPicker({
  drivers,
  canPick,
  pickingFor,
  pending,
  onPick,
}: {
  drivers: AvailableDriver[];
  canPick: boolean;
  /** Set when the commissioner is picking on someone's behalf. */
  pickingFor: string | null;
  pending: boolean;
  onPick: (driverId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const shown = q ? drivers.filter((d) => d.driverName.toLowerCase().includes(q) || d.carNumber.startsWith(q)) : drivers;
  const selected = canPick ? drivers.find((d) => d.driverId === selectedId) : undefined;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Available drivers</h2>
        <span className="text-sm text-slate-400">{drivers.length} left</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
        <input
          className="input pl-10"
          placeholder="Search name or car number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className="flex flex-col divide-y divide-slate-800 rounded-xl border border-slate-800">
        {shown.map((d) => (
          <li key={d.driverId}>
            <button
              type="button"
              disabled={!canPick || pending}
              onClick={() => setSelectedId(d.driverId)}
              className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left ${
                d.driverId === selected?.driverId ? "bg-sky-900" : canPick ? "hover:bg-slate-800" : ""
              }`}
            >
              <span className="w-10 shrink-0 text-right font-mono text-lg font-bold text-slate-300">#{d.carNumber}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{d.driverName}</span>
                {d.teamName && <span className="block truncate text-xs text-slate-500">{d.teamName}</span>}
              </span>
              <span className="shrink-0 text-right text-xs text-slate-400">
                {d.startPosition !== null && <span className="block">Starts P{d.startPosition}</span>}
                {d.lastFinish !== null && <span className="block">{ordinal(d.lastFinish)} last race</span>}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-4 text-slate-400">No available driver matches.</li>}
      </ul>

      {selected && (
        // Sits above the mobile tab bar.
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-sky-800 bg-slate-900 p-3 md:bottom-0 md:left-56">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-400">{pickingFor ? `Draft for ${pickingFor}` : "Draft"}</div>
              <div className="truncate font-semibold">
                #{selected.carNumber} {selected.driverName}
              </div>
            </div>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setSelectedId(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={() => {
                onPick(selected.driverId);
                setSelectedId(null);
              }}
            >
              {pending ? "Drafting…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
