/**
 * OpenAI provider (Chat Completions API). Also works for any OpenAI-compatible
 * endpoint via `baseUrl` (Azure OpenAI, vLLM, Together, Groq, OpenRouter, …).
 */

import type { CallOptions, CompletionRequest, ProviderAdapter, ProviderResult } from "../types.js";
import { costOf } from "../pricing.js";
import { type HttpProviderConfig, envKey, postJson, requireKey, resolveTimeout } from "./base.js";

interface ChatCompletion {
  choices: Array<{ message: { content: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAIProvider implements ProviderAdapter {
  readonly name: string;
  readonly model: string;
  private readonly cfg: HttpProviderConfig;
  private readonly baseUrl: string;

  constructor(cfg: HttpProviderConfig) {
    this.cfg = cfg;
    this.name = cfg.name ?? "openai";
    this.model = cfg.model;
    this.baseUrl = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  async complete(req: CompletionRequest, opts: CallOptions = {}): Promise<ProviderResult> {
    const apiKey = requireKey(this.name, this.cfg.apiKey ?? envKey("OPENAI_API_KEY"), "OPENAI_API_KEY");
    const model = req.model ?? this.model;
    const body: Record<string, unknown> = {
      model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;
    if (req.temperature !== undefined) body["temperature"] = req.temperature;

    const t0 = Date.now();
    const json = (await postJson({
      url: `${this.baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${apiKey}`, ...this.cfg.headers },
      body,
      provider: this.name,
      timeoutMs: resolveTimeout(this.cfg),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })) as ChatCompletion;
    const latencyMs = Date.now() - t0;

    const choice = json.choices?.[0];
    const promptTokens = json.usage?.prompt_tokens ?? 0;
    const completionTokens = json.usage?.completion_tokens ?? 0;
    return {
      text: choice?.message?.content ?? "",
      model,
      provider: this.name,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      costUsd: costOf(model, promptTokens, completionTokens),
      latencyMs,
      finishReason: choice?.finish_reason ?? "stop",
      raw: json,
    };
  }
}

export function openai(cfg: HttpProviderConfig): OpenAIProvider {
  return new OpenAIProvider(cfg);
}
