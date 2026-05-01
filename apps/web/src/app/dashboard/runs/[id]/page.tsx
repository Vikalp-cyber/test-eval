import { headers } from "next/headers";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { fetchRun } from "@/lib/eval-api";

import { RunDetailClient } from "./run-detail-client";

type Props = { params: Promise<{ id: string }> };

export default async function RunDetailPage({ params }: Props) {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  let run: Awaited<ReturnType<typeof fetchRun>>;
  try {
    run = await fetchRun(id);
  } catch {
    return (
      <div className="min-h-screen bg-slate-950 p-10 text-slate-300">
        <p>Could not load run (is the API server running?).</p>
        <Link href="/dashboard" className="text-indigo-400 mt-4 inline-block">
          Back to runs
        </Link>
      </div>
    );
  }

  if (!run) {
    notFound();
  }

  return <RunDetailClient initialRun={run} />;
}
