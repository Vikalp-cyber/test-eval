import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { fetchRun, meanPerFieldScores } from "@/lib/eval-api";

type Props = {
  searchParams: Promise<{ run1?: string; run2?: string }>;
};

const fields = [
  { key: "aggregateF1" as const, label: "Aggregate F1" },
  { key: "chief_complaint" as const, label: "Chief complaint" },
  { key: "vitals" as const, label: "Vitals (avg)" },
  { key: "medications_f1" as const, label: "Medications F1" },
  { key: "diagnoses_f1" as const, label: "Diagnoses F1" },
  { key: "plan_f1" as const, label: "Plan F1" },
  { key: "follow_up" as const, label: "Follow-up" },
];

export default async function ComparePage({ searchParams }: Props) {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  const { run1: id1, run2: id2 } = await searchParams;

  if (!id1 || !id2) {
    return (
      <div className="min-h-screen bg-slate-950 p-10 text-slate-300">
        <p>Select two runs from the dashboard (checkboxes), then open Compare.</p>
        <Link href="/dashboard" className="text-indigo-400 mt-4 inline-block">
          Back to runs
        </Link>
      </div>
    );
  }

  let runA: Awaited<ReturnType<typeof fetchRun>>;
  let runB: Awaited<ReturnType<typeof fetchRun>>;
  try {
    [runA, runB] = await Promise.all([fetchRun(id1), fetchRun(id2)]);
  } catch {
    return (
      <div className="min-h-screen bg-slate-950 p-10 text-slate-300">
        <p>Could not load runs.</p>
        <Link href="/dashboard" className="text-indigo-400 mt-4 inline-block">
          Back to runs
        </Link>
      </div>
    );
  }

  if (!runA || !runB) {
    return (
      <div className="min-h-screen bg-slate-950 p-10 text-slate-300">
        <p>One or both runs were not found.</p>
        <Link href="/dashboard" className="text-indigo-400 mt-4 inline-block">
          Back to runs
        </Link>
      </div>
    );
  }

  const casesA = runA.cases ?? [];
  const casesB = runB.cases ?? [];
  const meanA = meanPerFieldScores(casesA);
  const meanB = meanPerFieldScores(casesB);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-6 lg:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-300">
          ← Runs
        </Link>

        <header>
          <h1 className="text-3xl font-light text-white">Compare runs</h1>
          <p className="text-slate-400 text-sm mt-2">
            Per-field mean scores across completed cases in each run. Positive delta means the first run scores higher on that field.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase text-slate-500">Run A</p>
            <p className="text-white font-medium mt-1">{runA.strategy}</p>
            <p className="text-slate-400 font-mono text-xs mt-1">{runA.model}</p>
            <p className="text-slate-500 text-xs mt-2">{casesA.length} cases in view</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase text-slate-500">Run B</p>
            <p className="text-white font-medium mt-1">{runB.strategy}</p>
            <p className="text-slate-400 font-mono text-xs mt-1">{runB.model}</p>
            <p className="text-slate-500 text-xs mt-2">{casesB.length} cases in view</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Field</th>
                <th className="px-4 py-3 font-medium">Run A</th>
                <th className="px-4 py-3 font-medium">Run B</th>
                <th className="px-4 py-3 font-medium">Δ (A − B)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {fields.map(({ key, label }) => {
                const a = meanA[key];
                const b = meanB[key];
                const d = a - b;
                const winner =
                  d > 0.001 ? "A" : d < -0.001 ? "B" : "tie";
                return (
                  <tr key={key} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-slate-200">{label}</td>
                    <td className="px-4 py-3 font-mono text-indigo-300">{a.toFixed(3)}</td>
                    <td className="px-4 py-3 font-mono text-violet-300">{b.toFixed(3)}</td>
                    <td className="px-4 py-3 font-mono">
                      <span
                        className={
                          winner === "A"
                            ? "text-emerald-400"
                            : winner === "B"
                              ? "text-rose-400"
                              : "text-slate-500"
                        }
                      >
                        {d >= 0 ? "+" : ""}
                        {d.toFixed(3)}
                      </span>
                      <span className="text-slate-600 text-xs ml-2">{winner}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
