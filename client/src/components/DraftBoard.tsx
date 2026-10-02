import { ROUNDS, type DraftState } from "@dnd/shared";

/** The slot a user fills in a round: forward in odd rounds, reversed in even ones (snake). */
function slotFor(round: number, seat: number, drafters: number): number {
  return (round - 1) * drafters + (round % 2 === 1 ? seat + 1 : drafters - seat);
}

/** Rounds × users grid. Scrolls sideways on mobile with the round labels pinned (SPEC Section 11). */
export function DraftBoard({ state, meId }: { state: DraftState; meId: string }) {
  const drafters = state.order.length;
  const bySlot = new Map(state.picks.map((p) => [p.overallPickNumber, p]));
  const rounds = Array.from({ length: ROUNDS }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-slate-900 px-2 py-2 text-left text-xs text-slate-500">Rd</th>
            {state.order.map((o) => (
              <th
                key={o.userId}
                className={`min-w-[8.5rem] border-l border-slate-800 bg-slate-900 px-2 py-2 text-left font-semibold ${
                  o.userId === meId ? "text-sky-300" : "text-slate-200"
                }`}
              >
                <span className="mr-1 text-slate-500">{o.pickPosition}.</span>
                {o.displayName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round}>
              <th className="sticky left-0 z-10 border-t border-slate-800 bg-slate-900 px-2 text-xs text-slate-500">{round}</th>
              {state.order.map((o, seat) => {
                const slot = slotFor(round, seat, drafters);
                const pick = bySlot.get(slot);
                const onClock = slot === state.nextOverallPickNumber;
                return (
                  <td
                    key={o.userId}
                    className={`h-14 border-l border-t border-slate-800 px-2 align-top ${onClock ? "bg-sky-950" : ""}`}
                  >
                    <div className="text-[10px] text-slate-500">#{slot}</div>
                    {pick ? (
                      <div className="leading-tight">
                        <span className="font-mono text-slate-400">#{pick.carNumber}</span> {pick.driverName}
                        {pick.isWithdrawn && <div className="text-xs text-amber-300">⚠ withdrawn</div>}
                        {pick.createdByUserId !== pick.userId && (
                          <div className="text-[10px] text-slate-500">by {pick.createdByName}</div>
                        )}
                      </div>
                    ) : onClock ? (
                      <div className="font-semibold text-sky-300">On the clock</div>
                    ) : (
                      <div className="text-slate-600">—</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
