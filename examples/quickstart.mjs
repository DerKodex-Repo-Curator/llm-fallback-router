/**
 * Quickstart — one router, three providers, automatic failover.
 *
 *   node examples/quickstart.mjs
 *
 * Uses real providers when API keys are present; otherwise falls back to mock
 * providers so the example always runs.
 */

import { Router, openai, anthropic, gemini, mock } from "../dist/index.js";

const haveKeys = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY;

const providers = haveKeys
  ? [
      { provider: openai({ model: "gpt-4o" }), priority: 0 },
      { provider: anthropic({ model: "claude-sonnet-4-6" }), priority: 1 },
      { provider: gemini({ model: "gemini-2.5-flash" }), priority: 2 },
    ]
  : [
      { provider: mock({ name: "openai", model: "gpt-4o" }), priority: 0 },
      { provider: mock({ name: "claude", model: "claude-sonnet-4-6" }), priority: 1 },
    ];

if (!haveKeys) console.log("(no API keys found — running on mock providers)\n");

const router = new Router({ providers, strategy: "priority", timeoutMs: 20_000 });

const res = await router.complete({
  messages: [{ role: "user", content: "In one sentence, what is a circuit breaker in software?" }],
  maxTokens: 80,
});

console.log(res.text || "[mock response]");
console.log(`\n↳ served by ${res.provider} (${res.model}) in ${res.latencyMs}ms · $${res.costUsd.toFixed(6)}`);
