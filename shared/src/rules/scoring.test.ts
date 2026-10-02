import { describe, expect, it } from "vitest";
import { rankEntries, SCORING_RULES, type ScoringRule, type UserEntry } from "./scoring";

const avg = SCORING_RULES.average_finish!;
const ctx = { fieldSize: 38 };

const entry = (userId: string, ...finishes: (number | null)[]): UserEntry => ({
  userId,
  drivers: finishes.map((finishPosition, i) => ({ driverId: `${userId}-d${i}`, finishPosition })),
});

describe("average_finish", () => {
  it("is ascending", () => {
    expect(avg.direction).toBe("asc");
  });

  it("averages a clean 3-driver roster", () => {
    expect(avg.score(entry("a", 1, 5, 12), ctx)).toBe(6);
  });

  it("scores a null finish as fieldSize + 1", () => {
    expect(avg.score(entry("a", 1, 2, null), ctx)).toBe((1 + 2 + 39) / 3);
  });

  it("scores an empty slot as fieldSize + 1", () => {
    const e: UserEntry = {
      userId: "a",
      drivers: [
        { driverId: "d1", finishPosition: 3 },
        { driverId: "d2", finishPosition: 6 },
        { driverId: null, finishPosition: null },
      ],
    };
    expect(avg.score(e, ctx)).toBe((3 + 6 + 39) / 3);
  });

  it("an exact tie shares rank 1 and the next rank is 3", () => {
    const ranked = rankEntries([entry("c", 10, 20, 30), entry("a", 1, 5, 9), entry("b", 3, 4, 8)], avg, ctx);
    expect(ranked).toEqual([
      { userId: "a", score: 5, rank: 1 },
      { userId: "b", score: 5, rank: 1 },
      { userId: "c", score: 20, rank: 3 },
    ]);
  });
});

describe("rankEntries", () => {
  it("ranks ascending rules lowest first", () => {
    const ranked = rankEntries([entry("a", 20, 20, 20), entry("b", 1, 1, 1)], avg, ctx);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("ranks a desc rule highest score first", () => {
    const totalFinish: ScoringRule = {
      key: "total",
      label: "Total",
      description: "",
      direction: "desc",
      score: (e) => e.drivers.reduce((s, d) => s + (d.finishPosition ?? 0), 0),
    };
    const ranked = rankEntries([entry("a", 1, 1, 1), entry("b", 10, 10, 10), entry("c", 5, 5, 5)], totalFinish, ctx);
    expect(ranked.map((r) => [r.userId, r.score, r.rank])).toEqual([
      ["b", 30, 1],
      ["c", 15, 2],
      ["a", 3, 3],
    ]);
  });

  it("handles a three-way tie followed by a single", () => {
    const ranked = rankEntries(
      [entry("a", 2, 2, 2), entry("b", 2, 2, 2), entry("c", 2, 2, 2), entry("d", 9, 9, 9)],
      avg,
      ctx,
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1, 4]);
  });

  it("returns an empty list for no entries", () => {
    expect(rankEntries([], avg, ctx)).toEqual([]);
  });
});
