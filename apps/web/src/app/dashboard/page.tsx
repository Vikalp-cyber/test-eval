import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { fetchRunsList } from "@/lib/eval-api";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const incomingHeaders = await headers();

  // Always-on diagnostic so you can copy this from Render web logs while
  // troubleshooting login. Lists cookie NAMES only (no token values).
  const cookieHeader = incomingHeaders.get("cookie") ?? "";
  const cookieNames = cookieHeader
    ? cookieHeader.split(";").map((c) => c.split("=")[0]?.trim()).filter(Boolean)
    : [];
  console.log(
    `[auth:web] dashboard SSR host=${incomingHeaders.get("host") ?? "-"} cookies=[${cookieNames.join(",")}]`,
  );

  let session: Awaited<ReturnType<typeof authClient.getSession>> = null;
  try {
    session = await authClient.getSession({
      fetchOptions: {
        headers: incomingHeaders,
        throw: true,
      },
    });
  } catch (err) {
    console.error("[auth:web] dashboard getSession threw:", err);
  }

  console.log(
    `[auth:web] dashboard getSession user=${session?.user ? `present(${session.user.email ?? "no-email"})` : "null"}`,
  );

  if (!session?.user) {
    redirect("/login");
  }

  let runs: Awaited<ReturnType<typeof fetchRunsList>> = [];
  try {
    runs = await fetchRunsList();
  } catch {
    runs = [];
  }

  return <Dashboard runs={runs} />;
}
