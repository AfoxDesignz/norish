/**
 * AI Provider Factory - Creates AI model instances from configuration.
 */

import type { ModelConfig, GenerationSettings, AIProvider } from "./types";

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createOllama } from "ollama-ai-provider-v2";

import { getAIConfig } from "@/config/server-config-loader";
import { aiLogger } from "@/server/logger";

/**
 * Get configured AI models.
 * Throws if AI is not enabled.
 */
export async function getModels(): Promise<ModelConfig> {
  const config = await getAIConfig(true);

  if (!config || !config.enabled) {
    throw new Error("AI is not enabled. Configure AI settings in the admin panel.");
  }

  return createModelsFromConfig(config);
}

/**
 * Create AI model instances from configuration.
 * Does not check if AI is enabled - use getModels() for guarded access.
 */
export function createModelsFromConfig(config: {
  provider: AIProvider;
  model: string;
  visionModel?: string;
  endpoint?: string;
  apiKey?: string;
}): ModelConfig {
  const { provider, model, visionModel, endpoint, apiKey } = config;

  aiLogger.debug({ provider, model, visionModel }, "Creating AI models");

  switch (provider) {
    case "openai": {
      if (!apiKey) throw new Error("API Key is required for OpenAI provider");

      const openai = createOpenAI({ apiKey });

      return {
        model: openai(model),
        visionModel: openai(visionModel || model),
        providerName: "OpenAI",
      };
    }

    case "ollama": {
      if (!endpoint) throw new Error("Endpoint is required for Ollama provider");

      const ollama = createOllama({ baseURL: endpoint });

      return {
        model: ollama(model),
        visionModel: ollama(visionModel || model),
        providerName: "Ollama",
      };
    }

    case "lm-studio":
    case "generic-openai": {
      if (!endpoint) throw new Error("Endpoint is required for this provider");

      let normalizedEndpoint = endpoint.replace(/\/+$/, ""); // Remove trailing slashes

      if (!normalizedEndpoint.endsWith("/v1")) {
        normalizedEndpoint = `${normalizedEndpoint}/v1`;
      }

      const providerName = provider === "lm-studio" ? "lmstudio" : "generic-openai";
      const compatible = createOpenAICompatible({
        name: providerName,
        baseURL: normalizedEndpoint,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        supportsStructuredOutputs: true,
      });

      return {
        model: compatible(model),
        visionModel: compatible(visionModel || model),
        providerName: provider === "lm-studio" ? "LM Studio" : "Generic OpenAI",
      };
    }

    case "perplexity": {
      if (!apiKey) throw new Error("API Key is required for Perplexity provider");

      // Use the official Perplexity AI SDK provider
      const perplexity = createPerplexity({ apiKey });

      return {
        model: perplexity(model),
        visionModel: perplexity(visionModel || model),
        providerName: "Perplexity",
      };
    }

    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

/**
 * Get generation settings from config (temperature, maxTokens).
 * These are passed to generateText() calls.
 */
export async function getGenerationSettings(): Promise<GenerationSettings> {
  const config = await getAIConfig(true);

  return {
    temperature: config?.temperature,
    maxOutputTokens: config?.maxTokens,
  };
}
