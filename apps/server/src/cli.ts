import "./env-bootstrap.js";
import { parseArgs } from "util";
import { runner, type RunnerProgress } from "./services/runner.service.js";
import {
  zeroShot,
  fewShot,
  cot,
  type StrategyFn,
  computeCostUSD,
  isKnownModel,
} from "@test-evals/llm";
import fs from "fs/promises";
import path from "path";
import { db } from "@test-evals/db";
import { runs, runCases } from "@test-evals/db/schema";
import { eq } from "drizzle-orm";

const ROOT_DIR = path.resolve(process.cwd(), "../../");
const DATASET_DIR = path.join(ROOT_DIR, "data/transcripts");
const GOLD_DIR = path.join(ROOT_DIR, "data/gold");

const STRATEGIES: Record<string, StrategyFn> = {
  zero_shot: zeroShot,
  few_shot: fewShot,
  cot,
};

async function getTranscriptIds(limit?: number) {
  const files = await fs.readdir(DATASET_DIR);
  const all = files.filter((f) => f.endsWith(".txt")).sort();
  return typeof limit === "number" ? all.slice(0, limit) : all;
}

function drawProgressBar(completed: number, total: number, suffix = "") {
  const width = 40;
  const progress = total === 0 ? 0 : completed / total;
  const filled = Math.round(width * progress);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  process.stdout.write(`\r[${bar}] ${completed}/${total} ${suffix.padEnd(40, " ")}`);
}

function fmt(n: number | null | undefined, d = 3) {
  return n == null ? "—" : n.toFixed(d);
}

