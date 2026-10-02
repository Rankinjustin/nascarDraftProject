import * as Sentry from "@sentry/node";
import cookieParser from "cookie-parser";
import express from "express";
import { loadSession } from "./auth/sessions";
import { env } from "./env";
import { errorHandler, notFound } from "./errors";
import { csrfGuard } from "./middleware/csrf";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { usersRouter } from "./routes/users";

export function createApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use("/health", healthRouter);
  api.use(csrfGuard);
  api.use(loadSession);
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use(() => {
    throw notFound("Route");
  });

  app.use("/api", api);
  if (env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);
  return app;
}
