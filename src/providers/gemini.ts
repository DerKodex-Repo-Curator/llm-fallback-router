/**
 * Google Gemini provider (generateContent API). Roles are remapped to Gemini's
 * `user`/`model` convention and system messages become a `systemInstruction`.
 */

import type { CallOptions, CompletionRequest, ProviderAdapter, ProviderResult } from "../types.js";
import { costOf } from "../pricing.js";
import { type HttpProviderConfig, envKey, postJson, requireKey, resolveTimeout } from "./base.js";

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiProvider implements ProviderAdapter {
  readonly name: string;
  readonly model: string;
  private readonly cfg: HttpProviderConfig;
  private readonly baseUrl: string;

  constructor(cfg: HttpProviderConfig) {
    this.cfg = cfg;
    this.name = cfg.name ?? "gemini";
    this.model = cfg.model;
    this.baseUrl = (cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }

  async complete(req: CompletionRequest, opts: CallOptions = {}): Promise<ProviderResult> {
    const apiKey = requireKey(
      this.name,
      this.cfg.apiKey ?? envKey("GEMINI_API_KEY", "GOOGLE_API_KEY"),
      "GEMINI_API_KEY",
    );
    const model = req.model ?? this.model;

    const systemText = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

    const generationConfig: Record<string, unknown> = {};
    if (req.maxTokens !== undefined) generationConfig["maxOutputTokens"] = req.maxTokens;
    if (req.temperature !== undefined) generationConfig["temperature"] = req.temperature;

    const body: Record<string, unknown> = { contents };
    if (systemText) body["systemInstruction"] = { parts: [{ text: systemText }] };
    if (Object.keys(generationConfig).length > 0) body["generationConfig"] = generationConfig;

    const t0 = Date.now();
    const json = (await postJson({
      url: `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      headers: { ...this.cfg.headers },
      body,
      provider: this.name,
      timeoutMs: resolveTimeout(this.cfg),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })) as GenerateContentResponse;
    const latencyMs = Date.now() - t0;

    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const promptTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text,
      model,
      provider: this.name,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      costUsd: costOf(model, promptTokens, completionTokens),
      latencyMs,
      finishReason: cand?.finishReason ?? "STOP",
      raw: json,
    };
  }
}

export function gemini(cfg: HttpProviderConfig): GeminiProvider {
  return new GeminiProvider(cfg);
}
