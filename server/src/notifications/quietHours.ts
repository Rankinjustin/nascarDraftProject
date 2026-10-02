/** "HH:MM" → minutes after midnight. */
function minutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * Whether `now` falls in the quiet window, read as wall-clock time in `timeZone`.
 * The window may wrap midnight (22:00–08:00). Equal start and end means no quiet hours.
 */
export function isQuietHours(now: Date, timeZone: string, start: string, end: string): boolean {
  const from = minutes(start);
  const to = minutes(end);
  if (from === to) return false;

  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now);
  const local = Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);

  return from < to ? local >= from && local < to : local >= from || local < to;
}
