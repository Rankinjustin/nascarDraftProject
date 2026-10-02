import type { SeasonStats } from "@dnd/shared";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { useMe } from "../auth";
import { ordinal } from "../format";

/** Season stats, purely for fun (SPEC Phase 7). Everything here comes from the frozen weekly results. */
export function SeasonPage() {
  const { seasonId } = useParams();
  const seasons = useQuery({ queryKey: ["seasons"], queryFn: api.listSeasons });
  const navigate = useNavigate();

  if (!seasonId) {
    if (seasons.isPending) return <p className="text-slate-400">Loading…</p>;
    if (seasons.isError) return <p className="text-red-400">{seasons.error.message}</p>;
    const current = seasons.data.find((s) => s.isCurrent) ?? seasons.data[0];
    return current ? <Navigate to={`/season/${current.id}`} replace /> : <p className="text-slate-400">No seasons yet.</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Season stats</h1>
        {(seasons.data?.length ?? 0) > 1 && (
          <select className="input w-auto" value={seasonId} onChange={(e) => navigate(`/season/${e.target.value}`)}>
            {seasons.data!.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <Stats key={seasonId} seasonId={seasonId} />
    </div>
  );
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const num = (x: number | null) => (x === null ? "—" : x.toFixed(2));

function Stats({ seasonId }: { seasonId: string }) {
  const { data: me } = useMe();
  const stats = useQuery({ queryKey: ["season-stats", seasonId], queryFn: () => api.seasonStats(seasonId) });
  if (stats.isPending) return <p className="text-slate-400">Loading…</p>;
  if (stats.isError) return <p className="text-red-400">{stats.error.message}</p>;
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
                  <td className="px-2 py-2 text-right tabular-nums">{num(u.avgScore)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{pct(u.top10Rate)}</td>
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
                  Best: {u.bestWeek.raceName} · {u.bestWeek.score.toFixed(2)} ({ordinal(u.bestWeek.rank)})
                </span>
              )}
              {u.worstWeek && u.weeksPlayed > 1 && (
                <span className="text-red-300">
                  Worst: {u.worstWeek.raceName} · {u.worstWeek.score.toFixed(2)} ({ordinal(u.worstWeek.rank)})
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
              <span className="text-slate-400">avg finish {d.avgFinish === null ? "—" : d.avgFinish.toFixed(1)}</span>
              <span className="w-16 text-right font-semibold tabular-nums">{d.timesDrafted}×</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

