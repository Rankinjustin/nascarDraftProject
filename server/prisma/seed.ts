/**
 * Seeds the current season, its points-race schedule, the driver field, and the league's users.
 * Safe to re-run: it only adds what's missing. Races, drivers, and members that already exist are left alone; after the
 * first run they're edited in the app (Admin, the race lock, the entry-list import), and a re-run must not undo that.
 *
 * Data files (prisma/seed-data/):
 *   users.json         — the real league; gitignored so phone numbers stay out of the repo. Without it, development
 *                        seeds placeholders from users.example.json and production leaves members alone.
 *   races-<year>.json  — Cup points races from NASCAR's cacher race_list_basic.json (scripts/season-schedule.ts). The
 *                        newest year is the current season, so adding next year's file is the season rollover.
 *   drivers.json       — the field from a 2026 weekend feed, so the first draft works before any entry-list import.
 */
import { PrismaClient, type Role } from "@prisma/client";
import { normalizePhone } from "@dnd/shared";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { issueSetupLink } from "../src/auth/setupTokens";
import type { FeedScheduleRace } from "../src/integrations/nascarFeed";
import { zonedInstant } from "../src/notifications/quietHours";

const prisma = new PrismaClient();
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "seed-data");

interface SeedUser {
  displayName: string;
  phoneNumber: string;
  role?: Role;
}
interface SeedDriver {
  nascarDriverId: number;
  driverName: string;
  carNumber: string;
  teamName: string | null;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), "utf8")) as T;
}

/** Converts a zone-less Eastern wall-clock time ("2026-10-04T17:30:00") to a UTC Date, handling EST/EDT. */
function easternToUtc(local: string): Date {
  const [year, month, day, hour, minute] = local.split(/[-T:]/).map(Number);
  return zonedInstant({ year: year!, month: month!, day: day!, hour: hour!, minute: minute! }, "America/New_York");
}

/** The newest races-<year>.json. */
function currentSeasonYear(): number {
  const years = readdirSync(dataDir).flatMap((f) => /^races-(\d{4})\.json$/.exec(f)?.[1] ?? []).map(Number);
  if (years.length === 0) throw new Error(`No races-<year>.json in ${dataDir}.`);
  return Math.max(...years);
}

async function main() {
  const year = currentSeasonYear();
  const season = await prisma.season.upsert({
    where: { year_seriesId: { year, seriesId: 1 } },
    update: { isCurrent: true },
    create: { year, seriesId: 1, name: `${year} NASCAR Cup Series`, isCurrent: true },
  });
  await prisma.season.updateMany({ where: { id: { not: season.id } }, data: { isCurrent: false } });

  const races = readJson<FeedScheduleRace[]>(`races-${year}.json`);
  for (const r of races) {
    await prisma.race.upsert({
      where: { nascarRaceId: r.nascarRaceId },
      // Create only. An existing race may have been edited by the league (a postponement, a renamed race),
      // and changes to it go through the race lock, not the seed.
      update: {},
      create: {
        nascarRaceId: r.nascarRaceId,
        seasonId: season.id,
        raceName: r.raceName,
        trackName: r.trackName,
        raceDate: easternToUtc(r.startTimeEastern),
        totalLaps: r.totalLaps,
      },
    });
  }
  console.log(`Season "${season.name}" (current): ${races.length} races`);

  const drivers = readJson<SeedDriver[]>("drivers.json");
  for (const d of drivers) {
    // Create only: the entry-list import keeps car numbers and teams current, and this file goes stale.
    await prisma.driver.upsert({ where: { nascarDriverId: d.nascarDriverId }, update: {}, create: d });
  }
  console.log(`Drivers: ${drivers.length}`);

  let usersFile = "users.json";
  if (!existsSync(join(dataDir, usersFile))) {
    if (process.env.NODE_ENV === "production") {
      console.log("Users: no users.json given, so members are left as they are.");
      return;
    }
    usersFile = "users.example.json";
    console.warn("\n⚠ users.json not found — seeding PLACEHOLDER users from users.example.json.");
    console.warn("  Copy it to users.json, fill in the real league, and re-run the seed.\n");
  }
  const users = readJson<SeedUser[]>(usersFile);

  const links: Array<{ name: string; link: string }> = [];
  for (const u of users) {
    const phoneNumber = normalizePhone(u.phoneNumber);
    if (!phoneNumber) throw new Error(`Bad phone number for ${u.displayName}: "${u.phoneNumber}"`);
    const user = await prisma.user.upsert({
      where: { phoneNumber },
      // Create only: once someone exists, their name and role are changed in Admin.
      update: {},
      create: { phoneNumber, displayName: u.displayName, role: u.role ?? "MEMBER" },
    });
    // Anyone who hasn't set a password yet gets a fresh link (older links stop working). It's also the way back in for
    // a commissioner whose first link expired before they used it.
    if (!user.passwordHash) links.push({ name: user.displayName, link: await issueSetupLink(user.id, prisma) });
  }
  console.log(`Users: ${users.length} in ${usersFile} (existing members unchanged)`);

  if (links.length) {
    console.log("\nSetup links (single use, valid 7 days) — send each person theirs:");
    for (const { name, link } of links) console.log(`  ${name.padEnd(20)} ${link}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
