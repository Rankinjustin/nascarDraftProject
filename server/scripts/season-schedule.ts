/**
 * A new season's schedule for the seed. Once NASCAR has published it (the cacher file appears around the new year):
 *   npm run season:schedule -w server -- 2027
 * writes prisma/seed-data/races-2027.json. Commit it and deploy, then `sudo dnd seed` on the server adds the season and
 * makes it current (deploy/gcp/README.md, "New season"). Run it after the last race of the old season.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRaw, normalizeSchedule, scheduleUrl } from "../src/integrations/nascarFeed";

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2000) {
  console.error("usage: npm run season:schedule -w server -- <year>");
  process.exit(1);
}

// Cup only, like the rest of the app (Season.seriesId 1).
const races = normalizeSchedule(await fetchRaw(scheduleUrl(year)), 1);
if (races.length === 0) throw new Error(`NASCAR's ${year} schedule has no points races yet.`);
const file = join(import.meta.dirname, "..", "prisma", "seed-data", `races-${year}.json`);
writeFileSync(file, `${JSON.stringify(races, null, 2)}\n`);
console.log(`Wrote ${races.length} races to ${file}`);
