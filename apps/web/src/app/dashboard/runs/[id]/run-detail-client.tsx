"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { env } from "@test-evals/env/web";
import {
  type ApiRun,
  type ApiRunCase,
  fetchRun,
  fetchTranscript,
  formatRunDuration,
} from "@/lib/eval-api";

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      out.push(cur);
    }
  }
  return out;
}

function collectGroundedSpans(
  transcript: string,
  prediction: Record<string, unknown> | null,
  hallucinatedFields: string[] | null
): [number, number][] {
  if (!prediction || !transcript) return [];
  const hal = new Set(hallucinatedFields ?? []);
  const spans: [number, number][] = [];
  const lowerT = transcript.toLowerCase();

  const trySpan = (field: string, phrase: string | null | undefined) => {
    if (!phrase || phrase.length < 2 || hal.has(field)) return;
    const q = phrase.trim();
    if (q.length < 2) return;
    const idx = lowerT.indexOf(q.toLowerCase());
    if (idx >= 0) spans.push([idx, idx + q.length]);
  };

  trySpan("chief_complaint", prediction.chief_complaint as string);

  const vitals = prediction.vitals as Record<string, unknown> | undefined;
  if (vitals?.bp) trySpan("vitals.bp", String(vitals.bp));

  const meds = prediction.medications as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(meds)) {
    meds.forEach((med, i) => {
      trySpan(`medications[${i}].name`, med.name as string);
      trySpan(`medications[${i}].dose`, med.dose as string);
    });
  }

  const diags = prediction.diagnoses as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(diags)) {
    diags.forEach((d, i) => {
      trySpan(`diagnoses[${i}].description`, d.description as string);
    });
  }

  const plan = prediction.plan as string[] | undefined;
  if (Array.isArray(plan)) {
    plan.forEach((p, i) => trySpan(`plan[${i}]`, p));
  }

  const fu = prediction.follow_up as Record<string, unknown> | undefined;
  if (fu?.reason) trySpan("follow_up.reason", String(fu.reason));

  return mergeIntervals(spans);
}

function flattenLeaves(obj: unknown, prefix = ""): Map<string, string> {
  const m = new Map<string, string>();
  if (obj === null || obj === undefined) {
    m.set(prefix || "(root)", String(obj));
    return m;
  }
  if (typeof obj !== "object") {
    m.set(prefix || "(root)", JSON.stringify(obj));
    return m;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) m.set(prefix || "(root)", "[]");
    obj.forEach((item, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
      const inner = flattenLeaves(item, p);
      inner.forEach((v, k) => m.set(k, v));
    });
    return m;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      const inner = flattenLeaves(v, p);
      inner.forEach((val, key) => m.set(key, val));
    } else {
      m.set(p, JSON.stringify(v));
    }
  }
  return m;
}

function fieldDiffRows(pred: unknown, gold: unknown) {
  const a = flattenLeaves(pred);
  const b = flattenLeaves(gold);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  return keys.map((path) => ({
    path,
    pred: a.get(path) ?? "—",
    gold: b.get(path) ?? "—",
    same: (a.get(path) ?? "") === (b.get(path) ?? ""),
  }));
}

function TranscriptPane({
  transcript,
  spans,
}: {
  transcript: string;
  spans: [number, number][];
}) {
  if (!transcript) return <p className="text-slate-500">No transcript.</p>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const [a, b] of spans) {
    if (a > last) {
      parts.push(
        <span key={`t${k++}`} className="text-slate-200">
          {transcript.slice(last, a)}
        </span>
      );
    }
    parts.push(
      <mark
        key={`m${k++}`}
        className="bg-emerald-500/20 text-emerald-100 rounded px-0.5"
      >
        {transcript.slice(a, b)}
      </mark>
    );
    last = b;
  }
  if (last < transcript.length) {
    parts.push(
      <span key={`t${k++}`} className="text-slate-200">
        {transcript.slice(last)}
      </span>
    );
  }
  return (
    <div className="max-h-[min(70vh,520px)] overflow-y-auto rounded-xl border border-white/10 bg-slate-950/80 p-4 font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
      {parts.length ? (
      parts
    ) : (
      <span className="text-slate-200">{transcript}</span>
    )}
    </div>
  );
}

