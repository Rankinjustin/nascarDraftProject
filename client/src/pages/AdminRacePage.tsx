import { checkTransition, OVERRIDE_REASONS, TRANSITIONS, type OverrideReason, type RaceDetail } from "@dnd/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { ConfirmRow } from "../components/ConfirmRow";
import { EntriesPanel } from "../components/EntriesPanel";
import { QualifyingPanel } from "../components/QualifyingPanel";
import { QueryState, ErrorText } from "../components/QueryState";
import { RaceCard } from "../components/RaceCard";
import { RaceFields, raceFormValues } from "../components/RaceFields";
import { ResultsPanel } from "../components/ResultsPanel";
import { keys, useInvalidateRace } from "../queries";

export function AdminRacePage() {
  const { raceId = "" } = useParams();
  const race = useQuery({ queryKey: keys.race(raceId), queryFn: () => api.getRace(raceId) });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link to="/admin" className="flex min-h-11 items-center gap-2 text-slate-400 hover:text-slate-50">
        <ArrowLeft size={18} />
        All races
      </Link>
      {race.data ? (
        <>
          <RaceCard race={race.data} heading="h1">
            <Link to={`/draft/${race.data.id}`} className="mt-1 text-sky-400 hover:underline">
              {race.data.status === "UPCOMING" ? "Spin the wheel in the draft room" : "Open the draft room"}
            </Link>
          </RaceCard>
          <StatusPanel race={race.data} />
          <ResultsPanel race={race.data} />
          <DetailsForm race={race.data} />
          <EntriesPanel race={race.data} />
          <QualifyingPanel race={race.data} />
        </>
      ) : (
        <QueryState query={race} />
      )}
    </div>
  );
}

const OVERRIDE_LABELS: Record<OverrideReason, { label: string; help: string }> = {
  deadline_passed: { label: "Close the draft now", help: "Locks the draft early. Empty slots score as DNS." },
  draft_reopened: { label: "Reopen the draft", help: "Back to drafting. Only before the start time, and never after the race went live." },
  green_flag: { label: "Mark the race live", help: "Use when the feed didn't promote it (or there's no feed)." },
  false_start: { label: "Undo going live", help: "Back to locked, for when a feed glitch promoted it early." },
};

function StatusPanel({ race }: { race: RaceDetail }) {
  const invalidate = useInvalidateRace(race.id);
  const [pending, setPending] = useState<OverrideReason | null>(null);
  const [note, setNote] = useState("");
  const override = useMutation({
    mutationFn: (reason: OverrideReason) => api.overrideStatus(race.id, reason, note || undefined),
    onSuccess: () => {
      setPending(null);
      setNote("");
      invalidate();
    },
  });

  // The server decides; this only hides buttons that can't apply to the current status.
  const ctx = {
    now: new Date(),
    raceDate: new Date(race.raceDate),
    picksMade: race.picksMade,
    totalSlots: race.totalSlots,
    hasBeenLive: race.wentLiveAt !== null,
  };
  // Only reasons that start from this status; time-based refusals stay visible with their explanation.
  const options = OVERRIDE_REASONS.filter((reason) => TRANSITIONS[reason].from.includes(race.status)).map((reason) => ({
    reason,
    refusal: checkTransition(race.status, reason, ctx),
  }));

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Status override</h2>
        {race.totalSlots > 0 && (
          <span className="text-sm text-slate-400">
            {race.picksMade} of {race.totalSlots} picks
          </span>
        )}
      </div>
      {options.length === 0 && (
        <p className="text-sm text-slate-400">
          {race.status === "UPCOMING"
            ? "The draft opens when the wheel is spun in the draft room."
            : "No overrides apply right now."}
        </p>
      )}
      {options.map(({ reason, refusal }) =>
        pending === reason ? (
          <div key={reason} className="flex flex-col gap-2 rounded-lg border border-amber-700 p-3">
            <div className="font-semibold">{OVERRIDE_LABELS[reason].label}?</div>
            <p className="text-sm text-slate-400">{OVERRIDE_LABELS[reason].help} This is logged for the league.</p>
            <input
              className="input"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <ConfirmRow
              label="Confirm"
              pending={override.isPending}
              onConfirm={() => override.mutate(reason)}
              onCancel={() => setPending(null)}
            />
          </div>
        ) : (
          <div key={reason}>
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={refusal !== null || override.isPending}
              onClick={() => {
                override.reset();
                setPending(reason);
              }}
            >
              {OVERRIDE_LABELS[reason].label}
            </button>
            {refusal && <p className="mt-1 text-xs text-slate-500">{refusal}</p>}
          </div>
        ),
      )}
      <ErrorText error={override.error} />
    </section>
  );
}

function DetailsForm({ race }: { race: RaceDetail }) {
  const invalidate = useInvalidateRace(race.id);
  const save = useMutation({
    mutationFn: (form: HTMLFormElement) => api.updateRace(race.id, raceFormValues(form)),
    onSuccess: invalidate,
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save.mutate(e.currentTarget);
  };

  // Only the inputs are keyed, so they reset to the saved values whenever any of them changes on the server (this
  // save or another commissioner's), while "Saved." survives the remount.
  const saved = [race.raceName, race.trackName, race.raceDate, race.qualifyingAt, race.trackMapUrl, race.imageUrl, race.nascarRaceId, race.scoringRuleKey];
  return (
    <form onSubmit={submit} className="card flex flex-col gap-3">
      <h2 className="font-semibold">Race details</h2>
      <RaceFields key={JSON.stringify(saved)} race={race} />
      <ErrorText error={save.error} />
      {save.isSuccess && <p className="text-sm text-green-400">Saved.</p>}
      <button type="submit" className="btn-primary" disabled={save.isPending}>
        Save details
      </button>
    </form>
  );
}
