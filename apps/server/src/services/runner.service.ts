import {
  Extractor,
  type StrategyFn,
  type AttemptTrace,
  hashStrategyConfig,
  computeCostUSD,
} from "@test-evals/llm";
import { evaluateCase, type CaseEvaluation } from "./evaluate.service.js";
import { db } from "@test-evals/db";
import { runs, runCases } from "@test-evals/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { EventEmitter } from "events";

export interface RunnerProgress {
  runId: string;
  total: number;
  completed: number;
  currentCase?: string;
  status: "running" | "completed" | "failed";
  error?: string;
}

export interface StartRunOptions {
  force?: boolean;
  existingRunId?: string;
  /** Optional abort signal — letting the API kill in-flight runs cleanly. */
  signal?: AbortSignal;
}

export class RunManager extends EventEmitter {
  private extractor = new Extractor();

  // Concurrency
  private maxConcurrent = 5;
  private activeCount = 0;
  private queue: Array<() => void> = [];

  // Rate-limit gate (token-bucket-lite: hold all callers until nextAllowedTime).
  private nextAllowedTime = 0;

  // Per-run lock: prevent overlapping processRun() for the same runId
  // (e.g. /resume hit while still running).
  private runLocks = new Set<string>();

  constructor() {
    super();
    // 1 listener per active SSE stream is normal — bump default of 10.
    this.setMaxListeners(64);
  }

