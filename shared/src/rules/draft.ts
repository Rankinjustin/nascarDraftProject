/** Drivers per roster. Total slots for a race = drafters × ROUNDS. */
export const ROUNDS = 3;

/** Round 1 forward, round 2 reverse, round 3 forward. Returns one userId per slot. */
export function snakeOrder(orderedUserIds: string[], rounds: number): string[] {
  const slots: string[] = [];
  for (let round = 0; round < rounds; round++) {
    slots.push(...(round % 2 === 0 ? orderedUserIds : [...orderedUserIds].reverse()));
  }
  return slots;
}

/**
 * Returns the userId on the clock, or null if the draft is complete.
 * `picksMade` is the COUNT of picks so far (0-based index of the next slot),
 * not an overallPickNumber. The next slot's overallPickNumber is picksMade + 1.
 */
export function whoseTurn(snake: string[], picksMade: number): string | null {
  return snake[picksMade] ?? null;
}

/** Convert an overall pick number (1-BASED) to a round number (1-based). */
export function roundForPick(overallPickNumber: number, userCount: number): number {
  return Math.ceil(overallPickNumber / userCount);
}
