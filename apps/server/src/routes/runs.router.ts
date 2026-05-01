import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@test-evals/db";
import { runs, runCases } from "@test-evals/db/schema";
import { desc, eq, inArray, count as sqlCount } from "drizzle-orm";
import { runner, type RunnerProgress } from "../services/runner.service.js";
import {
  zeroShot,
  fewShot,
  cot as chainOfThought,
  type StrategyFn,
} from "@test-evals/llm";
import fs from "fs/promises";
import path from "path";
import { aggregateResults, type CaseEvaluation } from "../services/evaluate.service.js";

const router = new Hono();

const ROOT_DIR = path.resolve(process.cwd(), "../../");
const DATASET_DIR = path.join(ROOT_DIR, "data/transcripts");
const GOLD_DIR = path.join(ROOT_DIR, "data/gold");

const STRATEGIES: Record<string, StrategyFn> = {
  zero_shot: zeroShot,
  few_shot: fewShot,
  cot: chainOfThought,
};

const startRunSchema = z.object({
  strategy: z.enum(["zero_shot", "few_shot", "cot"]),
  model: z.string().default("claude-haiku-4-5-20251001"),
  force: z.boolean().default(false),
  limit: z.number().int().positive().optional(),
});

const compareQuerySchema = z.object({
  ids: z
    .string()
    .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(2).max(4)),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

async function getTranscriptIds(limit?: number): Promise<string[]> {
  const files = await fs.readdir(DATASET_DIR);
  const transcripts = files.filter((f) => f.endsWith(".txt")).sort();
  return typeof limit === "number" ? transcripts.slice(0, limit) : transcripts;
}

// ── GET /api/v1/runs ─────────────────────────────────────────────
router.get("/", zValidator("query", listQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const [items, total] = await Promise.all([
    db.query.runs.findMany({
      orderBy: [desc(runs.createdAt)],
      limit,
      offset,
    }),
    db.select({ count: sqlCount() }).from(runs),
  ]);
  return c.json({ items, total: total[0]?.count ?? 0, limit, offset });
});

// ── GET /api/v1/runs/compare ─────────────────────────────────────
// Note: defined BEFORE /:id so Hono routes correctly.
router.get("/compare", zValidator("query", compareQuerySchema), async (c) => {
  const { ids } = c.req.valid("query");
  const rows = await db.query.runs.findMany({
    where: inArray(runs.id, ids),
    with: { cases: true },
  });
  if (rows.length !== ids.length) {
    return c.json({ error: "One or more runs not found" }, 404);
  }

  const summary = rows.map((run) => {
    const cases = (run.cases ?? []).filter((c) => c.scores);
    const evalCases: CaseEvaluation[] = cases.map((c) => ({
      caseId: c.transcriptId,
      scores: c.scores as CaseEvaluation["scores"],
      aggregateF1: c.aggregateF1 ?? 0,
      aggregateScore: c.aggregateScore ?? c.aggregateF1 ?? 0,
      schemaValid: !!c.schemaValid,
      hallucination: {
        hallucinatedFields: (c.hallucinatedFields ?? []) as string[],
        hallucinationCount: c.hallucinationCount ?? 0,
        totalChecked: 0,
      },
    }));
    const agg = aggregateResults(evalCases);
    return {
      id: run.id,
      strategy: run.strategy,
      model: run.model,
      promptHash: run.promptHash,
      status: run.status,
      totalCases: run.totalCases,
      completedCases: run.completedCases,
      totalCost: run.totalCost,
      durationMs: run.durationMs,
      aggregates: agg,
    };
  });

  // Per-case parallel comparison (only transcripts present in ALL runs).
  const sets = summary.map(
    (s, i) =>
      new Set(
        (rows[i]!.cases ?? []).map((c) => c.transcriptId),
      ),
  );
  const intersect = [...sets[0]!].filter((id) => sets.every((s) => s.has(id))).sort();
  const perCase = intersect.map((transcriptId) => {
    const row: { transcriptId: string; runs: Record<string, number | null> } = {
      transcriptId,
      runs: {},
    };
    for (const run of rows) {
      const c = (run.cases ?? []).find((rc) => rc.transcriptId === transcriptId);
      row.runs[run.id] = c?.aggregateScore ?? c?.aggregateF1 ?? null;
    }
    return row;
  });

  return c.json({ runs: summary, perCase });
});

// ── GET /api/v1/runs/:id ─────────────────────────────────────────
router.get("/:id", async (c) => {
  const runId = c.req.param("id");
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: { cases: true },
  });
  if (!run) return c.json({ error: "Not found" }, 404);
  return c.json(run);
});

// ── POST /api/v1/runs ────────────────────────────────────────────
router.post("/", zValidator("json", startRunSchema), async (c) => {
  const { strategy, model, force, limit } = c.req.valid("json");

  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set on the server. Add it to apps/server/.env and restart the dev script.",
      },
      503,
    );
  }

  const strategyFn = STRATEGIES[strategy];
  if (!strategyFn) return c.json({ error: "Invalid strategy" }, 400);

  const transcriptIds = await getTranscriptIds(limit);
  const runId = await runner.startRun(
    strategyFn,
    model,
    transcriptIds,
    DATASET_DIR,
    GOLD_DIR,
    force,
  );
  return c.json({ runId, status: "started", total: transcriptIds.length }, 202);
});

// ── POST /api/v1/runs/:id/resume ─────────────────────────────────
router.post("/:id/resume", async (c) => {
  const runId = c.req.param("id");

  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set on the server. Add it to apps/server/.env and restart the dev script.",
      },
      503,
    );
  }

  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) return c.json({ error: "Not found" }, 404);
  if (run.status === "completed") {
    return c.json({ error: "Run is already completed" }, 400);
  }

  const strategyFn = STRATEGIES[run.strategy];
  if (!strategyFn) return c.json({ error: "Invalid strategy saved in run" }, 500);

  // Resume always uses the same transcript set the run was originally started with.
  // We persist totalCases so we know how many to enumerate.
  const transcriptIds = await getTranscriptIds(run.totalCases ?? undefined);
  await runner.startRun(
    strategyFn,
    run.model,
    transcriptIds,
    DATASET_DIR,
    GOLD_DIR,
    { force: false, existingRunId: runId },
  );
  return c.json({ runId, status: "resumed", total: transcriptIds.length }, 202);
});

// ── GET /api/v1/runs/:id/stream ──────────────────────────────────
router.get("/:id/stream", async (c) => {
  const runId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    const onAbort = new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true });
    });

    const listener = (progress: RunnerProgress) => {
      if (progress.runId !== runId) return;
      void stream.writeSSE({
        data: JSON.stringify(progress),
        event: "progress",
      });
    };
    runner.on("progress", listener);

    try {
      const existing = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
      if (existing) {
        await stream.writeSSE({
          data: JSON.stringify({
            runId,
            total: existing.totalCases ?? 0,
            completed: existing.completedCases ?? 0,
            status: existing.status,
          }),
          event: "progress",
        });
      }
      await onAbort;
    } finally {
      runner.off("progress", listener);
    }
  });
});

// ── DELETE /api/v1/runs/:id ──────────────────────────────────────
router.delete("/:id", async (c) => {
  const runId = c.req.param("id");
  await db.delete(runCases).where(eq(runCases.runId, runId));
  await db.delete(runs).where(eq(runs.id, runId));
  return c.json({ deleted: true });
});

export { router as runsRouter };
