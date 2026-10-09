import type { RaceSummary } from "@dnd/shared";
import type { ReactNode, SyntheticEvent } from "react";
import { formatRaceDate, timeUntil } from "../dates";
import { trackArt } from "../tracks";
import { StatusBadge } from "./StatusBadge";

/** A dead image link shouldn't leave a broken-image icon on the card. */
const hide = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.hidden = true;
};

/** The image is only a stencil: its opaque parts show the logo colors, so any line drawing matches the theme. */
export function TrackOutline({ url, trackName }: { url: string; trackName: string }) {
  return (
    <div
      role="img"
      aria-label={`${trackName} layout`}
      className="h-16 w-28 shrink-0 bg-linear-to-r from-yellow-400 via-red-500 to-sky-500 sm:h-20 sm:w-36"
      style={{ mask: `url(${JSON.stringify(url)}) center / contain no-repeat` }}
    />
  );
}

/** A faded picture behind a card's content; the card needs `relative overflow-hidden`. */
export function CardPhoto({ url }: { url: string }) {
  return (
    <>
      <img key={url} src={url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" onError={hide} />
      {/* Fades the picture out behind the text so it stays readable. */}
      <div className="absolute inset-0 bg-linear-to-r from-slate-900 via-slate-900/80 to-slate-900/30" aria-hidden />
    </>
  );
}

/**
 * The race header used on every page that shows a race: logo-colored stripe down the left edge, name and status,
 * track, start time with a countdown until the green flag, and qualifying when it's known. Pages add their own lines as
 * children. Compact drops the outline and qualifying line, for list rows.
 */
export function RaceCard({
  race,
  heading: Heading = "h2",
  badges,
  compact = false,
  children,
}: {
  race: RaceSummary;
  /** h1 where the race is the page's subject (Draft, Live); h2 inside a list or dashboard. */
  heading?: "h1" | "h2";
  /** Extra badges after the status, e.g. the live flag. */
  badges?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
}) {
  const { outline, photo } = trackArt(race);
  const upcoming = Date.parse(race.raceDate) > Date.now() && race.status !== "LIVE" && race.status !== "COMPLETED";
  return (
    <section className="card relative overflow-hidden pl-6">
      {photo && <CardPhoto url={photo} />}
      <div className="racing-stripe-y absolute inset-y-0 left-0 w-1.5" aria-hidden />
      <div className="relative flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Heading className={Heading === "h1" ? "text-2xl" : "text-lg"}>{race.raceName}</Heading>
              <StatusBadge status={race.status} raceDate={race.raceDate} />
              {badges}
            </div>
            <div className="text-sm text-slate-400">{race.trackName}</div>
            <div className="text-sm text-slate-400">
              {formatRaceDate(race.raceDate)}
              {upcoming && <span className="text-sky-400"> · {timeUntil(race.raceDate)}</span>}
            </div>
            {race.qualifyingAt && !compact && <div className="text-sm text-slate-400">Qualifying {formatRaceDate(race.qualifyingAt)}</div>}
          </div>
          {outline && !compact && <TrackOutline url={outline} trackName={race.trackName} />}
        </div>
        {children}
      </div>
    </section>
  );
}
