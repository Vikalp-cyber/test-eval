import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import { NewRunForm } from "./new-run-form";

export default async function NewRunPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-6 lg:p-12">
      <div className="max-w-lg mx-auto space-y-8">
        <div>
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-300">
            ← Runs
          </Link>
          <h1 className="text-3xl font-light text-white mt-4">Start evaluation run</h1>
          <p className="text-slate-400 text-sm mt-2">
            POSTs to the eval API and opens the run detail view. Runs execute on the server in the background.
          </p>
        </div>
        <NewRunForm />
      </div>
    </div>
  );
}
