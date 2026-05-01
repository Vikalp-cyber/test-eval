"use client";

import { useEffect, useState } from "react";
import {
  getStoredApiKey,
  setStoredApiKey,
  onApiKeyChange,
  maskApiKey,
} from "@/lib/api-key";

/**
 * Header button that lets a user paste/clear their Anthropic API key.
 *
 * The key lives in localStorage and is sent on every "start run" / "resume"
 * request via the `x-anthropic-api-key` header (see `apiKeyHeaders()`).
 * The server never persists it.
 */
export function ApiKeyButton() {
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState("");
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);

  // Sync from localStorage on mount + whenever it changes (other tabs / forms).
  useEffect(() => {
    setStored(getStoredApiKey());
    return onApiKeyChange(() => setStored(getStoredApiKey()));
  }, []);

  function openDialog() {
    setDraft(stored);
    setReveal(false);
    setOpen(true);
  }

  function save() {
    setStoredApiKey(draft);
    setStored(draft.trim());
    setOpen(false);
  }

  function clear() {
    setStoredApiKey("");
    setStored("");
    setDraft("");
  }

  const hasKey = stored.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={`px-3 py-2 rounded-full text-xs font-medium border transition-all ${
          hasKey
            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15"
            : "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/15"
        }`}
        title={hasKey ? "Update Anthropic API key" : "Set Anthropic API key"}
      >
        <span className="inline-flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`}
          />
          {hasKey ? `Key: ${maskApiKey(stored)}` : "Set API key"}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-white mb-1">
              Anthropic API key
            </h2>
            <p className="text-sm text-slate-400 mb-4">
              Paste your key (starts with{" "}
              <code className="text-indigo-300">sk-ant-…</code>). It is stored
              only in this browser and forwarded to the server on each run via
              the <code className="text-indigo-300">x-anthropic-api-key</code>{" "}
              header. The server never persists it.
            </p>

            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
              Key
            </label>
            <div className="flex gap-2">
              <input
                type={reveal ? "text" : "password"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="sk-ant-…"
                autoFocus
                spellCheck={false}
                className="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white font-mono"
              />
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10"
              >
                {reveal ? "Hide" : "Show"}
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Get one at{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:underline"
              >
                console.anthropic.com/settings/keys
              </a>
              .
            </p>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={clear}
                disabled={!hasKey && !draft}
                className="text-xs text-red-300 hover:text-red-200 disabled:opacity-40"
              >
                Clear stored key
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-full text-sm border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!draft.trim()}
                  className="px-4 py-2 rounded-full text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
                >
                  Save key
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
