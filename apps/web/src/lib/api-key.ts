/**
 * Client-side helper for the user-supplied Anthropic API key.
 *
 * The key is stored in `localStorage` so it survives reloads, and sent on
 * every "start run" / "resume" request via the `x-anthropic-api-key` header.
 * The server never persists it — it's used just for that one request.
 *
 * Trust model: this is meant for personal/demo use. localStorage is readable
 * by any script on the same origin; not recommended for shared machines.
 */

const STORAGE_KEY = "anthropic_api_key";
const STORAGE_EVENT = "anthropic_api_key_change";

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredApiKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = key.trim();
    if (trimmed) {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  } catch {
    // ignore — private mode, quota, etc.
  }
}

/** Listen for in-tab updates (storage event only fires in OTHER tabs). */
export function onApiKeyChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(STORAGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(STORAGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Headers to merge into a fetch() call that needs the user's key. */
export function apiKeyHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  return key ? { "x-anthropic-api-key": key } : {};
}

/** Lightweight obfuscation for display — `sk-ant-…abcd` style. */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