async function printSummary(runId: string) {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: { cases: true },
  });
  if (!run) return;

  const cases = run.cases ?? [];
  const halRate = cases.length === 0 ? 0 : (run.totalHallucinations ?? 0) / cases.length;
  const schemaRate = cases.length === 0 ? 0 : (run.totalSchemaFailures ?? 0) / cases.length;

  // Per-field means
  const acc = {
    chief_complaint: 0,
    vitals: 0,
    medications: 0,
    diagnoses: 0,
    plan: 0,
    follow_up: 0,
  };
  let scored = 0;
  for (const c of cases) {
    if (!c.scores) continue;
    const s = c.scores as {
      chief_complaint: number;
      vitals: { average: number };
      medications: { f1: number };
      diagnoses: { f1: number };
      plan: { f1: number };
      follow_up: { average: number };
    };
    acc.chief_complaint += s.chief_complaint;
    acc.vitals += s.vitals.average;
    acc.medications += s.medications.f1;
    acc.diagnoses += s.diagnoses.f1;
    acc.plan += s.plan.f1;
    acc.follow_up += s.follow_up.average;
    scored++;
  }
  const denom = Math.max(1, scored);

  console.log("\n=== Run Summary ===");
  console.table({
    "Run ID": run.id,
    Strategy: run.strategy,
    Model: run.model,
    "Prompt hash": (run.promptHash ?? "").slice(0, 12),
    Status: run.status,
    "Cases (done/total)": `${run.completedCases}/${run.totalCases}`,
    "Aggregate F1": fmt(run.meanAggregateF1),
    "Aggregate score (penalised)": fmt(run.meanAggregateScore),
    "Hallucinations / case": fmt(halRate, 2),
    "Schema-invalid rate": fmt(schemaRate, 2),
    "Tokens (in/out)": `${run.inputTokens}/${run.outputTokens}`,
    "Cache (read/write)": `${run.cacheReadTokens}/${run.cacheWriteTokens}`,
    "Cost (USD)": run.totalCost != null ? `$${run.totalCost.toFixed(4)}` : "—",
    Duration: run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—",
  });

  console.log("\n=== Per-field means ===");
  console.table({
    "chief_complaint": fmt(acc.chief_complaint / denom),
    "vitals": fmt(acc.vitals / denom),
    "medications F1": fmt(acc.medications / denom),
    "diagnoses F1": fmt(acc.diagnoses / denom),
    "plan F1": fmt(acc.plan / denom),
    "follow_up": fmt(acc.follow_up / denom),
  });

  // Estimated cost from token totals (sanity-cross-check with stored value).
  if (run.inputTokens != null && run.outputTokens != null) {
    const recomputed = computeCostUSD(
      {
        input: run.inputTokens,
        output: run.outputTokens,
        cache_read: run.cacheReadTokens ?? 0,
        cache_write: run.cacheWriteTokens ?? 0,
      },
      run.model,
    );
    if (Math.abs(recomputed - (run.totalCost ?? 0)) > 0.0005) {
      console.warn(
        `\n[warn] stored cost $${run.totalCost?.toFixed(4)} disagrees with recompute $${recomputed.toFixed(4)} for model ${run.model}.`,
      );
    }
    if (!isKnownModel(run.model)) {
      console.warn(
        `[warn] model "${run.model}" is not in the pricing table; cost is approximate.`,
      );
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      strategy: { type: "string", short: "s", default: "zero_shot" },
      model: { type: "string", short: "m", default: "claude-haiku-4-5-20251001" },
      limit: { type: "string", short: "l" },
      force: { type: "boolean", short: "f", default: false },
      resume: { type: "string", short: "r" },
    },
  });

  console.log("HEALOSBENCH CLI Runner");
  console.log("======================");

  let runId: string;
  let strategyFn: StrategyFn;
  let model: string;
  let transcriptIds: string[];

  if (values.resume) {
    const existing = await db.query.runs.findFirst({ where: eq(runs.id, values.resume) });
    if (!existing) {
      console.error("Run not found.");
      process.exit(1);
    }
    if (existing.status === "completed") {
      console.error("Run already completed.");
      await printSummary(existing.id);
      process.exit(0);
    }
    const strat = STRATEGIES[existing.strategy];
    if (!strat) {
      console.error("Unknown strategy saved in run:", existing.strategy);
      process.exit(1);
    }
    strategyFn = strat;
    model = existing.model;
    transcriptIds = await getTranscriptIds(existing.totalCases ?? undefined);

    const done = await db.query.runCases.findMany({ where: eq(runCases.runId, existing.id) });
    console.log(`Resuming run ${existing.id}: ${done.length}/${transcriptIds.length} cases done`);

    runId = await runner.startRun(strategyFn, model, transcriptIds, DATASET_DIR, GOLD_DIR, {
      force: false,
      existingRunId: existing.id,
    });
  } else {
    const strat = STRATEGIES[values.strategy!];
    if (!strat) {
      console.error("Unknown strategy:", values.strategy);
      console.error("Available:", Object.keys(STRATEGIES).join(", "));
      process.exit(1);
    }
    strategyFn = strat;
    model = values.model!;
    const limit = values.limit ? parseInt(values.limit, 10) : undefined;
    transcriptIds = await getTranscriptIds(limit);

    console.log(`Starting new run...`);
    console.log(`Strategy: ${values.strategy}`);
    console.log(`Model:    ${model}`);
    console.log(`Cases:    ${transcriptIds.length}`);
    if (!isKnownModel(model)) {
      console.warn(
        `[warn] model "${model}" is not in the pricing table; cost will be approximate.`,
      );
    }

    runId = await runner.startRun(
      strategyFn,
      model,
      transcriptIds,
      DATASET_DIR,
      GOLD_DIR,
      values.force,
    );
  }

  console.log(`\nRun ID: ${runId}\n`);
  drawProgressBar(0, transcriptIds.length);

  return new Promise<void>((resolve, reject) => {
    const onProgress = async (progress: RunnerProgress) => {
      if (progress.runId !== runId) return;
      drawProgressBar(progress.completed, progress.total, progress.currentCase ?? "");

      if (progress.status === "completed") {
        runner.off("progress", onProgress);
        console.log("\n");
        await printSummary(runId);
        resolve();
      } else if (progress.status === "failed") {
        runner.off("progress", onProgress);
        console.error(`\n\nRun failed: ${progress.error}`);
        reject(new Error(progress.error ?? "run failed"));
      }
    };
    runner.on("progress", onProgress);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
