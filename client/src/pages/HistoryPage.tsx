import type { HistoryWeek } from "@dnd/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Trophy } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { useMe } from "../auth";
import { QueryState } from "../components/QueryState";
import { RaceCard } from "../components/RaceCard";
import { SeasonSelect } from "../components/SeasonSelect";
import { fixed, ordinal } from "../format";
import { keys } from "../queries";

/** Past weeks, newest first, from the frozen weekly results. Every rank-1 row is a winner, so ties show them all. */
export function HistoryPage() {
  const { data: me } = useMe();
  // No season in the URL: the server answers with the current one.
  const { seasonId } = useParams();
  const history = useQuery({ queryKey: [...keys.history, seasonId ?? ""], queryFn: () => api.history(seasonId) });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Past weeks</h1>
        <SeasonSelect basePath="/history" seasonId={seasonId} />
      </div>
      <QueryState query={history} />
      {history.data?.length === 0 && <p className="card text-slate-400">No completed weeks yet this season.</p>}
      {history.data?.map((week) => <WeekCard key={week.race.id} week={week} meId={me?.id} />)}
    </div>
  );
}

function WeekCard({ week, meId }: { week: HistoryWeek; meId?: string }) {
  const [open, setOpen] = useState(false);
  const winners = week.results.filter((r) => r.rank === 1);
  const mine = week.results.find((r) => r.userId === meId);

  return (
    <RaceCard race={week.race}>
      <button type="button" className="mt-1 flex min-h-11 items-start gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-yellow-200">
            <Trophy size={16} className="shrink-0 text-yellow-400" />
            {winners.length ? winners.map((w) => w.displayName).join(" & ") : "No drafters"}
            {winners[0] && <span className="text-slate-400">· {fixed(winners[0].score, 2)}</span>}
          </div>
          {mine && (
            <div className="text-sm text-slate-400">
              You: {ordinal(mine.rank)} · {fixed(mine.score, 2)}
            </div>
          )}
        </div>
        <ChevronDown className={`mt-1 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} size={20} />
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-800 pt-2">
          {week.results.map((r) => (
            <div key={r.userId} className={`rounded-lg p-2 ${r.userId === meId ? "bg-sky-950" : "bg-slate-800"}`}>
              <div className="flex items-center gap-2">
                <span className="w-6 font-bold">{r.rank}</span>
                <span className="flex-1 font-semibold">{r.displayName}</span>
                <span className="tabular-nums">{fixed(r.score, 2)}</span>
              </div>
              <ul className="ml-8 text-sm text-slate-300">
                {r.driverFinishes.map((d, i) => (
                  <li key={d.driverId ?? `empty-${i}`}>
                    {d.driverId ? (
                      <>
                        <span className="font-mono text-slate-400">#{d.carNumber}</span> {d.driverName} —{" "}
                        {d.finishPosition !== null ? ordinal(d.finishPosition) : `DNS (${r.fieldSize + 1})`}
                      </>
                    ) : (
                      <span className="text-slate-500">No pick — scored {r.fieldSize + 1}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Link to={`/live/${week.race.id}`} className="text-sm text-sky-400 hover:underline">
            Full race results
          </Link>
        </div>
      )}
    </RaceCard>
  );
}

