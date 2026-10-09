import type { RaceSummary } from "@dnd/shared";

/**
 * Built-in race card pictures in public/tracks, by track name (credits in public/tracks/credits.txt). A link the
 * commissioner sets on the race wins over these.
 */
const TRACK_FILES: Record<string, string> = {
  "Daytona International Speedway": "daytona",
  "Atlanta Motor Speedway": "atlanta",
  "Circuit of The Americas": "cota",
  "Phoenix Raceway": "phoenix",
  "Las Vegas Motor Speedway": "lasvegas",
  "Darlington Raceway": "darlington",
  "Martinsville Speedway": "martinsville",
  "Bristol Motor Speedway": "bristol",
  "Kansas Speedway": "kansas",
  "Talladega Superspeedway": "talladega",
  "Texas Motor Speedway": "texas",
  "Watkins Glen International": "watkinsglen",
  "Charlotte Motor Speedway": "charlotte",
  "Nashville Superspeedway": "nashville",
  "Michigan International Speedway": "michigan",
  "Pocono Raceway": "pocono",
  "San Diego Street Course": "sandiego",
  "Sonoma Raceway": "sonoma",
  "Chicagoland Speedway": "chicagoland",
  "North Wilkesboro Speedway": "northwilkesboro",
  "Indianapolis Motor Speedway": "indianapolis",
  "Iowa Speedway": "iowa",
  "Richmond Raceway": "richmond",
  "New Hampshire Motor Speedway": "newhampshire",
  "World Wide Technology Raceway": "gateway",
  "Homestead-Miami Speedway": "homestead",
};

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_KEY = new Map(Object.entries(TRACK_FILES).map(([name, file]) => [key(name), file]));
// The San Diego street course is only partly mapped, so it has a photo but no outline.
const NO_OUTLINE = new Set(["sandiego"]);

/** Every track with built-in pictures, for the commissioner's preview. */
export const BUILT_IN_TRACKS = Object.keys(TRACK_FILES);

export function trackArt(race: Pick<RaceSummary, "trackName" | "trackMapUrl" | "imageUrl">) {
  const file = BY_KEY.get(key(race.trackName));
  return {
    outline: race.trackMapUrl ?? (file && !NO_OUTLINE.has(file) ? `/tracks/${file}.svg` : null),
    photo: race.imageUrl ?? (file ? `/tracks/${file}.jpg` : null),
  };
}
