import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FeedShapeError,
  liveFeedSnapshot,
  normalizeEntryList,
  normalizeLiveFeed,
  normalizeQualifyingStart,
  refreshLiveFeed,
  setLiveFeedCache,
} from "./nascarFeed";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "test", "fixtures", name), "utf8"));

describe("normalizeLiveFeed", () => {
  it("reads the verified top-level fields from the real idle feed", () => {
    const feed = normalizeLiveFeed(fixture("live-feed-2026-10-02-idle.json"));
    expect(feed).toMatchObject({
      nascarRaceId: 5628,
      seriesId: 1,
      sessionType: "race",
      currentLap: 267,
      totalLaps: 267,
      flagState: 9,
      vehicles: [],
    });
  });

  // Provisional vehicle shape (unverified until a session is captured). Update alongside readVehicle.
  it("reads a vehicle, and treats a zero lap time as missing", () => {
    const feed = normalizeLiveFeed({
      race_id: 5630,
      run_type: 2,
      flag_state: 1,
      vehicles: [
        { running_position: 1, vehicle_number: "5", driver: { driver_id: 4030, full_name: "Kyle Larson" }, best_lap_time: 29.1, best_lap_speed: 185.5 },
        { running_position: 2, vehicle_number: "45", driver: { driver_id: 4065, full_name: "Tyler Reddick" }, best_lap_time: 0 },
      ],
    });
    expect(feed.sessionType).toBe("qualifying");
    expect(feed.vehicles[0]).toMatchObject({ nascarDriverId: 4030, carNumber: "5", runningPosition: 1, bestLapTime: 29.1 });
    expect(feed.vehicles[1]!.bestLapTime).toBeNull();
  });

  it("rejects a payload it can't read in full rather than dropping cars", () => {
    expect(() => normalizeLiveFeed({ nope: true })).toThrow(FeedShapeError);
    expect(() => normalizeLiveFeed({ race_id: 1, vehicles: [{ running_position: 1 }] })).toThrow(FeedShapeError);
  });
});

describe("refreshLiveFeed", () => {
  it("a malformed payload keeps the cached feed with stale: true and doesn't throw", async () => {
    const good = normalizeLiveFeed(fixture("live-feed-2026-10-02-idle.json"));
    setLiveFeedCache(good);
    const snapshot = await refreshLiveFeed(async () => ({ garbage: [] }));
    expect(snapshot.stale).toBe(true);
    expect(snapshot.feed).toBe(good);

    await refreshLiveFeed(async () => fixture("live-feed-2026-10-02-idle.json"));
    expect(liveFeedSnapshot().stale).toBe(false);
  });

  it("a network failure after a restart serves feed: null", async () => {
    setLiveFeedCache(null);
    const snapshot = await refreshLiveFeed(async () => {
      throw new Error("ECONNRESET");
    });
    expect(snapshot).toEqual({ feed: null, stale: true });
  });
});

describe("normalizeEntryList", () => {
  it("reads the pre-race entry list from the cacher weekend feed", () => {
    const entries = normalizeEntryList(fixture("cacher-2026-1-5630-weekend-feed-prerace-2026-10-02.json"), 5630);
    expect(entries).toHaveLength(36);
    expect(entries[0]).toEqual({ nascarDriverId: 4065, driverName: "Tyler Reddick", carNumber: "45", teamName: "23XI Racing" });
  });

  it("rejects a feed for a different race", () => {
    expect(() => normalizeEntryList(fixture("cacher-2026-1-5630-weekend-feed-prerace-2026-10-02.json"), 1)).toThrow(FeedShapeError);
  });
});

describe("normalizeQualifyingStart", () => {
  it("reads qualifying's scheduled start from the weekend feed, as UTC", () => {
    const start = normalizeQualifyingStart(fixture("cacher-2026-1-5630-weekend-feed-prerace-2026-10-02.json"), 5630);
    expect(start?.toISOString()).toBe("2026-10-03T21:35:00.000Z");
  });

  it("returns null when the race or its qualifying entry is missing", () => {
    expect(normalizeQualifyingStart(fixture("cacher-2026-1-5630-weekend-feed-prerace-2026-10-02.json"), 1)).toBeNull();
    expect(normalizeQualifyingStart({ weekend_race: [{ race_id: 5, schedule: [{ run_type: 3, start_time_utc: "2026-10-04T21:30:00" }] }] }, 5)).toBeNull();
  });
});
