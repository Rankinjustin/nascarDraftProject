import type { FantasyStanding, LiveDriverRow, LiveView, QualifyingView } from "@dnd/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { useMe } from "../auth";
import { Trophy } from "lucide-react";
import { Confetti, useWinnerConfetti } from "../components/Confetti";
import { CurrentRaceRedirect } from "../components/CurrentRaceRedirect";
import { StatusBadge } from "../components/StatusBadge";
import { formatRaceDate, formatTime } from "../dates";

export function LivePage() {
  const { raceId } = useParams();
  return raceId ? <LiveRace key={raceId} raceId={raceId} /> : <CurrentRaceRedirect basePath="/live" />;
}

// Provisional until a race day confirms the feed's flag values (see server/src/integrations/nascarFeed.ts).
const FLAGS: Record<number, { label: string; className: string }> = {
  1: { label: "Green", className: "bg-green-600 text-white" },
  2: { label: "Caution", className: "bg-yellow-400 text-slate-950" },
  3: { label: "Red flag", className: "bg-red-600 text-white" },
  4: { label: "Checkered", className: "bg-white text-slate-950" },
  9: { label: "Checkered", className: "bg-white text-slate-950" },
};

const fmt = (n: number | null, digits = 1) => (n === null ? "—" : n.toFixed(digits));

/** Green +12 for positions gained, red −3 for positions lost (SPEC Section 11). */
function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-600">—</span>;
  if (value === 0) return <span className="text-slate-500">0</span>;
  return value > 0 ? (
    <span className="font-semibold text-green-400">+{value}</span>
  ) : (
    <span className="font-semibold text-red-400">−{Math.abs(value)}</span>
  );
}

function LiveRace({ raceId }: { raceId: string }) {
  const { data: me } = useMe();
  const live = useQuery({
    queryKey: ["live", raceId],
    queryFn: () => api.getLive(raceId),
    // 15s on race day; otherwise the page only changes when qualifying lands or picks are made.
    refetchInterval: (query) => (query.state.data?.race.status === "LIVE" ? 15_000 : 60_000),
  });
  const iWon =
    live.data?.race.status === "COMPLETED" && live.data.fantasyStandings.some((s) => s.rank === 1 && s.userId === me?.id);
  const confetti = useWinnerConfetti(raceId, Boolean(iWon));

  if (live.isPending) return <p className="text-slate-400">Loading…</p>;
  if (live.isError && !live.data) return <p className="text-red-400">{live.error.message}</p>;
  const view = live.data!;
  const { race } = view;
  const raced = race.status === "LIVE" || race.status === "COMPLETED" || race.status === "CORRECTING";
  const hasGrid = view.qualifying.length > 0;
  const flag = race.flagState !== null ? FLAGS[race.flagState] : undefined;
  // "Winner" always means rank 1, so a tie celebrates every co-winner (SPEC Section 4).
  const winners = race.status === "COMPLETED" ? view.fantasyStandings.filter((s) => s.rank === 1) : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{race.raceName}</h1>
          <StatusBadge status={race.status} raceDate={race.raceDate} />
          {raced && flag && <span className={`rounded px-2 py-0.5 text-xs font-bold ${flag.className}`}>{flag.label}</span>}
        </div>
        <div className="text-sm text-slate-400">
          {race.trackName} · {formatRaceDate(race.raceDate)}
          {raced && race.currentLap !== null && ` · Lap ${race.currentLap}${race.totalLaps ? ` of ${race.totalLaps}` : ""}`}
        </div>
        <StaleNote view={view} offline={live.isError} updatedAt={live.dataUpdatedAt} />
      </div>

      {confetti && <Confetti />}
      {winners.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-600 bg-yellow-950 p-4 text-yellow-100">
          <Trophy className="shrink-0 text-yellow-400" />
          <div>
            <div className="text-lg font-bold">
              {winners.map((w) => w.displayName).join(" & ")} {winners.length > 1 ? "tied for the win" : "won the week"}
            </div>
            <div className="text-sm opacity-80">Average finish {fmt(winners[0]!.score, 2)}</div>
          </div>
        </div>
      )}

      {race.status === "UPCOMING" ? (
        <p className="card text-slate-300">
          The draft hasn't opened yet.{" "}
          <Link to={`/draft/${race.id}`} className="text-sky-400 hover:underline">
            Go to the draft room
          </Link>
        </p>
      ) : (
        // Standings first in the DOM: on mobile they stack on top; on desktop they sit side by side.
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <Standings view={view} meId={me?.id} raced={raced} hasGrid={hasGrid} />
          {raced ? (
            <RunningOrder rows={view.runningOrder} hasGrid={hasGrid} meId={me?.id} />
          ) : (
            <StartingGrid grid={view.qualifying} view={view} meId={me?.id} />
          )}
        </div>
      )}
    </div>
  );
}

/** A stale indicator instead of a spinner, so the leaderboard never blanks out mid-race. */
function StaleNote({ view, offline, updatedAt }: { view: LiveView; offline: boolean; updatedAt: number }) {
  if (offline) return <p className="text-sm text-amber-300">Offline — showing what we had at {formatTime(updatedAt)}.</p>;
  if (view.race.status !== "LIVE") return null;
  if (view.stale) {
    return (
      <p className="text-sm text-amber-300">
        Feed unavailable — showing last update{view.race.feedUpdatedAt ? ` at ${formatTime(view.race.feedUpdatedAt)}` : ""}.
      </p>
    );
  }
  if (!view.race.feedUpdatedAt) return <p className="text-sm text-slate-500">Waiting for the first update from the feed.</p>;
  return <p className="text-sm text-slate-500">Updated {formatTime(view.race.feedUpdatedAt)}</p>;
}

