/**
 * Seeds the current season, its points-race schedule, the driver field, and the league's users.
 * Safe to re-run: everything is upserted by a natural key.
 *
 * Data files (prisma/seed-data/):
 *   users.json        — the real league; gitignored so phone numbers stay out of the repo.
 *                       Falls back to users.example.json (placeholders) if missing.
 *   races-2026.json   — Cup points races from NASCAR's cacher race_list_basic.json.
 *   drivers.json      — the field from the most recent race's weekend feed.
 */
import { PrismaClient, type Role } from "@prisma/client";
import { normalizePhone } from "@dnd/shared";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { issueSetupLink } from "../src/auth/setupTokens";

const prisma = new PrismaClient();
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "seed-data");

const SEASON = { year: 2026, seriesId: 1, name: "2026 NASCAR Cup Series" };

interface SeedUser {
  displayName: string;
  phoneNumber: string;
  role?: Role;
}
interface SeedRace {
  nascarRaceId: number;
  raceName: string;
  trackName: string;
  startTimeEastern: string; // "2026-10-04T17:30:00", no zone — NASCAR publishes Eastern local time
  totalLaps: number | null;
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

/** Converts a zone-less Eastern wall-clock time to a UTC Date, handling EST/EDT. */
function easternToUtc(local: string): Date {
  const asUtc = new Date(`${local}Z`).getTime();
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return wall - instant;
  };
  // Two passes so a time near a DST change uses the offset in effect at the result.
  let utc = asUtc - offsetAt(asUtc);
  utc = asUtc - offsetAt(utc);
  return new Date(utc);
}

async function main() {
  const season = await prisma.season.upsert({
    where: { year_seriesId: { year: SEASON.year, seriesId: SEASON.seriesId } },
    update: { name: SEASON.name, isCurrent: true },
    create: { ...SEASON, isCurrent: true },
  });
  await prisma.season.updateMany({ where: { id: { not: season.id } }, data: { isCurrent: false } });

  const races = readJson<SeedRace[]>("races-2026.json");
  for (const r of races) {
    const data = {
      raceName: r.raceName,
      trackName: r.trackName,
      raceDate: easternToUtc(r.startTimeEastern),
      totalLaps: r.totalLaps,
    };
    await prisma.race.upsert({
      where: { nascarRaceId: r.nascarRaceId },
      // Only touch schedule fields; never status or anything the league has done with the race.
      update: data,
      create: { ...data, nascarRaceId: r.nascarRaceId, seasonId: season.id },
    });
  }
  console.log(`Season "${season.name}": ${races.length} races`);

  const drivers = readJson<SeedDriver[]>("drivers.json");
  for (const d of drivers) {
    await prisma.driver.upsert({
      where: { nascarDriverId: d.nascarDriverId },
      update: { driverName: d.driverName, carNumber: d.carNumber, teamName: d.teamName },
      create: d,
    });
  }
  console.log(`Drivers: ${drivers.length}`);

  const usersFile = existsSync(join(dataDir, "users.json")) ? "users.json" : "users.example.json";
  if (usersFile === "users.example.json") {
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
      update: { displayName: u.displayName, role: u.role ?? "MEMBER" },
      create: { phoneNumber, displayName: u.displayName, role: u.role ?? "MEMBER" },
    });
    // Anyone who hasn't set a password yet gets a fresh link (older links stop working).
    if (!user.passwordHash) links.push({ name: user.displayName, link: await issueSetupLink(user.id, prisma) });
  }
  console.log(`Users: ${users.length}`);

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
