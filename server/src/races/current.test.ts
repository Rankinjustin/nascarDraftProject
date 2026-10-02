import type { RaceStatus } from "@dnd/shared";
import { describe, expect, it } from "vitest";
import { pickCurrentRace } from "./current";

const now = new Date("2026-10-02T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const race = (id: string, status: RaceStatus, daysFromNow: number) => ({
  id,
  status,
  raceDate: new Date(now.getTime() + daysFromNow * day),
});

describe("pickCurrentRace", () => {
  it("prefers the earliest DRAFTING/LOCKED/LIVE race", () => {
    const races = [race("next", "UPCOMING", 9), race("b", "DRAFTING", 2), race("a", "LOCKED", 1)];
    expect(pickCurrentRace(races, now)?.id).toBe("a");
  });

  it("skips a stale LIVE race when another active race exists", () => {
    const races = [race("forgotten", "LIVE", -5), race("this-week", "DRAFTING", 2)];
    expect(pickCurrentRace(races, now)?.id).toBe("this-week");
  });

  it("keeps a stale LIVE race when it's the only active one", () => {
    const races = [race("forgotten", "LIVE", -5), race("next", "UPCOMING", 2)];
    expect(pickCurrentRace(races, now)?.id).toBe("forgotten");
  });

  it("a LIVE race within 24 hours of its start is not stale", () => {
    const races = [race("today", "LIVE", -0.5), race("next", "DRAFTING", 6)];
    expect(pickCurrentRace(races, now)?.id).toBe("today");
  });

  it("falls back to the next UPCOMING race, ignoring past undrafted ones", () => {
    const races = [race("feb", "UPCOMING", -200), race("sun", "UPCOMING", 2), race("later", "UPCOMING", 9)];
    expect(pickCurrentRace(races, now)?.id).toBe("sun");
  });

  it("falls back to the most recent COMPLETED race", () => {
    const races = [race("old", "COMPLETED", -14), race("last", "COMPLETED", -7)];
    expect(pickCurrentRace(races, now)?.id).toBe("last");
  });

  it("never returns a CORRECTING race", () => {
    expect(pickCurrentRace([race("fixing", "CORRECTING", -3)], now)).toBeNull();
  });

  it("returns null with no races", () => {
    expect(pickCurrentRace([], now)).toBeNull();
  });
});
