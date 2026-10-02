export interface ScoredDriver {
  driverId: string | null;        // null = empty roster slot (draft closed before it was filled)
  finishPosition: number | null;  // null = did not take green / no result / empty slot
}

export interface UserEntry {
  userId: string;
  drivers: ScoredDriver[];        // always exactly `rounds` entries; pad empty slots
}

export interface ScoringContext {
  /** Count of RaceResult rows, falling back to eligible RaceEntry rows (SPEC Section 4). */
  fieldSize: number;
}

export interface ScoringRule {
  key: string;
  label: string;
  description: string;
  /** "asc" = lower score is better. `rankEntries` must honor this. */
  direction: "asc" | "desc";
  score(entry: UserEntry, context: ScoringContext): number;
}

const averageFinish: ScoringRule = {
  key: "average_finish",
  label: "Average finish",
  description:
    "Average finishing position of your drivers. Lowest wins. A driver who didn't start, has no result, or an empty slot counts as one worse than last place.",
  direction: "asc",
  score(entry, { fieldSize }) {
    if (entry.drivers.length === 0) return fieldSize + 1;
    const total = entry.drivers.reduce((sum, d) => sum + (d.finishPosition ?? fieldSize + 1), 0);
    return total / entry.drivers.length;
  },
};

export const SCORING_RULES: Record<string, ScoringRule> = {
  [averageFinish.key]: averageFinish,
};

export const DEFAULT_SCORING_RULE_KEY = averageFinish.key;

/** Best score first. Exact ties share a rank (1, 1, 3); every rank-1 row is a weekly winner. */
export function rankEntries(
  entries: UserEntry[],
  rule: ScoringRule,
  context: ScoringContext,
): Array<{ userId: string; score: number; rank: number }> {
  const sign = rule.direction === "asc" ? 1 : -1;
  const scored = entries
    .map((entry) => ({ userId: entry.userId, score: rule.score(entry, context) }))
    .sort((a, b) => sign * (a.score - b.score));

  let rank = 0;
  return scored.map((row, i) => {
    if (i === 0 || row.score !== scored[i - 1]?.score) rank = i + 1;
    return { ...row, rank };
  });
}
