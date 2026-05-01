import { env } from "@test-evals/env/web";

const base = () => env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");

export type RunStatus = "running" | "completed" | "failed";

export type ApiRun = {
  id: string;
  strategy: string;
  model: string;
  status: RunStatus;
  meanAggregateF1: number | null;
  totalHallucinations: number | null;
  totalSchemaFailures: number | null;
  totalCases: number | null;
  completedCases: number | null;
  totalCost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  cases?: ApiRunCase[];
};

export type ApiRunCase = {
  id: string;
  runId: string;
  transcriptId: string;
  predicted: unknown;
  gold: unknown;
  attempts: unknown[] | null;
  schemaValid: boolean | null;
  aggregateF1: number | null;
  scores: CaseScores | null;
  hallucinatedFields: string[] | null;
  hallucinationCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  error: string | null;
  attemptCount: number | null;
  createdAt: string;
};

export type CaseScores = {
  chief_complaint: number;
  vitals: { bp: number; hr: number; temp_f: number; spo2: number; average: number };
  medications: { precision: number; recall: number; f1: number };
  diagnoses: { precision: number; recall: number; f1: number; icd10Bonus?: number };
  plan: { precision: number; recall: number; f1: number };
  follow_up: { intervalDays?: number; reason: number; average: number };
};

export async function fetchRunsList(): Promise<ApiRun[]> {
  const res = await fetch(`${base()}/api/v1/runs`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load runs: ${res.status}`);

  const data = await res.json();
  if (Array.isArray(data)) {
    return data as ApiRun[];
  }
  if (data && Array.isArray((data as { items?: unknown[] }).items)) {
    return (data as { items: ApiRun[] }).items;
  }
  return [];
}

export async function fetchRun(id: string): Promise<ApiRun | null> {
  const res = await fetch(`${base()}/api/v1/runs/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load run: ${res.status}`);
  return res.json();
}

export async function fetchTranscript(transcriptId: string): Promise<string> {
  const enc = encodeURIComponent(transcriptId);
  const res = await fetch(`${base()}/api/v1/transcripts/${enc}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Transcript not found: ${transcriptId}`);
  const data = (await res.json()) as { text: string };
  return data.text;
}

export function formatRunDuration(
  createdAt: string,
  updatedAt: string,
  status: RunStatus
): string {
  const start = new Date(createdAt).getTime();
  const end = status === "running" ? Date.now() : new Date(updatedAt).getTime();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s < 10 ? "0" : ""}${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

export function meanPerFieldScores(cases: ApiRunCase[]) {
  const scored = cases.filter((c) => c.scores);
  const n = scored.length;
  if (!n) {
    return {
      chief_complaint: 0,
      vitals: 0,
      medications_f1: 0,
      diagnoses_f1: 0,
      plan_f1: 0,
      follow_up: 0,
      aggregateF1: 0,
    };
  }
  let chief = 0,
    vitals = 0,
    med = 0,
    diag = 0,
    plan = 0,
    fu = 0,
    agg = 0;
  for (const c of scored) {
    const s = c.scores!;
    chief += s.chief_complaint;
    vitals += s.vitals.average;
    med += s.medications.f1;
    diag += s.diagnoses.f1;
    plan += s.plan.f1;
    fu += s.follow_up.average;
    agg += c.aggregateF1 ?? 0;
  }
  return {
    chief_complaint: chief / n,
    vitals: vitals / n,
    medications_f1: med / n,
    diagnoses_f1: diag / n,
    plan_f1: plan / n,
    follow_up: fu / n,
    aggregateF1: agg / n,
  };
}
