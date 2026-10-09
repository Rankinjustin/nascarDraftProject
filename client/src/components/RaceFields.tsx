import { SCORING_RULES, type RaceInput, type RaceSummary } from "@dnd/shared";
import { fromDatetimeLocal, toDatetimeLocal } from "../dates";

/**
 * The race form's inputs, uncontrolled: read them back with raceFormValues. A new race only asks for the basics; an
 * existing one shows every field. Key the component on the saved values to reset it after a save lands.
 */
export function RaceFields({ race }: { race?: RaceSummary }) {
  const isFinal = race?.status === "COMPLETED" || race?.status === "CORRECTING";
  return (
    <>
      <label>
        <span className="label">Race name</span>
        <input className="input" name="raceName" required defaultValue={race?.raceName} />
      </label>
      <label>
        <span className="label">Track</span>
        <input className="input" name="trackName" required defaultValue={race?.trackName} />
      </label>
      <label>
        <span className="label">Published start time (your time zone) — picks close then</span>
        <input
          className="input"
          type="datetime-local"
          name="raceDate"
          required
          defaultValue={race ? toDatetimeLocal(race.raceDate) : undefined}
        />
      </label>
      {race && (
        <>
          <label>
            <span className="label">Qualifying start (your time zone) — filled in by the entry-list import</span>
            <input
              className="input"
              type="datetime-local"
              name="qualifyingAt"
              defaultValue={race.qualifyingAt ? toDatetimeLocal(race.qualifyingAt) : ""}
            />
          </label>
          <label>
            <span className="label">
              Track outline — blank uses the built-in one for this track; or an https link to a track-only image with a
              transparent background
            </span>
            <input className="input" name="trackMapUrl" defaultValue={race.trackMapUrl ?? ""} />
          </label>
          <label>
            <span className="label">Background picture — blank uses the built-in one for this track; or an https link</span>
            <input className="input" name="imageUrl" defaultValue={race.imageUrl ?? ""} />
          </label>
        </>
      )}
      <label>
        <span className="label">{race ? "NASCAR race ID" : "NASCAR race ID (optional, needed before race weekend)"}</span>
        <input
          className="input"
          name="nascarRaceId"
          inputMode="numeric"
          pattern="\d*"
          defaultValue={race?.nascarRaceId?.toString() ?? ""}
        />
      </label>
      {race && (
        <label>
          <span className="label">Scoring</span>
          {/* A disabled select is left out of the form data, so a final week's rule is never sent. */}
          <select className="input" name="scoringRuleKey" disabled={isFinal} defaultValue={race.scoringRuleKey}>
            {Object.values(SCORING_RULES).map((rule) => (
              <option key={rule.key} value={rule.key}>
                {rule.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** The body for createRace / updateRace. Fields the form doesn't show are left out. */
export function raceFormValues(form: HTMLFormElement): RaceInput {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const optional = <T,>(name: string, convert: (value: string) => T) =>
    data.has(name) ? (text(name) ? convert(text(name)) : null) : undefined;
  return {
    raceName: text("raceName"),
    trackName: text("trackName"),
    raceDate: fromDatetimeLocal(text("raceDate")),
    qualifyingAt: optional("qualifyingAt", fromDatetimeLocal),
    trackMapUrl: optional("trackMapUrl", String),
    imageUrl: optional("imageUrl", String),
    nascarRaceId: optional("nascarRaceId", Number),
    scoringRuleKey: data.has("scoringRuleKey") ? text("scoringRuleKey") : undefined,
  };
}
