/**
 * Mistral provider. Mistral's API is OpenAI-compatible (chat/completions), so
 * this is a thin wrapper over the OpenAI adapter with Mistral's base URL/key.
 */

import { OpenAIProvider } from "./openai.js";
import { type HttpProviderConfig, envKey } from "./base.js";

export class MistralProvider extends OpenAIProvider {
  constructor(cfg: HttpProviderConfig) {
    super({
      ...cfg,
      name: cfg.name ?? "mistral",
      baseUrl: cfg.baseUrl ?? "https://api.mistral.ai/v1",
      apiKey: cfg.apiKey ?? envKey("MISTRAL_API_KEY"),
    });
  }
}

export function mistral(cfg: HttpProviderConfig): MistralProvider {
  return new MistralProvider(cfg);
}
