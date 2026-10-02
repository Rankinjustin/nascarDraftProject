import { describe, expect, it } from "vitest";
import {
  checkTransition,
  transitionTarget,
  type RaceStatus,
  type TransitionContext,
  type TransitionReason,
} from "./raceStatus";

const raceDate = new Date("2026-10-04T18:00:00Z");
const before = new Date("2026-10-01T12:00:00Z");
const after = new Date("2026-10-04T18:05:00Z");

const ctx = (overrides: Partial<TransitionContext> = {}): TransitionContext => ({
  now: before,
  raceDate,
  picksMade: 27,
  totalSlots: 27,
  hasBeenLive: false,
  ...overrides,
});

const statuses: RaceStatus[] = ["UPCOMING", "DRAFTING", "LOCKED", "LIVE", "COMPLETED", "CORRECTING"];

const allowed: Array<[RaceStatus, TransitionReason, RaceStatus]> = [
  ["UPCOMING", "order_generated", "DRAFTING"],
  ["DRAFTING", "order_regenerated", "UPCOMING"],
  ["LOCKED", "order_regenerated", "UPCOMING"],
  ["DRAFTING", "draft_filled", "LOCKED"],
  ["DRAFTING", "deadline_passed", "LOCKED"],
  ["LOCKED", "draft_reopened", "DRAFTING"],
  ["LOCKED", "green_flag", "LIVE"],
  ["LIVE", "false_start", "LOCKED"],
  ["LIVE", "completed", "COMPLETED"],
  ["CORRECTING", "completed", "COMPLETED"],
  ["COMPLETED", "reopened", "CORRECTING"],
];

describe("checkTransition", () => {
  it.each(allowed)("%s --%s--> %s is allowed", (from, reason, to) => {
    expect(checkTransition(from, reason, ctx())).toBeNull();
    expect(transitionTarget(reason)).toBe(to);
  });

  it("rejects every arrow not in the table", () => {
    const reasons = [...new Set(allowed.map(([, r]) => r))];
    for (const from of statuses) {
      for (const reason of reasons) {
        if (allowed.some(([f, r]) => f === from && r === reason)) continue;
        expect(checkTransition(from, reason, ctx()), `${from} ${reason}`).not.toBeNull();
      }
    }
  });

  it("draft_reopened after raceDate fails", () => {
    expect(checkTransition("LOCKED", "draft_reopened", ctx({ now: after }))).not.toBeNull();
  });

  it("draft_reopened exactly at raceDate fails", () => {
    expect(checkTransition("LOCKED", "draft_reopened", ctx({ now: raceDate }))).not.toBeNull();
  });

  it("draft_reopened with hasBeenLive fails even before raceDate", () => {
    expect(checkTransition("LOCKED", "draft_reopened", ctx({ hasBeenLive: true }))).not.toBeNull();
  });

  it("order_regenerated after raceDate fails", () => {
    expect(checkTransition("DRAFTING", "order_regenerated", ctx({ now: after }))).not.toBeNull();
    expect(checkTransition("LOCKED", "order_regenerated", ctx({ now: after }))).not.toBeNull();
  });

  it("deadline_passed before raceDate passes (commish closing early)", () => {
    expect(checkTransition("DRAFTING", "deadline_passed", ctx({ picksMade: 10 }))).toBeNull();
  });

  it("deadline_passed after raceDate passes", () => {
    expect(checkTransition("DRAFTING", "deadline_passed", ctx({ now: after, picksMade: 10 }))).toBeNull();
  });

  it("draft_filled with open slots fails", () => {
    expect(checkTransition("DRAFTING", "draft_filled", ctx({ picksMade: 26 }))).not.toBeNull();
  });

  it("completed from LOCKED fails", () => {
    expect(checkTransition("LOCKED", "completed", ctx())).not.toBeNull();
  });

  it("reopened from LIVE fails", () => {
    expect(checkTransition("LIVE", "reopened", ctx())).not.toBeNull();
  });

  it("rejects an unknown reason", () => {
    expect(checkTransition("UPCOMING", "bogus" as TransitionReason, ctx())).not.toBeNull();
  });
});
