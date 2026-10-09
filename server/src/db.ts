import { PrismaClient, type Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

/** The client, or an open transaction. */
export type Db = Prisma.TransactionClient | typeof prisma;
