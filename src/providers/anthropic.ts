/**
 * Anthropic provider (Messages API). System messages are hoisted into the
 * top-level `system` field; the rest map to user/assistant turns.
 */

import type { CallOptions, CompletionRequest, ProviderAdapter, ProviderResult } from "../types.js";
import { costOf } from "../pricing.js";
import { type HttpProviderConfig, envKey, postJson, requireKey, resolveTimeout } from "./base.js";

interface AnthropicMessage {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements ProviderAdapter {
  readonly name: string;
  readonly model: string;
  private readonly cfg: HttpProviderConfig;
  private readonly baseUrl: string;
  private readonly version: string;

  constructor(cfg: HttpProviderConfig & { anthropicVersion?: string }) {
    this.cfg = cfg;
    this.name = cfg.name ?? "anthropic";
    this.model = cfg.model;
    this.baseUrl = (cfg.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
    this.version = cfg.anthropicVersion ?? "2023-06-01";
  }

  async complete(req: CompletionRequest, opts: CallOptions = {}): Promise<ProviderResult> {
    const apiKey = requireKey(this.name, this.cfg.apiKey ?? envKey("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY");
    const model = req.model ?? this.model;

    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: req.maxTokens ?? 1024, // required by the Messages API
    };
    if (system) body["system"] = system;
    if (req.temperature !== undefined) body["temperature"] = req.temperature;

    const t0 = Date.now();
    const json = (await postJson({
      url: `${this.baseUrl}/messages`,
      headers: { "x-api-key": apiKey, "anthropic-version": this.version, ...this.cfg.headers },
      body,
      provider: this.name,
      timeoutMs: resolveTimeout(this.cfg),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })) as AnthropicMessage;
    const latencyMs = Date.now() - t0;

    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const promptTokens = json.usage?.input_tokens ?? 0;
    const completionTokens = json.usage?.output_tokens ?? 0;
    return {
      text,
      model,
      provider: this.name,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      costUsd: costOf(model, promptTokens, completionTokens),
      latencyMs,
      finishReason: json.stop_reason ?? "end_turn",
      raw: json,
    };
  }
}

export function anthropic(cfg: HttpProviderConfig & { anthropicVersion?: string }): AnthropicProvider {
  return new AnthropicProvider(cfg);
}
