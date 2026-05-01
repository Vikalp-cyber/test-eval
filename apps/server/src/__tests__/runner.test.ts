/// <reference types="bun" />
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ||= "test-secret-1234567890-abcdef";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
process.env.CORS_ORIGIN ||= "http://localhost:3101";

import { test, expect, describe, mock, beforeEach } from "bun:test";

// Stateful chain so we can program "what does .limit() return" per test.
// The runner calls db.select(...).from(...).innerJoin(...).where(...).orderBy(...).limit(...)
let nextLimitResult: unknown[] = [];
const setNextLimitResult = (v: unknown[]) => {
  nextLimitResult = v;
};

const chain = {
  from: mock(() => chain),
  innerJoin: mock(() => chain),
  where: mock(() => chain),
  orderBy: mock(() => chain),
  limit: mock(async () => nextLimitResult),
};

const mockDb = {
  insert: mock(() => ({
    values: mock(() => ({
      onConflictDoNothing: mock(() => Promise.resolve()),
    })),
  })),
  update: mock(() => ({ set: mock(() => ({ where: mock(() => Promise.resolve()) })) })),
  delete: mock(() => ({ where: mock(() => Promise.resolve()) })),
  query: {
    runCases: { findMany: mock(() => Promise.resolve([])) },
    runs: { findFirst: mock(() => Promise.resolve(null)) },
  },
  select: mock(() => chain),
};

mock.module("@test-evals/env/server", () => ({
  env: { DATABASE_URL: "postgres://mock" },
}));
mock.module("@test-evals/db", () => ({ db: mockDb }));

const { RunManager } = await import("../services/runner.service.js");
const { zeroShot } = await import("@test-evals/llm");

const validMockExtraction = {
  chief_complaint: "x",
  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
  medications: [],
  diagnoses: [],
  plan: [],
  follow_up: { interval_days: null, reason: null },
};

mock.module("fs/promises", () => ({
  default: {
    readFile: mock(async (p: string) => {
      if (p.endsWith(".json")) return JSON.stringify(validMockExtraction);
      return "transcript";
    }),
  },
}));

describe("RunManager", () => {
  beforeEach(() => {
    mockDb.query.runCases.findMany.mockClear();
    mockDb.query.runCases.findMany.mockResolvedValue([]);
    setNextLimitResult([]);
  });

  test("Rate limits back off correctly (single 429 retried)", async () => {
    const runner = new RunManager();

    let callCount = 0;
    (runner as any).extractor = {
      extract: mock(async () => {
        callCount++;
        if (callCount === 1) {
          const err: any = new Error("Rate limit");
          err.status = 429;
          err.headers = { "retry-after": "1" };
          throw err;
        }
        return {
          success: true,
          data: validMockExtraction,
          attempts: [],
          tokens: { input: 10, output: 10, cache_read: 0, cache_write: 0 },
          promptHash: "h",
          strategyName: "zero_shot",
        };
      }),
    };

    const start = Date.now();
    await runner.startRun(zeroShot, "model", ["case1.txt"], "dir", "gold");
    await new Promise((r) => setTimeout(r, 1300));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(callCount).toBe(2);
  });

  test("Resumability skips completed cases", async () => {
    const runner = new RunManager();
    mockDb.query.runCases.findMany.mockResolvedValueOnce([
      { transcriptId: "case1.txt" },
    ] as any);

    let extractCount = 0;
    (runner as any).extractor = {
      extract: mock(async () => {
        extractCount++;
        return {
          success: true,
          data: validMockExtraction,
          attempts: [],
          tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 },
          promptHash: "h",
          strategyName: "zero_shot",
        };
      }),
    };

    await runner.startRun(zeroShot, "model", ["case1.txt", "case2.txt"], "dir", "gold", {
      force: false,
      existingRunId: "run123",
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(extractCount).toBe(1);
  });

  test("Idempotency reuses cached prediction by prompt hash (no extractor call)", async () => {
    const runner = new RunManager();

    setNextLimitResult([
      {
        predicted: validMockExtraction,
        schemaValid: true,
        attempts: [],
        inputTokens: 5,
        outputTokens: 5,
      },
    ]);

    const extract = mock(async () => {
      throw new Error("extractor should NOT be called when idempotency cache hits");
    });
    (runner as any).extractor = { extract };

    await runner.startRun(zeroShot, "model", ["case1.txt"], "dir", "gold");
    await new Promise((r) => setTimeout(r, 250));
    expect(extract).not.toHaveBeenCalled();
  });

  test("startRun is re-entrant safe for same runId", async () => {
    const runner = new RunManager();

    let extractCalls = 0;
    (runner as any).extractor = {
      extract: mock(async () => {
        extractCalls++;
        return {
          success: true,
          data: validMockExtraction,
          attempts: [],
          tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 },
          promptHash: "h",
          strategyName: "zero_shot",
        };
      }),
    };

    const id = "run-reentrant";
    await runner.startRun(zeroShot, "model", ["case1.txt"], "dir", "gold", {
      force: false,
      existingRunId: id,
    });
    await runner.startRun(zeroShot, "model", ["case1.txt"], "dir", "gold", {
      force: false,
      existingRunId: id,
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(extractCalls).toBeLessThanOrEqual(1);
  });
});
