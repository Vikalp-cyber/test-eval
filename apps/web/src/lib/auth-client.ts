import { env } from "@test-evals/env/web";
import { createAuthClient } from "better-auth/react";

/**
 * Resolve the right baseURL for Better Auth.
 *
 * - In the browser we ALWAYS use `window.location.origin`. Combined with the
 *   Next.js rewrite for `/api/auth/*` this means auth requests stay
 *   first-party to the dashboard origin and the session cookie is stored on
 *   the SAME origin the user is browsing — no CORS, no third-party-cookie
 *   problems on Render's *.onrender.com subdomains.
 *
 * - On the server (RSC / route handlers) we don't have window, so we fall
 *   back to NEXT_PUBLIC_WEB_URL when set, otherwise NEXT_PUBLIC_SERVER_URL.
 */
function resolveBaseURL(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return env.NEXT_PUBLIC_WEB_URL ?? env.NEXT_PUBLIC_SERVER_URL;
}

const baseURL = resolveBaseURL();

if (typeof window !== "undefined") {
  // Always print so users can copy this from browser devtools when debugging
  // a deploy. It's a constant value, no PII.
  console.log("[auth-client] baseURL =", baseURL);
}

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    credentials: "include",
  },
});
