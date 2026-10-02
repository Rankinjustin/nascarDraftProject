import type { Driver } from "@prisma/client";
import type { Tx } from "../races/lock";

export interface FeedDriver {
  nascarDriverId: number;
  driverName: string;
  carNumber: string;
  teamName?: string | null;
}

/**
 * Maps feed cars to Driver rows (SPEC Section 7, "Resolving feed vehicles to drivers"). The one place this happens;
 * the poller's results and qualifying writes and the entry-list import all call it. For each car, in order:
 *   1. a Driver with this nascarDriverId;
 *   2. else a hand-added entry in this race (nascarDriverId null) with the same car number — backfill its id;
 *   3. else create the Driver. No RaceEntry is created here: an unknown car wasn't draftable, but it still counts.
 * Returns drivers in the same order as `cars`.
 */
export async function resolveDrivers(tx: Tx, raceId: string, cars: FeedDriver[]): Promise<Driver[]> {
  const known = await tx.driver.findMany({ where: { nascarDriverId: { in: cars.map((c) => c.nascarDriverId) } } });
  const byNascarId = new Map(known.map((d) => [d.nascarDriverId!, d]));

  const resolved: Driver[] = [];
  for (const car of cars) {
    let driver = byNascarId.get(car.nascarDriverId);
    if (!driver) {
      const handAdded = await tx.raceEntry.findFirst({
        where: { raceId, carNumber: car.carNumber, driver: { nascarDriverId: null } },
        include: { driver: true },
      });
      driver = handAdded
        ? await tx.driver.update({ where: { id: handAdded.driverId }, data: { nascarDriverId: car.nascarDriverId } })
        : await tx.driver.create({
            data: {
              nascarDriverId: car.nascarDriverId,
              driverName: car.driverName,
              carNumber: car.carNumber,
              teamName: car.teamName ?? null,
            },
          });
      byNascarId.set(car.nascarDriverId, driver);
    }
    resolved.push(driver);
  }
  return resolved;
}
