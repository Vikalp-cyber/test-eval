"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { formatRunDuration, type RunStatus } from "@/lib/eval-api";
import { ApiKeyButton } from "@/components/api-key-button";

type Run = {
  id: string;
  strategy: string;
  model: string;
  status: RunStatus;
  meanAggregateF1: number | null;
  totalCost: number | null;
  createdAt: string;
  updatedAt: string;
  totalCases: number | null;
  completedCases: number | null;
};

export default function Dashboard({ runs }: { runs: Run[] }) {
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);

  const toggleRun = (id: string) => {
    setSelectedRuns((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-indigo-500/30">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-violet-600/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto p-6 lg:p-12 space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-light tracking-tight text-white mb-2">
              Evaluations
            </h1>
            <p className="text-slate-400 text-sm">
              Manage and analyze clinical extraction prompt strategies.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <ApiKeyButton />
            {selectedRuns.length === 2 && (
              <Link
                href={`/dashboard/compare?run1=${selectedRuns[0]}&run2=${selectedRuns[1]}`}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-full text-sm transition-all shadow-lg hover:shadow-indigo-500/20 hover:border-indigo-500/50"
              >
                Compare selected
              </Link>
            )}
            <Link
              href="/dashboard/new"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-all shadow-lg shadow-indigo-500/20"
            >
              Start new run
            </Link>
          </div>
        </header>

        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="text-xs uppercase bg-white/5 text-slate-400 border-b border-white/10">
              <tr>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Select
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Strategy
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Model
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  F1
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Cost
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Duration
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Age
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {runs.map((run) => {
                const total = run.totalCases ?? 0;
                const done = run.completedCases ?? 0;
                const pct = total > 0 ? (done / total) * 100 : 0;
                const statusClass =
                  run.status === "completed"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : run.status === "running"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-red-500/10 text-red-400 border border-red-500/20";
                return (
                  <tr
                    key={run.id}
                    className="hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedRuns.includes(run.id)}
                        onChange={() => toggleRun(run.id)}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-600 focus:ring-indigo-500/50 focus:ring-offset-slate-900"
                      />
                    </td>
                    <td className="px-6 py-4 font-medium text-white">
                      <Link
                        href={`/dashboard/runs/${run.id}`}
                        className="hover:text-indigo-400 transition-colors"
                      >
                        {run.strategy}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{run.model}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusClass}`}
                      >
                        {run.status === "running" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        )}
                        {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                      </span>
                      {run.status === "running" && total > 0 && (
                        <div className="mt-2 w-full max-w-[140px] bg-white/10 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {run.meanAggregateF1 != null ? (
                        <span className="font-mono text-indigo-300">
                          {run.meanAggregateF1.toFixed(3)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {run.totalCost != null ? (
                        <span className="font-mono text-emerald-300">
                          ${run.totalCost.toFixed(4)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-slate-400 whitespace-nowrap">
                      {formatRunDuration(run.createdAt, run.updatedAt, run.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                      {formatDistanceToNow(new Date(run.createdAt), {
                        addSuffix: true,
                      })}
                    </td>
                  </tr>
                );
              })}

              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-12 text-center text-slate-500"
                  >
                    No evaluation runs found. Start a new run to see metrics here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
