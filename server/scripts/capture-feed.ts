/**
 * Race-weekend fixture capture (SPEC Section 16). Leave it running through practice, qualifying, and the race:
 *   npm run capture:feed -w server -- 5630
 * Saves every changed live-feed response (checked every 30s) and the cacher weekend feed for the given NASCAR race
 * id (every 10 min) under server/test/fixtures/capture/<date>/. That folder is gitignored; copy the few files worth
 * keeping (a practice, a qualifying session, a caution, the checkered) up into server/test/fixtures/.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRaw, liveFeedUrl, weekendFeedUrl } from "../src/integrations/nascarFeed";

const raceId = Number(process.argv[2]);
const seriesId = Number(process.argv[3] ?? 1);
const outRoot = join(import.meta.dirname, "..", "test", "fixtures", "capture");
const lastHash = new Map<string, string>();

function save(kind: string, data: unknown): void {
  const text = JSON.stringify(data, null, 1);
  const hash = createHash("sha1").update(text).digest("hex");
  if (lastHash.get(kind) === hash) return;
  lastHash.set(kind, hash);
  const now = new Date();
  const dir = join(outRoot, now.toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });
  const run = typeof data === "object" && data && "run_type" in data ? `-run${(data as { run_type: unknown }).run_type}` : "";
  const file = join(dir, `${kind}-${now.toISOString().slice(11, 19).replaceAll(":", "")}${run}.json`);
  writeFileSync(file, text);
  const vehicles = (data as { vehicles?: unknown[] }).vehicles;
  console.log(`${now.toLocaleTimeString()} saved ${file}${Array.isArray(vehicles) ? ` (${vehicles.length} vehicles)` : ""}`);
}

async function tick(what: string, url: string): Promise<void> {
  try {
    save(what, await fetchRaw(url));
  } catch (err) {
    console.warn(`${new Date().toLocaleTimeString()} ${what} failed:`, err instanceof Error ? err.message : err);
  }
}

const live = () => tick("live-feed", liveFeedUrl());
const weekend = () =>
  raceId ? tick("weekend-feed", weekendFeedUrl(new Date().getFullYear(), seriesId, raceId)) : Promise.resolve();

console.log(`Capturing the live feed every 30s${raceId ? ` and race ${raceId}'s weekend feed every 10 min` : ""}. Ctrl+C to stop.`);
await Promise.all([live(), weekend()]);
setInterval(live, 30_000);
setInterval(weekend, 10 * 60_000);
