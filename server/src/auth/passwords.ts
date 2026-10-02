import argon2 from "argon2";
import { randomBytes } from "node:crypto";

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// Verified against when no user matches, so a wrong phone number takes as long as a wrong password.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
