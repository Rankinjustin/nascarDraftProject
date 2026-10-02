import { describe, expect, it } from "vitest";
import { isQuietHours, nextMorning } from "./quietHours";

const tz = "America/Chicago";
// October: Chicago is UTC-5.
const at = (localHHMM: string) => {
  const [h, m] = localHHMM.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 7, h! + 5, m!));
};

describe("isQuietHours", () => {
  it("wraps midnight", () => {
    expect(isQuietHours(at("21:59"), tz, "22:00", "08:00")).toBe(false);
    expect(isQuietHours(at("22:00"), tz, "22:00", "08:00")).toBe(true);
    expect(isQuietHours(at("01:00"), tz, "22:00", "08:00")).toBe(true);
    expect(isQuietHours(at("07:59"), tz, "22:00", "08:00")).toBe(true);
    expect(isQuietHours(at("08:00"), tz, "22:00", "08:00")).toBe(false);
  });

  it("handles a same-day window", () => {
    expect(isQuietHours(at("13:00"), tz, "12:00", "14:00")).toBe(true);
    expect(isQuietHours(at("14:00"), tz, "12:00", "14:00")).toBe(false);
  });

  it("equal start and end disables quiet hours", () => {
    expect(isQuietHours(at("03:00"), tz, "00:00", "00:00")).toBe(false);
  });
});

describe("nextMorning", () => {
  it("is 9:00 league time the following day", () => {
    // Sunday Oct 4 2026, 4:30 PM in Chicago (UTC-5) → Monday 9:00 AM Chicago = 14:00 UTC.
    expect(nextMorning(new Date("2026-10-04T21:30:00Z"), tz).toISOString()).toBe("2026-10-05T14:00:00.000Z");
  });

  it("rolls over the end of a month, and handles a late-evening race that is already 'tomorrow' in UTC", () => {
    // Oct 31 2026, 10:30 PM Chicago = Nov 1 03:30 UTC → Nov 1 9:00 AM Chicago (DST ends Nov 1, 2 AM → UTC-6) = 15:00 UTC.
    expect(nextMorning(new Date("2026-11-01T03:30:00Z"), tz).toISOString()).toBe("2026-11-01T15:00:00.000Z");
  });
});
