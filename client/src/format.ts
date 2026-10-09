/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** A score or average to a fixed number of decimals; "—" when unknown. */
export function fixed(n: number | null, digits: number): string {
  return n === null ? "—" : n.toFixed(digits);
}

/** 0.42 → "42%"; "—" when unknown. */
export function percent(x: number | null): string {
  return x === null ? "—" : `${Math.round(x * 100)}%`;
}
