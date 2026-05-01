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
const authDebug = process.env.AUTH_DEBUG === "true";

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

app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const url = new URL(c.req.url);
  const cookie = c.req.header("cookie") ?? "";
  const hasCookie = cookie.length > 0;
  const origin = c.req.header("origin") ?? "-";

  if (authDebug) {
    console.log(
      `[auth-debug] -> ${c.req.method} ${url.pathname} origin=${origin} hasCookie=${hasCookie}`,
    );
  }

  const res = await auth.handler(c.req.raw);

  if (authDebug) {
    const hasSetCookie = !!res.headers.get("set-cookie");
    console.log(
      `[auth-debug] <- ${c.req.method} ${url.pathname} status=${res.status} setCookie=${hasSetCookie}`,
    );
  }

  // Lightweight signal visible in browser devtools network tab.
  res.headers.set("x-auth-debug-seen-cookie", hasCookie ? "1" : "0");
  return res;
});

app.route("/api/v1/transcripts", transcriptsRouter);
app.route("/api/v1/runs", runsRouter);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
