import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    /** Stable hash of the strategy config (system + few-shots). Used for idempotency. */
    promptHash: text("prompt_hash"),
    status: text("status").notNull(), // 'running' | 'completed' | 'failed'

    // Aggregated metrics
    meanAggregateF1: real("mean_aggregate_f1"),
    /** Aggregate score after hallucination + schema penalties (∈ [0,1]). */
    meanAggregateScore: real("mean_aggregate_score"),
    totalHallucinations: integer("total_hallucinations"),
    totalSchemaFailures: integer("total_schema_failures"),
    totalCases: integer("total_cases").default(0),
    completedCases: integer("completed_cases").default(0),

    // Cost & Tokens
    totalCost: real("total_cost").default(0),
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    cacheReadTokens: integer("cache_read_tokens").default(0),
    cacheWriteTokens: integer("cache_write_tokens").default(0),

    // Failure surfaces
    error: text("error"),
    durationMs: integer("duration_ms"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    byStrategyModel: index("runs_strategy_model_idx").on(t.strategy, t.model),
    byPromptHash: index("runs_prompt_hash_idx").on(t.promptHash),
    byCreatedAt: index("runs_created_at_idx").on(t.createdAt),
  }),
);

export const runCases = pgTable(
  "run_cases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),

    predicted: jsonb("predicted"),
    gold: jsonb("gold"),
    /** Slim AttemptTrace[] from the extractor — not raw SDK envelopes. */
    attempts: jsonb("attempts"),
    attemptCount: integer("attempt_count").default(0),
    schemaValid: boolean("schema_valid").default(true),

    aggregateF1: real("aggregate_f1"),
    aggregateScore: real("aggregate_score"),
    scores: jsonb("scores"),
    hallucinatedFields: jsonb("hallucinated_fields"),
    hallucinationCount: integer("hallucination_count"),

    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    cacheReadTokens: integer("cache_read_tokens").default(0),
    cacheWriteTokens: integer("cache_write_tokens").default(0),

    /** Whether this case was reused from another completed run (idempotency). */
    fromCache: boolean("from_cache").default(false),
    /** Optional API error captured for this case. */
    error: text("error"),
    durationMs: integer("duration_ms"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    byRun: index("run_cases_run_id_idx").on(t.runId),
    byTranscript: index("run_cases_transcript_id_idx").on(t.transcriptId),
    runTranscriptUnique: uniqueIndex("run_cases_run_transcript_uq").on(
      t.runId,
      t.transcriptId,
    ),
  }),
);

export const runsRelations = relations(runs, ({ many }) => ({
  cases: many(runCases),
}));

export const runCasesRelations = relations(runCases, ({ one }) => ({
  run: one(runs, {
    fields: [runCases.runId],
    references: [runs.id],
  }),
}));
