import "./env-bootstrap.js";
import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { runMigrationsOnStart } from "./migrate-on-start.js";
import { runsRouter } from "./routes/runs.router.js";
import { transcriptsRouter } from "./routes/transcripts.router.js";

// Top-level await: applies pending Drizzle schema before the server begins
// answering requests. Skipped automatically in tests (AUTO_MIGRATE=false).
await runMigrationsOnStart();

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    // `x-anthropic-api-key` lets the dashboard pass a per-user Anthropic key
    // without us ever persisting it server-side.
    allowHeaders: ["Content-Type", "Authorization", "x-anthropic-api-key"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/v1/transcripts", transcriptsRouter);
app.route("/api/v1/runs", runsRouter);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
