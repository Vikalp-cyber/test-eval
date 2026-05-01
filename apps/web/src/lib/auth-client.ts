import { env } from "@test-evals/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Use web origin for auth so cookies are first-party to the dashboard app.
  // `/api/auth/*` is proxied to the server by Next rewrites.
  baseURL: env.NEXT_PUBLIC_WEB_URL ?? env.NEXT_PUBLIC_SERVER_URL,
  fetchOptions: {
    credentials: "include",
  },
});
