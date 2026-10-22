import { rosterFor } from "@dnd/shared";
import { BellRing } from "lucide-react";
import { Link } from "react-router";
import { useMe } from "../auth";
import { QueryState } from "../components/QueryState";
import { RaceCard } from "../components/RaceCard";
import { TurnBanner } from "../components/TurnBanner";
import { isIos, isStandalone, pushConfigured, pushSupported } from "../pwa";
import { useCurrentRace, useDraft } from "../queries";

/** Dashboard: current race, your roster, whose turn it is, deadline countdown (SPEC Section 11). Refreshes on focus. */
export function HomePage() {
  const { data: me } = useMe();
  const current = useCurrentRace();
  const draft = useDraft(current.data?.id, me?.id, false);
  const state = draft.data;
  const drafting = state && state.order.some((o) => o.userId === me?.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Hey, {me?.displayName}</h1>
      <NotificationNudge />

      <QueryState query={current} />
      {current.isSuccess && !current.data && <div className="card text-slate-300">No race on the schedule.</div>}
      {current.data && <RaceCard race={current.data} />}

      {state && me && (
        <>
          <TurnBanner state={state} meId={me.id} />
          {drafting && (
            <section className="card">
              <h2 className="mb-2 font-semibold">Your roster</h2>
              <ol className="flex flex-col gap-2">
                {rosterFor(me.id, state.picks).map((p, i) => (
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
