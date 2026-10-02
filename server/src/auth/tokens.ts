import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url. The raw value goes to the client; only the hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
