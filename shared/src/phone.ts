/** Strip non-digits; 10 digits → "+1" + digits; 11 digits starting with 1 → "+" + digits; else null. */
export function normalizePhone(input: string): string | null {
  if (/[a-z]/i.test(input)) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Display formatting while typing: "9205551234" → "(920) 555-1234". Partial input is formatted as far as it goes. */
export function formatPhoneForDisplay(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
