import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { fetchRunsList } from "@/lib/eval-api";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

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
