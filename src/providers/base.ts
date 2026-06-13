/**
 * Shared plumbing for HTTP-backed providers: a fetch wrapper that applies a
 * per-call timeout, honours an upstream abort signal from the router, and
 * converts transport/HTTP failures into a typed `ProviderError`.
 *
 * Zero dependencies — just the built-in `fetch` (Node 18+).
 */

import { ProviderError, classifyStatus } from "../errors.js";

export interface HttpProviderConfig {
  /** Override the adapter name (must be unique within a Router). */
  name?: string;
  /** API key. Falls back to the provider's conventional env var. */
  apiKey?: string;
  /** Override the API base URL (useful for proxies / Azure / self-host). */
  baseUrl?: string;
  /** Default model for this adapter. */
  model: string;
  /** Per-call timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Combine the router's abort signal with a per-call timeout into one signal. */
function withTimeout(external: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  done: () => void;
} {
  const ac = new AbortController();
  const onAbort = () => ac.abort((external as AbortSignal & { reason?: unknown })?.reason);
  if (external) {
    if (external.aborted) ac.abort();
    else external.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(
    () => ac.abort(Object.assign(new Error("Request timed out"), { name: "TimeoutError" })),
    timeoutMs,
  );
  return {
    signal: ac.signal,
    done: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function truncate(s: string, n = 300): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export async function postJson(opts: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  provider: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  const { signal, done } = withTimeout(opts.signal, opts.timeoutMs);
  try {
    const res = await fetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...opts.headers },
      body: JSON.stringify(opts.body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError({
        message: `${opts.provider} HTTP ${res.status}: ${truncate(text)}`,
        kind: classifyStatus(res.status),
        provider: opts.provider,
        status: res.status,
      });
    }
    return await res.json();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const e = err as { name?: string; message?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new ProviderError({
        message: `${opts.provider} request aborted/timed out`,
        kind: "timeout",
        provider: opts.provider,
        cause: err,
      });
    }
    throw new ProviderError({
      message: `${opts.provider} network error: ${e?.message ?? String(err)}`,
      kind: "network",
      provider: opts.provider,
      cause: err,
    });
  } finally {
    done();
  }
}

export function envKey(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

export function requireKey(provider: string, key: string | undefined, envName: string): string {
  if (!key) {
    throw new ProviderError({
      message: `${provider}: no API key. Pass { apiKey } or set ${envName}.`,
      kind: "auth",
      provider,
    });
  }
  return key;
}

export function resolveTimeout(cfg: HttpProviderConfig): number {
  return cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}
