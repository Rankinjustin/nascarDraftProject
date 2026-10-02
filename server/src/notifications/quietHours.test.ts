import { describe, expect, it } from "vitest";
import { isQuietHours } from "./quietHours";

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