function CaseModal({
  c,
  onClose,
}: {
  c: ApiRunCase;
  onClose: () => void;
}) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTranscript(null);
    setErr(null);
    fetchTranscript(c.transcriptId)
      .then((t) => {
        if (!cancelled) setTranscript(t);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [c.transcriptId]);

  const predObj =
    c.predicted && typeof c.predicted === "object"
      ? (c.predicted as Record<string, unknown>)
      : null;
  const spans = useMemo(
    () =>
      transcript && predObj
        ? collectGroundedSpans(transcript, predObj, c.hallucinatedFields)
        : [],
    [transcript, predObj, c.hallucinatedFields]
  );

  const rows = useMemo(
    () => fieldDiffRows(c.predicted, c.gold),
    [c.predicted, c.gold]
  );

  const attempts = Array.isArray(c.attempts) ? c.attempts : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="case-modal-title"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="case-modal-title" className="text-lg font-medium text-white">
              {c.transcriptId}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Aggregate F1 {(c.aggregateF1 ?? 0).toFixed(3)} · Schema{" "}
              {c.schemaValid ? "valid" : "invalid"} · Hallucinations{" "}
              {c.hallucinationCount ?? 0}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(92vh-5rem)] overflow-y-auto p-5 space-y-6">
          {c.error && (
            <section>
              <h3 className="text-xs uppercase tracking-wider text-red-400 mb-2">
                Case error
              </h3>
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100 whitespace-pre-wrap break-words">
                {c.error}
              </div>
            </section>
          )}
          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Transcript (grounded spans highlighted)
            </h3>
            {err && <p className="text-red-400 text-sm">{err}</p>}
            {!err && transcript === null && (
              <p className="text-slate-500 text-sm">Loading transcript…</p>
            )}
            {transcript !== null && (
              <TranscriptPane transcript={transcript} spans={spans} />
            )}
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Field-level diff (predicted vs gold)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/5 text-slate-400 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 font-medium">Path</th>
                    <th className="px-3 py-2 font-medium">Predicted</th>
                    <th className="px-3 py-2 font-medium">Gold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono text-slate-300">
                  {rows.map((r) => (
                    <tr
                      key={r.path}
                      className={r.same ? "opacity-60" : "bg-amber-500/5"}
                    >
                      <td className="px-3 py-1.5 align-top text-indigo-300 whitespace-nowrap">
                        {r.path}
                      </td>
                      <td className="px-3 py-1.5 align-top break-all max-w-[200px]">
                        {r.pred}
                      </td>
                      <td className="px-3 py-1.5 align-top break-all max-w-[200px]">
                        {r.gold}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              LLM trace
            </h3>
            <div className="space-y-2">
              {attempts.length === 0 && (
                <p className="text-slate-500 text-sm">No attempt log stored.</p>
              )}
              {attempts.map((att, i) => (
                <details
                  key={i}
                  className="rounded-xl border border-white/10 bg-slate-950/50 open:bg-slate-950/80"
                >
                  <summary className="cursor-pointer px-4 py-3 text-sm text-slate-200 hover:text-white">
                    Attempt {i + 1}
                    {typeof att === "object" &&
                      att !== null &&
                      "usage" in att &&
                      typeof (att as { usage?: unknown }).usage === "object" &&
                      (att as { usage: Record<string, number> }).usage && (
                        <span className="ml-2 font-mono text-xs text-slate-500">
                          in{" "}
                          {(att as { usage: { input_tokens?: number } }).usage
                            .input_tokens ?? "?"}{" "}
                          · out{" "}
                          {(att as { usage: { output_tokens?: number } }).usage
                            .output_tokens ?? "?"}{" "}
                          · cache read{" "}
                          {(
                            att as {
                              usage: { cache_read_input_tokens?: number };
                            }
                          ).usage.cache_read_input_tokens ?? 0}
                        </span>
                      )}
                  </summary>
                  <pre className="max-h-72 overflow-auto border-t border-white/5 p-3 text-[10px] leading-relaxed text-slate-400">
                    {JSON.stringify(
                      att,
                      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
                      2
                    )}
                  </pre>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function RunDetailClient({ initialRun }: { initialRun: ApiRun }) {
  const [run, setRun] = useState<ApiRun>(initialRun);
  const [modalCase, setModalCase] = useState<ApiRunCase | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchRun(initialRun.id);
    if (next) setRun(next);
  }, [initialRun.id]);

  useEffect(() => {
    if (run.status !== "running") return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [run.status, refresh]);

  const cases = run.cases ?? [];
  const sortedCases = [...cases].sort((a, b) =>
    a.transcriptId.localeCompare(b.transcriptId)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/15 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto p-6 lg:p-10 space-y-8">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link
            href="/dashboard"
            className="text-slate-400 hover:text-white transition-colors"
          >
            ← Runs
          </Link>
          {run.status === "running" && (
            <span className="text-amber-400/90 text-xs">
              Updating every few seconds…
            </span>
          )}
        </div>

        <header className="space-y-2">
          <h1 className="text-3xl font-light text-white tracking-tight">
            {run.strategy}
          </h1>
          <p className="text-slate-400 text-sm">
            {run.model} · {run.status} ·{" "}
            {formatRunDuration(run.createdAt, run.updatedAt, run.status)} ·{" "}
            {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
          </p>
          <div className="flex flex-wrap gap-6 pt-2 text-sm">
            <div>
              <span className="text-slate-500">Mean F1 </span>
              <span className="font-mono text-indigo-300">
                {run.meanAggregateF1 != null
                  ? run.meanAggregateF1.toFixed(3)
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Cost </span>
              <span className="font-mono text-emerald-300">
                {run.totalCost != null ? `$${run.totalCost.toFixed(4)}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Cases </span>
              <span className="font-mono text-slate-300">
                {run.completedCases ?? 0}/{run.totalCases ?? 0}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Cache read tok </span>
              <span className="font-mono text-slate-300">
                {run.cacheReadTokens ?? 0}
              </span>
            </div>
          </div>
          {run.error && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <div className="font-medium text-red-100">Run error</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-red-200/90">
                {run.error}
              </div>
              {run.error.toLowerCase().includes("anthropic_api_key") && (
                <ol className="mt-2 list-decimal pl-5 text-xs text-red-200/80 space-y-1">
                  <li>
                    Open <span className="font-mono">apps/server/.env</span> and set{" "}
                    <span className="font-mono">ANTHROPIC_API_KEY=sk-ant-…</span>
                  </li>
                  <li>
                    Restart <span className="font-mono">.\scripts\dev.ps1</span>
                  </li>
                  <li>Try the run again from the dashboard</li>
                </ol>
              )}
            </div>
          )}
          {run.status === "failed" && (
            <div className="pt-2">
              <ResumeButton runId={run.id} onResumed={refresh} label="Resume run" />
            </div>
          )}
        </header>

        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="text-xs uppercase bg-white/5 text-slate-400 border-b border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">Case</th>
                <th className="px-4 py-3 font-medium">F1</th>
                <th className="px-4 py-3 font-medium">Halluc.</th>
                <th className="px-4 py-3 font-medium">Schema</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sortedCases.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.02] align-top">
                  <td className="px-4 py-3 font-mono text-xs text-white">
                    {c.transcriptId}
                    {c.error && (
                      <div
                        className="mt-1 max-w-[26rem] truncate text-[11px] text-red-300"
                        title={c.error}
                      >
                        {c.error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-indigo-300">
                    {(c.aggregateF1 ?? 0).toFixed(3)}
                  </td>
                  <td className="px-4 py-3">{c.hallucinationCount ?? 0}</td>
                  <td className="px-4 py-3">
                    {c.schemaValid ? (
                      <span className="text-emerald-400">ok</span>
                    ) : (
                      <span className="text-amber-400">invalid</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setModalCase(c)}
                      className="text-indigo-400 hover:text-indigo-300 text-xs font-medium"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {sortedCases.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    No cases recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalCase && (
        <CaseModal c={modalCase} onClose={() => setModalCase(null)} />
      )}
    </div>
  );
}

function ResumeButton({
  runId,
  onResumed,
  label = "Resume",
}: {
  runId: string;
  onResumed: () => void;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const base = env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");
          const res = await fetch(`${base}/api/v1/runs/${runId}/resume`, {
            method: "POST",
          });
          if (!res.ok) throw new Error(await res.text());
          await onResumed();
        } catch (e) {
          console.error(e);
        } finally {
          setPending(false);
        }
      }}
      className="rounded-full border border-indigo-500/40 bg-indigo-600/20 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-600/30 disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}
