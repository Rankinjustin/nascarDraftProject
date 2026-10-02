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

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallClock(at: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The instant a wall-clock time occurs in `timeZone`. Day overflow (day + 1 at month end) is allowed. */
export function zonedInstant(c: WallClock, timeZone: string): Date {
  const target = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute);
  let guess = target;
  // Correct by the zone's offset at the guess; twice covers a DST change between the two.
  for (let i = 0; i < 2; i++) {
    const seen = wallClock(new Date(guess), timeZone);
    guess += target - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  return new Date(guess);
}

/** `hour`:00 league time on the day after `at` (league time). */
export function nextMorning(at: Date, timeZone: string, hour = 9): Date {
  const today = wallClock(at, timeZone);
  return zonedInstant({ ...today, day: today.day + 1, hour, minute: 0 }, timeZone);
}
