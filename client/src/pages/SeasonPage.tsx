import type { SeasonStats } from "@dnd/shared";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Navigate, useParams } from "react-router";
import { api } from "../api";
import { useMe } from "../auth";
import { QueryState } from "../components/QueryState";
import { SeasonSelect } from "../components/SeasonSelect";
import { fixed, ordinal, percent } from "../format";
import { keys, useSeasons } from "../queries";

/** Season stats, purely for fun (SPEC Phase 7). Everything here comes from the frozen weekly results. */
export function SeasonPage() {
  const { seasonId } = useParams();
  const seasons = useSeasons();

  if (!seasonId) {
    if (!seasons.data) return <QueryState query={seasons} />;
    const current = seasons.data.find((s) => s.isCurrent) ?? seasons.data[0];
    return current ? <Navigate to={`/season/${current.id}`} replace /> : <p className="text-slate-400">No seasons yet.</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Season stats</h1>
        <SeasonSelect basePath="/season" seasonId={seasonId} />
      </div>
      <Stats key={seasonId} seasonId={seasonId} />
    </div>
  );
}

function Stats({ seasonId }: { seasonId: string }) {
  const { data: me } = useMe();
  const stats = useQuery({ queryKey: [...keys.seasonStats, seasonId], queryFn: () => api.seasonStats(seasonId) });
  if (!stats.data) return <QueryState query={stats} />;
  const s: SeasonStats = stats.data;
  if (s.weeksCompleted === 0) return <p className="card text-slate-400">No completed weeks in {s.season.name} yet.</p>;

  return (
    <>
      <p className="text-sm text-slate-400">
        {s.season.name} · {s.weeksCompleted} week{s.weeksCompleted === 1 ? "" : "s"} completed. A tie is a win for each
        co-winner. Lower average is better.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Leaderboard</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-500">
              <tr>
                <th className="sticky left-0 bg-slate-900 px-3 py-2">Player</th>
                <th className="px-2 py-2 text-right">Wins</th>
                <th className="px-2 py-2 text-right">Avg</th>
                <th className="px-2 py-2 text-right">Top 10</th>
                <th className="px-2 py-2 text-right">Weeks</th>
              </tr>
            </thead>
            <tbody>
              {s.users.map((u) => (
                <tr key={u.userId} className={`border-t border-slate-800 ${u.userId === me?.id ? "bg-sky-950" : ""}`}>
                  <td className="sticky left-0 bg-inherit px-3 py-2 font-semibold">{u.displayName}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {u.wins > 0 && <Trophy size={14} className="mr-1 inline align-text-top text-yellow-400" />}
                    {u.wins}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fixed(u.avgScore, 2)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{percent(u.top10Rate)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-400">{u.weeksPlayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">Top 10 = share of a player's drafted drivers who finished in the top 10.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Best and worst weeks</h2>
        <ul className="flex flex-col gap-2">
          {s.users.map((u) => (
            <li key={u.userId} className="card flex flex-col gap-1 text-sm">
              <span className="font-semibold">{u.displayName}</span>
              {u.bestWeek && (
                <span className="text-green-300">
                  Best: {u.bestWeek.raceName} · {fixed(u.bestWeek.score, 2)} ({ordinal(u.bestWeek.rank)})
                </span>
              )}
              {u.worstWeek && u.weeksPlayed > 1 && (
                <span className="text-red-300">
                  Worst: {u.worstWeek.raceName} · {fixed(u.worstWeek.score, 2)} ({ordinal(u.worstWeek.rank)})
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Most drafted drivers</h2>
        <ol className="flex flex-col divide-y divide-slate-800 rounded-xl border border-slate-800 text-sm">
          {s.mostDrafted.map((d) => (
            <li key={d.driverId} className="flex items-center gap-3 px-3 py-2">
              <span className="w-10 text-right font-mono text-slate-400">{d.carNumber ? `#${d.carNumber}` : ""}</span>
              <span className="min-w-0 flex-1 truncate">{d.driverName}</span>
              <span className="text-slate-400">avg finish {fixed(d.avgFinish, 1)}</span>
              <span className="w-16 text-right font-semibold tabular-nums">{d.timesDrafted}×</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