  private async acquireToken(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    if (now < this.nextAllowedTime) {
      await sleep(this.nextAllowedTime - now, signal);
    }
    if (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
  }

  private releaseToken(retryAfterMs?: number) {
    this.activeCount--;
    if (retryAfterMs && retryAfterMs > 0) {
      this.nextAllowedTime = Math.max(this.nextAllowedTime, Date.now() + retryAfterMs);
    }
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Kick off (or resume) a run. Returns immediately with the run id; processing
   * happens in the background. Re-entry for the same runId is a no-op.
   */
  async startRun(
    strategyFn: StrategyFn,
    model: string,
    transcriptIds: string[],
    datasetDir: string,
    goldDir: string,
    forceOrOpts: boolean | StartRunOptions = false,
    existingRunId?: string,
  ): Promise<string> {
    const opts: StartRunOptions =
      typeof forceOrOpts === "boolean"
        ? { force: forceOrOpts, existingRunId }
        : forceOrOpts;

    const runId = opts.existingRunId ?? randomUUID();

    // Compute prompt hash from a placeholder transcript — strategy hashing
    // intentionally ignores transcript text (only system prompt + few-shots).
    const sampleStrategy = strategyFn("");
    const promptHash = hashStrategyConfig(sampleStrategy);

    if (!opts.existingRunId) {
      await db.insert(runs).values({
        id: runId,
        strategy: sampleStrategy.name,
        model,
        promptHash,
        status: "running",
        totalCases: transcriptIds.length,
      });
    } else {
      await db
        .update(runs)
        .set({ status: "running", error: null, updatedAt: new Date() })
        .where(eq(runs.id, runId));
    }

    if (this.runLocks.has(runId)) {
      // A worker is already processing this run; nothing to do.
      return runId;
    }
    this.runLocks.add(runId);

    void this.processRun({
      runId,
      strategyFn,
      model,
      promptHash,
      transcriptIds,
      datasetDir,
      goldDir,
      force: !!opts.force,
      signal: opts.signal,
    })
      .catch(async (e) => {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Run ${runId} failed:`, e);
        await db
          .update(runs)
          .set({ status: "failed", error: message, updatedAt: new Date() })
          .where(eq(runs.id, runId));
        this.emit("progress", {
          runId,
          total: transcriptIds.length,
          completed: 0,
          status: "failed",
          error: message,
        });
      })
      .finally(() => {
        this.runLocks.delete(runId);
      });

    return runId;
  }

  private async processRun(params: {
    runId: string;
    strategyFn: StrategyFn;
    model: string;
    promptHash: string;
    transcriptIds: string[];
    datasetDir: string;
    goldDir: string;
    force: boolean;
    signal?: AbortSignal;
  }) {
    const {
      runId,
      strategyFn,
      model,
      promptHash,
      transcriptIds,
      datasetDir,
      goldDir,
      force,
      signal,
    } = params;
    const startedAt = Date.now();

    const existingCases = await db.query.runCases.findMany({
      where: eq(runCases.runId, runId),
    });
    const completedTranscriptIds = new Set(existingCases.map((c) => c.transcriptId));
    const toProcess = transcriptIds.filter((id) => !completedTranscriptIds.has(id));

    // Atomic completed counter — never read-modified outside this closure
    // and only incremented on successful save. Avoids the race we had before.
    let completedCount = existingCases.length;
    const total = transcriptIds.length;
    const emitProgress = (currentCase?: string) =>
      this.emit("progress", {
        runId,
        total,
        completed: completedCount,
        currentCase,
        status: "running",
      } satisfies RunnerProgress);

    emitProgress();

    await Promise.allSettled(
      toProcess.map(async (transcriptId) => {
        if (signal?.aborted) return;

        await this.acquireToken(signal);
        let backoff = 0;
        const caseStartedAt = Date.now();
        try {
          emitProgress(transcriptId);

          const transcript = await fs.readFile(
            path.join(datasetDir, transcriptId),
            "utf-8",
          );
          const gold = JSON.parse(
            await fs.readFile(
              path.join(goldDir, transcriptId.replace(".txt", ".json")),
              "utf-8",
            ),
          );

          const strategy = strategyFn(transcript);

          const idem = !force ? await findIdempotentResult({
            strategyName: strategy.name,
            promptHash,
            model,
            transcriptId,
          }) : null;

          let extractionData: unknown;
          let schemaValid = false;
          let attempts: AttemptTrace[] = [];
          let tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
          let fromCache = false;
          let caseError: string | null = null;

          if (idem) {
            extractionData = idem.predicted;
            schemaValid = idem.schemaValid ?? false;
            attempts = (idem.attempts ?? []) as AttemptTrace[];
            tokens = {
              input: idem.inputTokens ?? 0,
              output: idem.outputTokens ?? 0,
              cache_read: 0,
              cache_write: 0,
            };
            fromCache = true;
          } else {
            // Inner retry loop just for 429s — the extractor handles
            // schema-validation retries internally.
            // eslint-disable-next-line no-constant-condition
            while (true) {
              if (signal?.aborted) return;
              try {
                const result = await this.extractor.extract(transcript, strategy, {
                  model,
                  signal,
                });
                extractionData = result.data;
                schemaValid = result.success;
                attempts = result.attempts;
                tokens = result.tokens;
                break;
              } catch (e: unknown) {
                const status = (e as { status?: number }).status;
                if (status === 429) {
                  const headers = (e as { headers?: Record<string, string> }).headers ?? {};
                  const retryAfterSec = parseInt(headers["retry-after"] ?? "5", 10);
                  backoff = Math.max(1000, retryAfterSec * 1000);
                  console.warn(
                    `Rate limited on ${transcriptId}, backing off ${backoff}ms`,
                  );
                  await sleep(backoff, signal);
                  continue;
                }
                caseError = e instanceof Error ? e.message : String(e);
                break;
              }
            }
          }

          // Record failed extraction attempts as explicit case rows so the UI
          // never shows a misleading 0/N with no diagnostics.
          if (extractionData == null) {
            await db
              .insert(runCases)
              .values({
                id: randomUUID(),
                runId,
                transcriptId,
                predicted: null,
                gold,
                attempts,
                attemptCount: attempts.length,
                schemaValid: false,
                aggregateF1: 0,
                aggregateScore: 0,
                scores: null,
                hallucinatedFields: [],
                hallucinationCount: 0,
                inputTokens: tokens.input,
                outputTokens: tokens.output,
                cacheReadTokens: tokens.cache_read,
                cacheWriteTokens: tokens.cache_write,
                fromCache,
                error: caseError ?? "Extraction failed: no structured output produced",
                durationMs: Date.now() - caseStartedAt,
              })
              .onConflictDoNothing();

            completedCount++;
            emitProgress();
            return;
          }

          const evaluation = evaluateCase(
            transcriptId,
            (extractionData ?? {}) as Parameters<typeof evaluateCase>[1],
            gold,
            transcript,
            schemaValid,
          );

          await db
            .insert(runCases)
            .values({
              id: randomUUID(),
              runId,
              transcriptId,
              predicted: extractionData ?? null,
              gold,
              attempts,
              attemptCount: attempts.length,
              schemaValid,
              aggregateF1: evaluation.aggregateF1,
              aggregateScore: evaluation.aggregateScore,
              scores: evaluation.scores,
              hallucinatedFields: evaluation.hallucination.hallucinatedFields,
              hallucinationCount: evaluation.hallucination.hallucinationCount,
              inputTokens: tokens.input,
              outputTokens: tokens.output,
              cacheReadTokens: tokens.cache_read,
              cacheWriteTokens: tokens.cache_write,
              fromCache,
              error: caseError,
              durationMs: Date.now() - caseStartedAt,
            })
            .onConflictDoNothing();

          completedCount++;
          emitProgress();
        } catch (e: unknown) {
          console.error(`Error processing ${transcriptId}:`, e);
        } finally {
          this.releaseToken(backoff);
        }
      }),
    );

    await this.finalizeRun(runId, total, model, completedCount, Date.now() - startedAt);
  }

  private async finalizeRun(
    runId: string,
    total: number,
    model: string,
    completedCount: number,
    durationMs: number,
  ) {
    const allCases = await db.query.runCases.findMany({
      where: eq(runCases.runId, runId),
    });

    const evalCases: CaseEvaluation[] = allCases.map((c) => ({
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

    const { aggregateResults } = await import("./evaluate.service.js");
    const agg = aggregateResults(evalCases);

    let totalInput = 0;
    let totalOutput = 0;
    let totalRead = 0;
    let totalWrite = 0;
    for (const c of allCases) {
      totalInput += c.inputTokens ?? 0;
      totalOutput += c.outputTokens ?? 0;
      totalRead += c.cacheReadTokens ?? 0;
      totalWrite += c.cacheWriteTokens ?? 0;
    }
    const cost = computeCostUSD(
      {
        input: totalInput,
        output: totalOutput,
        cache_read: totalRead,
        cache_write: totalWrite,
      },
      model,
    );

    // A "successful" case has both schema validity AND a non-null prediction.
    // Anything else (model error, all-attempts-invalid) was inserted as a
    // diagnostic row by the per-case fallback path.
    const successfulCount = allCases.filter(
      (c) => c.schemaValid && c.predicted != null,
    ).length;
    const failedCases = allCases.filter(
      (c) => !c.schemaValid || c.predicted == null,
    );

    let nextStatus: "completed" | "failed" = "completed";
    let runError: string | null = null;
    if (total > 0 && successfulCount === 0) {
      nextStatus = "failed";
      // Use the most common per-case error so the dashboard shows something
      // actionable (e.g. "401 Incorrect API key").
      const counts = new Map<string, number>();
      for (const c of failedCases) {
        const key = c.error ?? "Extraction failed (no detail recorded)";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let topMsg = "All cases failed to produce a valid extraction.";
      let topCount = 0;
      for (const [msg, n] of counts) {
        if (n > topCount) {
          topMsg = msg;
          topCount = n;
        }
      }
      runError = `${topMsg} (${topCount}/${total} cases)`;
    }

    await db
      .update(runs)
      .set({
        status: nextStatus,
        error: runError,
        completedCases: completedCount,
        meanAggregateF1: agg.meanAggregateF1,
        meanAggregateScore: agg.meanAggregateScore,
        totalHallucinations: agg.totalHallucinations,
        totalSchemaFailures: agg.totalSchemaFailures,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheReadTokens: totalRead,
        cacheWriteTokens: totalWrite,
        totalCost: cost,
        durationMs,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId));

    this.emit("progress", {
      runId,
      total,
      completed: completedCount,
      status: nextStatus,
      error: runError ?? undefined,
    } satisfies RunnerProgress);
  }
}

async function findIdempotentResult(opts: {
  strategyName: string;
  promptHash: string;
  model: string;
  transcriptId: string;
}) {
  // Prefer matches on EXACT promptHash. Fall back to (strategy + model) for
  // legacy completed runs that predate the prompt_hash column.
  const rowsByHash = await db
    .select({
      predicted: runCases.predicted,
      schemaValid: runCases.schemaValid,
      attempts: runCases.attempts,
      inputTokens: runCases.inputTokens,
      outputTokens: runCases.outputTokens,
    })
    .from(runCases)
    .innerJoin(runs, eq(runs.id, runCases.runId))
    .where(
      and(
        eq(runs.promptHash, opts.promptHash),
        eq(runs.model, opts.model),
        eq(runs.status, "completed"),
        eq(runCases.transcriptId, opts.transcriptId),
        eq(runCases.schemaValid, true),
        sql`${runCases.predicted} IS NOT NULL`,
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (rowsByHash.length > 0) return rowsByHash[0]!;

  const fallback = await db
    .select({
      predicted: runCases.predicted,
      schemaValid: runCases.schemaValid,
      attempts: runCases.attempts,
      inputTokens: runCases.inputTokens,
      outputTokens: runCases.outputTokens,
    })
    .from(runCases)
    .innerJoin(runs, eq(runs.id, runCases.runId))
    .where(
      and(
        eq(runs.strategy, opts.strategyName),
        eq(runs.model, opts.model),
        eq(runs.status, "completed"),
        eq(runCases.transcriptId, opts.transcriptId),
        eq(runCases.schemaValid, true),
        sql`${runCases.predicted} IS NOT NULL`,
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);

  return fallback[0] ?? null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const runner = new RunManager();
