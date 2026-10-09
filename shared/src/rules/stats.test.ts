import { afterEach, describe, expect, it } from "vitest";
import { SCORING_RULES } from "./scoring";
import { aggregateSeason, type WeekRow } from "./stats";

const week = (raceId: string, userId: string, score: number, rank: number, scoringRuleKey = "average_finish"): WeekRow => ({
  raceId,
  raceName: raceId,
  userId,
  displayName: userId,
  score,
  rank,
  scoringRuleKey,
  driverFinishes: [{ driverId: `${userId}-d`, driverName: "D", carNumber: "1", finishPosition: 5 }],
});

describe("aggregateSeason", () => {
  afterEach(() => {
    delete SCORING_RULES.test_points;
  });

  it("a tie for the week is a win for each co-winner", () => {
    const { users, weeksCompleted } = aggregateSeason([week("r1", "a", 4, 1), week("r1", "b", 4, 1), week("r1", "c", 9, 3)]);
    expect(weeksCompleted).toBe(1);
    expect(users.map((u) => [u.userId, u.wins])).toEqual([["a", 1], ["b", 1], ["c", 0]]);
  });

  it("ties on wins go to the better average: lower for an ascending rule", () => {
    const { users } = aggregateSeason([week("r1", "a", 8, 2), week("r1", "b", 5, 1), week("r2", "a", 3, 1), week("r2", "b", 9, 2)]);
    // a: 5.5, b: 7.
    expect(users.map((u) => u.userId)).toEqual(["a", "b"]);
  });

  it("ties on wins go to the better average: higher for a descending rule", () => {
    SCORING_RULES.test_points = { ...SCORING_RULES.average_finish!, key: "test_points", direction: "desc" };
    const rows = [week("r1", "a", 8, 1), week("r1", "b", 5, 2), week("r2", "a", 3, 2), week("r2", "b", 9, 1)].map((r) => ({
      ...r,
      scoringRuleKey: "test_points",
    }));
    // a: 5.5, b: 7.
    const { users } = aggregateSeason(rows);
    expect(users.map((u) => u.userId)).toEqual(["b", "a"]);
    expect(users[0]!.bestWeek?.score).toBe(9);
  });
});
