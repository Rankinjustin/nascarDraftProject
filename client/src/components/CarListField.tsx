import type { RaceEntryView } from "@dnd/shared";

/** One car number per line ("#" optional), mapped through the race's entries. Order is kept: line 1 is P1. */
export function parseCarList(text: string, entries: RaceEntryView[]) {
  const byCar = new Map(entries.map((e) => [e.carNumber, e.driverId]));
  const lines = text
    .split("\n")
    .map((l) => l.trim().replace(/^#/, ""))
    .filter(Boolean);
  const unmatched = [...new Set(lines.filter((l) => !byCar.has(l)))];
  const duplicates = [...new Set(lines.filter((l, i) => lines.indexOf(l) !== i))];
  return {
    driverIds: lines.map((l) => byCar.get(l) ?? ""),
    unmatched,
    duplicates,
    valid: lines.length > 0 && unmatched.length === 0 && duplicates.length === 0,
  };
}

/** The paste box plus its warnings; pass in parseCarList's result for the same text. */
export function CarListField({
  label,
  value,
  onChange,
  parsed,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  parsed: ReturnType<typeof parseCarList>;
}) {
  const cars = (list: string[]) => list.map((c) => `#${c}`).join(", ");
  return (
    <>
      <label>
        <span className="label">{label}</span>
        <textarea className="input min-h-32 py-2 font-mono" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      {parsed.unmatched.length > 0 && (
        <p className="text-sm text-amber-300">Not in this race's entries: {cars(parsed.unmatched)}</p>
      )}
      {parsed.duplicates.length > 0 && <p className="text-sm text-amber-300">Listed twice: {cars(parsed.duplicates)}</p>}
    </>
  );
}
