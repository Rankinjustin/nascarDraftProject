import type { DraftOrderView } from "@dnd/shared";
import { useState, type CSSProperties } from "react";

// Logo blue, red, magenta first, then deeper racing colors; all dark enough for white names.
const COLORS = ["#027dc6", "#e62329", "#c01f82", "#0a466b", "#a35f09", "#6d28d9", "#047857", "#9c1968", "#c2410c", "#0e7490"];
const SIZE = 300;
const C = SIZE / 2;
const R = C - 6;

function point(angleDeg: number, radius: number) {
  const a = (angleDeg * Math.PI) / 180;
  return `${C + radius * Math.sin(a)} ${C - radius * Math.cos(a)}`;
}

function slicePath(from: number, to: number) {
  return `M ${C} ${C} L ${point(from, R)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to, R)} Z`;
}

/**
 * Theater over a settled result (SPEC Section 10): the order already exists on the server.
 * Each spin lands on the next pick position's name, reveals it, and removes it from the wheel.
 */
export function WheelSpinner({ order, onDone }: { order: DraftOrderView[]; onDone: () => void }) {
  const sorted = [...order].sort((a, b) => a.pickPosition - b.pickPosition);
  const [revealed, setRevealed] = useState(0);
  const [landed, setLanded] = useState(false);

  const target = sorted[revealed];
  // Slices are the names still on the wheel, laid out alphabetically so the layout doesn't hint at the order.
  const remaining = sorted.slice(revealed).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const slice = 360 / Math.max(remaining.length, 1);
  const index = target ? remaining.findIndex((o) => o.userId === target.userId) : 0;
  // Clockwise turns until the target slice's center sits under the pointer at the top.
  const rotation = (remaining.length > 1 ? 360 * 4 : 360) - (index + 0.5) * slice;
  const shown = sorted.slice(0, revealed + (landed ? 1 : 0));
  const finished = revealed >= sorted.length;

  const onLanded = () => {
    setLanded(true);
    setTimeout(() => {
      setLanded(false);
      setRevealed((r) => r + 1);
    }, 900);
  };

  return (
    <section className="card flex flex-col items-center gap-4" aria-live="polite">
      <div className="flex w-full items-center justify-between">
        <h2 className="text-lg font-semibold">The draft order</h2>
        <button type="button" className="btn-secondary min-h-9 px-3 text-sm" onClick={onDone}>
          {finished ? "See the board" : "Skip"}
        </button>
      </div>

      {!finished && target && (
        <div className="relative" style={{ width: SIZE, maxWidth: "100%" }}>
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1 border-x-[12px] border-t-[20px] border-x-transparent border-t-slate-50" />
          {/* Keyed so each spin remounts and replays the animation from zero. */}
          <div
            key={revealed}
            style={
              {
                "--wheel-to": `${rotation}deg`,
                animation: `wheel-spin ${remaining.length > 1 ? 2.6 : 0.9}s cubic-bezier(0.12, 0.8, 0.2, 1) forwards`,
              } as CSSProperties
            }
            onAnimationEnd={onLanded}
          >
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full">
              {remaining.length === 1 ? (
                <circle cx={C} cy={C} r={R} fill={COLORS[0]} />
              ) : (
                remaining.map((o, i) => (
                  <path key={o.userId} d={slicePath(i * slice, (i + 1) * slice)} fill={COLORS[i % COLORS.length]} className="stroke-slate-900" strokeWidth={2} />
                ))
              )}
              {remaining.map((o, i) => {
                const center = (i + 0.5) * slice;
                const ty = C - R * 0.6;
                return (
                  <text
                    key={o.userId}
                    x={C}
                    y={ty}
                    fill="white"
                    fontSize={remaining.length > 6 ? 14 : 17}
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${center} ${C} ${C}) rotate(-90 ${C} ${ty})`}
                  >
                    {o.displayName.length > 12 ? `${o.displayName.slice(0, 11)}…` : o.displayName}
                  </text>
                );
              })}
              <circle cx={C} cy={C} r={18} className="fill-slate-900 stroke-slate-50" strokeWidth={3} />
            </svg>
          </div>
        </div>
      )}

      <div className="min-h-8 text-center text-xl font-bold">
        {landed && target && (
          <span className="inline-block animate-pop-in">
            Pick {target.pickPosition}: {target.displayName}
          </span>
        )}
        {finished && "The order is set."}
      </div>

      <ol className="grid w-full grid-cols-1 gap-1 sm:grid-cols-2">
        {shown.map((o) => (
          <li key={o.userId} className="flex animate-slide-in items-center gap-3 rounded-lg bg-slate-800 px-3 py-2">
            <span className="w-6 text-right font-mono font-bold text-sky-300">{o.pickPosition}</span>
            {o.displayName}
          </li>
        ))}
      </ol>
    </section>
  );
}
