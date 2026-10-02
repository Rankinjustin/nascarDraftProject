import { formatPhoneForDisplay } from "@dnd/shared";

/** Opens the number pad on phones and formats as you type; the server normalizes whatever is submitted. */
export function PhoneInput({
  value,
  onChange,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      autoFocus={autoFocus}
      placeholder="(920) 555-1234"
      className="input"
      value={value}
      onChange={(e) => onChange(formatPhoneForDisplay(e.target.value))}
    />
  );
}
