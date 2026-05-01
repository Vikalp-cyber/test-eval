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

// ── Startup banner ──────────────────────────────────────────────
// Always-on so users can paste this snippet from their Render logs when
// asking for help. Nothing here is secret (CORS_ORIGIN / BETTER_AUTH_URL
// are public anyway; the secret length confirms presence without leaking).
const isProd = env.NODE_ENV === "production";
console.log("─".repeat(60));
console.log("[startup] HEALOSBENCH server booting");
console.log(`[startup] NODE_ENV         = ${env.NODE_ENV}`);
console.log(`[startup] CORS_ORIGIN      = ${env.CORS_ORIGIN}`);
console.log(`[startup] BETTER_AUTH_URL  = ${env.BETTER_AUTH_URL}`);
console.log(
  `[startup] BETTER_AUTH_SECRET = ${env.BETTER_AUTH_SECRET ? `set (${env.BETTER_AUTH_SECRET.length} chars)` : "MISSING"}`,
);
console.log(
  `[startup] cookie attrs   = sameSite=${isProd ? "none" : "lax"} secure=${isProd} httpOnly=true`,
);
console.log(
  `[startup] ANTHROPIC_API_KEY = ${process.env.ANTHROPIC_API_KEY ? "set" : "not set (clients can supply via header)"}`,
);
console.log("─".repeat(60));

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

// ── Auth handler with ALWAYS-ON debug logs ───────────────────────
// Logs are intentionally not gated behind an env var right now so the user
// can share Render logs verbatim while debugging session/cookie issues.
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const url = new URL(c.req.url);
  const cookie = c.req.header("cookie") ?? "";
  const origin = c.req.header("origin") ?? "-";
  const referer = c.req.header("referer") ?? "-";
  const host = c.req.header("host") ?? "-";

  // List cookie names without values so we can confirm the auth cookie is
  // being sent without ever logging the actual session token.
  const cookieNames = cookie
    ? cookie.split(";").map((c) => c.split("=")[0]?.trim()).filter(Boolean)
    : [];

  console.log(
    `[auth] -> ${c.req.method} ${url.pathname} host=${host} origin=${origin} referer=${referer} cookies=[${cookieNames.join(",")}]`,
  );

  let res: Response;
  try {
    res = await auth.handler(c.req.raw);
  } catch (err) {
    console.error(`[auth] !! handler threw on ${url.pathname}:`, err);
    throw err;
  }

  const setCookie = res.headers.get("set-cookie") ?? "";
  // Strip the actual token value from set-cookie so we can safely log
  // the attributes (SameSite, Secure, Path, Domain, Expires).
  const setCookieAttrs = setCookie
    ? setCookie
        .split(",")
        .map((c) => {
          const [nameValue, ...rest] = c.split(";");
          const name = nameValue?.split("=")[0]?.trim() ?? "?";
          return [`${name}=<redacted>`, ...rest.map((r) => r.trim())].join("; ");
        })
        .join(" || ")
    : "(none)";

  console.log(
    `[auth] <- ${c.req.method} ${url.pathname} status=${res.status} setCookie=${setCookieAttrs}`,
  );

  // Surface state to the browser for quick eyeballing in DevTools → Network.
  res.headers.set(
    "x-auth-debug",
    `cookies=${cookieNames.length} setCookie=${setCookie ? "1" : "0"}`,
  );
  return res;
});

// ── /api/v1/debug/auth ───────────────────────────────────────────
// Plain JSON dump of public auth config so users can curl it from anywhere
// to verify what the deployed server actually sees. Never returns secrets.
app.get("/api/v1/debug/auth", (c) => {
  const cookie = c.req.header("cookie") ?? "";
  return c.json({
    nodeEnv: env.NODE_ENV,
    isProd,
    corsOrigin: env.CORS_ORIGIN,
    betterAuthUrl: env.BETTER_AUTH_URL,
    betterAuthSecretLength: env.BETTER_AUTH_SECRET?.length ?? 0,
    cookieAttributes: {
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
      httpOnly: true,
    },
    requestSeen: {
      origin: c.req.header("origin") ?? null,
      referer: c.req.header("referer") ?? null,
      host: c.req.header("host") ?? null,
      hasCookie: cookie.length > 0,
      cookieNames: cookie
        ? cookie.split(";").map((c) => c.split("=")[0]?.trim()).filter(Boolean)
        : [],
    },
    // Useful for confirming a fresh deploy reached production.
    bootedAt: new Date().toISOString(),
  });
});

app.route("/api/v1/transcripts", transcriptsRouter);
app.route("/api/v1/runs", runsRouter);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
