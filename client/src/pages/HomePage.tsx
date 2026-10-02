import { ROUNDS } from "@dnd/shared";
import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { Link } from "react-router";
import { api } from "../api";
import { useMe } from "../auth";
import { StatusBadge } from "../components/StatusBadge";
import { formatRaceDate } from "../dates";
import { isIos, isStandalone, pushConfigured, pushSupported } from "../pwa";
import { TurnBanner, useDraft } from "./DraftPage";

/** Dashboard: current race, your roster, whose turn it is, deadline countdown (SPEC Section 11). Refreshes on focus. */
export function HomePage() {
  const { data: me } = useMe();
  const current = useQuery({ queryKey: ["race", "current"], queryFn: api.currentRace });
  const draft = useDraft(current.data?.id, me?.id, false);
  const state = draft.data;
  const mine = state?.picks.filter((p) => p.userId === me?.id) ?? [];
  const drafting = state && state.order.some((o) => o.userId === me?.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Hey, {me?.displayName}</h1>
      <NotificationNudge />

      {current.isPending && <p className="text-slate-400">Loading…</p>}
      {current.isError && <p className="text-red-400">{current.error.message}</p>}
      {current.isSuccess && !current.data && <div className="card text-slate-300">No race on the schedule.</div>}

      {current.data && (
        <div className="card flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{current.data.raceName}</h2>
            <StatusBadge status={current.data.status} raceDate={current.data.raceDate} />
          </div>
          <div className="text-sm text-slate-400">
            {current.data.trackName} · {formatRaceDate(current.data.raceDate)}
          </div>
        </div>
      )}

      {state && me && (
        <>
          <TurnBanner state={state} meId={me.id} />
          {drafting && (
            <section className="card">
              <h2 className="mb-2 font-semibold">Your roster</h2>
              <ol className="flex flex-col gap-2">
                {Array.from({ length: ROUNDS }, (_, i) => mine[i]).map((p, i) => (
                  <li key={i} className="flex min-h-11 items-center gap-3 rounded-lg bg-slate-800 px-3">
                    <span className="text-xs text-slate-500">Rd {i + 1}</span>
                    {p ? (
                      <span>
                        <span className="font-mono text-slate-400">#{p.carNumber}</span> {p.driverName}
                        {p.isWithdrawn && <span className="ml-2 text-xs text-amber-300">⚠ withdrawn</span>}
                      </span>
                    ) : (
                      <span className="text-slate-500">Not picked yet</span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <Link to={`/draft/${state.race.id}`} className="btn-primary">
            Open the draft room
          </Link>
        </>
      )}
    </div>
  );
}

/** Push is the draft's main UX; nudge anyone whose device can't receive it yet. */
function NotificationNudge() {
  const needsInstall = isIos() && !isStandalone();
  const needsPermission = pushSupported() && pushConfigured && Notification.permission === "default";
  if (!needsInstall && !needsPermission) return null;
  return (
    <Link to="/settings" className="card flex items-center gap-3 border-sky-800 hover:bg-slate-800">
      <BellRing className="shrink-0 text-sky-300" />
      <span>
        <span className="block font-semibold">Get pinged when it's your turn</span>
        <span className="block text-sm text-slate-400">
          {needsInstall ? "Add the app to your Home Screen first — tap here for how." : "Turn on notifications for this device."}
        </span>
      </span>
    </Link>
  );
}
