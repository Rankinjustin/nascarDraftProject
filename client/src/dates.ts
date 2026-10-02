/** All dates arrive as ISO strings and are shown in the viewer's own time zone. */

export function formatRaceDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** ISO instant → the value a <input type="datetime-local"> expects, in local time. */
export function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value (local wall-clock time) → ISO instant. */
export function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString();
}
