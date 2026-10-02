import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  const expected = "+19205551234";

  it.each([
    "9205551234",
    "19205551234",
    "+19205551234",
    "(920) 555-1234",
    "920-555-1234",
    "920.555.1234",
    "920 555 1234",
    "+1 920 555 1234",
    "+1-920-555-1234",
    "1 (920) 555-1234",
  ])("normalizes %s", (input) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["9 digits", "920555123"],
    ["12 digits", "192055512345"],
    ["11 digits not starting with 1", "29205551234"],
    ["letters", "920-555-CALL"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("formatPhoneForDisplay", () => {
  it("formats progressively", () => {
    expect(formatPhoneForDisplay("")).toBe("");
    expect(formatPhoneForDisplay("920")).toBe("(920");
    expect(formatPhoneForDisplay("920555")).toBe("(920) 555");
    expect(formatPhoneForDisplay("9205551234")).toBe("(920) 555-1234");
  });

  it("drops a leading country code and extra digits", () => {
    expect(formatPhoneForDisplay("+1 920 555 1234")).toBe("(920) 555-1234");
    expect(formatPhoneForDisplay("92055512345")).toBe("(920) 555-1234");
  });
});
