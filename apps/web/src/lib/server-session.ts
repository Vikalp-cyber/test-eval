import "server-only";

/**
 * Bulletproof server-side session fetcher.
 *
 * Why not just `authClient.getSession({ headers })`?
 *
 * On Render's split web/server deployment, the better-auth client's baseURL
 * defaults to NEXT_PUBLIC_SERVER_URL when NEXT_PUBLIC_WEB_URL isn't set. That
 * sends the SSR session check cross-origin, and forwarding the entire
 * Headers object can confuse the request (Host header collision, etc.) — so
 * SSR sometimes returns null even when the browser holds a perfectly valid
 * session cookie (which is exactly the bug we hit).
 *
 * Instead we hit `/api/auth/get-session` on the SAME origin the user is
 * browsing (using the incoming `host` header), and forward ONLY the cookie.
 * The Next.js rewrite proxies that to the real server, so the session
 * validation runs against the same DB but the network path stays simple
 * and env-var-free.
 */
export interface SessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

export interface SessionResult {
  user: SessionUser | null;
}

export async function fetchSessionFromHeaders(
  incomingHeaders: Headers,
  label: string,
): Promise<SessionResult | null> {
  const cookieHeader = incomingHeaders.get("cookie") ?? "";
  const cookieNames = cookieHeader
    ? cookieHeader
        .split(";")
        .map((c) => c.split("=")[0]?.trim())
        .filter(Boolean)
    : [];

  const host = incomingHeaders.get("host");
  const proto = incomingHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${proto}://${host}` : null;

  console.log(
    `[auth:web] ${label} SSR host=${host ?? "-"} cookies=[${cookieNames.join(",")}] cookieLen=${cookieHeader.length}`,
  );

  if (!baseUrl) {
    console.error(`[auth:web] ${label} SSR: no host header, cannot resolve baseUrl`);
    return null;
  }

  if (!cookieHeader) {
    console.log(`[auth:web] ${label} SSR: no cookie header → unauthenticated`);
    return { user: null };
  }

  const url = `${baseUrl}/api/auth/get-session`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        cookie: cookieHeader,
        accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error(`[auth:web] ${label} SSR fetch ${url} threw:`, err);
    return null;
  }

  if (!res.ok) {
    console.error(
      `[auth:web] ${label} SSR get-session ${url} status=${res.status}`,
    );
    return { user: null };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    console.error(`[auth:web] ${label} SSR get-session JSON parse failed:`, err);
    return null;
  }

  // better-auth returns either null (no session) or { session, user }.
  if (!body || typeof body !== "object") {
    console.log(`[auth:web] ${label} SSR session body=null → unauthenticated`);
    return { user: null };
  }

  const user = (body as { user?: SessionUser | null }).user ?? null;
  console.log(
    `[auth:web] ${label} SSR session user=${user ? `present(${user.email ?? user.id})` : "null"}`,
  );

  return { user };
}
