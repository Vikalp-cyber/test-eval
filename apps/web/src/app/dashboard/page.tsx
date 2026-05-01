import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { fetchRunsList } from "@/lib/eval-api";
import { fetchSessionFromHeaders } from "@/lib/server-session";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const incomingHeaders = await headers();
  const session = await fetchSessionFromHeaders(incomingHeaders, "dashboard");

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
