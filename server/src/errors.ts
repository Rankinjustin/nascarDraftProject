import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthenticated = () => new HttpError(401, "UNAUTHENTICATED", "Please log in.");
export const forbidden = () => new HttpError(403, "FORBIDDEN", "You don't have permission to do that.");
export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found.`);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    res.status(400).json({ code: "VALIDATION_ERROR", message: `${where}${first?.message ?? "Invalid input."}` });
    return;
  }
  // express.json() parse failures
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ code: "INVALID_JSON", message: "Request body is not valid JSON." });
    return;
  }
  console.error(err);
  res.status(500).json({ code: "INTERNAL", message: "Something went wrong." });
};

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
