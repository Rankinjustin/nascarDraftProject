import type { User } from "@prisma/client";
import { normalizePhone } from "@dnd/shared";
import { z } from "zod";
import { prisma } from "../db";
import { getDummyHash, verifyPassword } from "./passwords";

export interface AuthProvider {
  /** Verify a credential payload; return the user or null. */
  verify(input: unknown): Promise<User | null>;
  /** Optional: send a challenge (OTP code, magic link). No-op for passwords. */
  challenge?(input: unknown): Promise<void>;
}

const loginBody = z.object({
  phoneNumber: z.string().max(40),
  password: z.string().min(1).max(200),
});

export class PhonePasswordProvider implements AuthProvider {
  async verify(input: unknown): Promise<User | null> {
    const { phoneNumber, password } = loginBody.parse(input);
    const phone = normalizePhone(phoneNumber);
    const user = phone ? await prisma.user.findUnique({ where: { phoneNumber: phone } }) : null;

    // Always run one verify, so "no such number" and "wrong password" take the same time.
    const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
    if (!user || !user.passwordHash || !user.isActive || !ok) return null;
    return user;
  }
}

export const authProvider: AuthProvider = new PhonePasswordProvider();
