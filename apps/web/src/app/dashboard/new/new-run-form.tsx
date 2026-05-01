"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { env } from "@test-evals/env/web";
import {
  apiKeyHeaders,
  getStoredApiKey,
  onApiKeyChange,
} from "@/lib/api-key";
import { ApiKeyButton } from "@/components/api-key-button";

const strategies = ["zero_shot", "few_shot", "cot"] as const;

export function NewRunForm() {
  const router = useRouter();
  const [strategy, setStrategy] = useState<(typeof strategies)[number]>("zero_shot");
  const [model, setModel] = useState("claude-haiku-4-5-20251001");
  const [limit, setLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  // Track whether a key is set so we can warn before submit and refresh after
  // the user closes the API-key modal.
  useEffect(() => {
    setHasKey(!!getStoredApiKey());
    return onApiKeyChange(() => setHasKey(!!getStoredApiKey()));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!getStoredApiKey()) {
      setError(
        "No Anthropic API key set. Click 'Set API key' above and paste your key first.",
      );
      return;
    }

    setPending(true);
    try {
      const base = env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");
      const body: {
        strategy: string;
        model: string;
        force: boolean;
        limit?: number;
      } = { strategy, model, force: false };
      const lim = limit.trim() ? parseInt(limit, 10) : NaN;
      if (!Number.isNaN(lim) && lim > 0) body.limit = lim;

      const res = await fetch(`${base}/api/v1/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...apiKeyHeaders(),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const data = (await res.json()) as { runId: string };
      router.push(`/dashboard/runs/${data.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/5">
        <div className="text-xs text-slate-500">
          Anthropic key used: <span className="text-slate-300">browser-stored</span>
        </div>
        <ApiKeyButton />
      </div>

      <div>
        <label htmlFor="strategy" className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
          Strategy
        </label>
        <select
          id="strategy"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as (typeof strategies)[number])}
          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white"
        >
          {strategies.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="model" className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
          Model
        </label>
        <input
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white font-mono"
        />
      </div>
      <div>
        <label htmlFor="limit" className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
          Case limit (optional)
        </label>
        <input
          id="limit"
          type="number"
          min={1}
          placeholder="50 (default: all transcripts)"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white font-mono placeholder:text-slate-600"
        />
      </div>

      {!hasKey && (
        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          You haven&apos;t set an Anthropic API key yet. The run will fail until
          you click <span className="font-medium">Set API key</span> above.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 whitespace-pre-wrap">{error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Starting…" : "Start run"}
      </button>
    </form>
  );
}