function Standings({ view, meId, raced, hasGrid }: { view: LiveView; meId?: string; raced: boolean; hasGrid: boolean }) {
  const title = raced ? (view.race.status === "LIVE" ? "Fantasy standings" : "Final standings") : "Rosters";
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {raced && <span className="text-xs text-slate-500">Avg finish · empty slot or DNS = {view.fieldSize + 1}</span>}
      </div>
      {view.fantasyStandings.length === 0 && <p className="text-slate-400">No draft order yet.</p>}
      {view.fantasyStandings.map((s) => (
        <StandingCard
          key={s.userId}
          standing={s}
          mine={s.userId === meId}
          raced={raced}
          hasGrid={hasGrid}
          final={view.race.status === "COMPLETED"}
        />
      ))}
    </section>
  );
}

function StandingCard({
  standing: s,
  mine,
  raced,
  hasGrid,
  final,
}: {
  standing: FantasyStanding;
  mine: boolean;
  raced: boolean;
  hasGrid: boolean;
  final: boolean;
}) {
  return (
    <div className={`card ${mine ? "border-sky-700" : ""}`}>
      <div className="flex items-center gap-3">
        {raced && (
          <span className="w-8 text-2xl font-extrabold text-slate-300">
            {s.rank === 1 && final ? <Trophy className="text-yellow-400" /> : (s.rank ?? "—")}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{s.displayName}</div>
          <div className="text-xs text-slate-400">
            {raced
              ? `Avg start ${fmt(s.avgStart)} → now ${fmt(s.avgCurrent)}`
              : hasGrid
                ? `Avg start ${fmt(s.avgStart)}`
                : "Grid TBD"}
          </div>
        </div>
        {raced && <span className="text-xl font-bold tabular-nums">{fmt(s.score, 2)}</span>}
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {s.drivers.map((d, i) => (
          <li key={d.driverId ?? `empty-${i}`} className="flex items-center gap-2">
            {d.driverId ? (
              <>
                <span className="w-9 text-right font-mono text-slate-400">#{d.carNumber}</span>
                <span className="min-w-0 flex-1 truncate">
                  {d.driverName}
                  {d.isWithdrawn && <span className="ml-1 text-xs text-amber-300">⚠ withdrawn</span>}
                </span>
                <span className="text-xs text-slate-500">{d.startPosition !== null ? `P${d.startPosition}` : hasGrid ? "no start" : "grid TBD"}</span>
                {raced && (
                  <span className="w-14 text-right">
                    <span className="font-semibold tabular-nums">{d.position ?? "—"}</span>{" "}
                    <Change value={d.startPosition !== null && d.position !== null ? d.startPosition - d.position : null} />
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500">No pick (scores as DNS)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunningOrder({ rows, hasGrid, meId }: { rows: LiveDriverRow[]; hasGrid: boolean; meId?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Running order</h2>
      {rows.length === 0 ? (
        <p className="card text-slate-400">No positions from the feed yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2 text-right">Pos</th>
                <th className="px-2 py-2">Driver</th>
                {/* Start and change columns only once a grid exists (SPEC Section 11). */}
                {hasGrid && <th className="px-2 py-2 text-right">Start</th>}
                {hasGrid && <th className="px-2 py-2 text-right">+/−</th>}
                <th className="px-2 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.driverId} className={`border-t border-slate-800 ${r.ownerUserId === meId ? "bg-sky-950" : ""}`}>
                  <td className="px-2 py-2 text-right font-bold tabular-nums">{r.position ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span className="font-mono text-slate-400">#{r.carNumber}</span> {r.driverName}
                    {r.status === "OUT" && <span className="ml-1 text-xs text-red-400">out</span>}
                  </td>
                  {hasGrid && <td className="px-2 py-2 text-right tabular-nums text-slate-400">{r.startPosition ?? "—"}</td>}
                  {hasGrid && (
                    <td className="px-2 py-2 text-right">
                      <Change value={r.change} />
                    </td>
                  )}
                  <td className="px-2 py-2 text-slate-300">{r.ownerName ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Before the green: the starting lineup once qualifying is captured, with each pick's owner. */
function StartingGrid({ grid, view, meId }: { grid: QualifyingView[]; view: LiveView; meId?: string }) {
  const owner = new Map(view.fantasyStandings.flatMap((s) => s.drivers.filter((d) => d.driverId).map((d) => [d.driverId!, s])));
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Starting lineup</h2>
      {grid.length === 0 ? (
        <p className="card text-slate-400">Qualifying hasn't been captured yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-slate-800 rounded-xl border border-slate-800 text-sm">
          {grid.map((q) => {
            const who = owner.get(q.driverId);
            return (
              <li key={q.driverId} className={`flex items-center gap-2 px-3 py-2 ${who?.userId === meId ? "bg-sky-950" : ""}`}>
                <span className="w-6 text-right font-bold tabular-nums">{q.startPosition}</span>
                <span className="w-9 text-right font-mono text-slate-400">#{q.carNumber}</span>
                <span className="min-w-0 flex-1 truncate">
                  {q.driverName}
                  {q.isPole && <span className="ml-1 text-xs text-sky-300">pole</span>}
                </span>
                {q.qualifyingSpeed !== null && <span className="text-xs text-slate-500">{q.qualifyingSpeed.toFixed(3)} mph</span>}
                <span className="w-20 truncate text-right text-slate-300">{who?.displayName ?? ""}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
