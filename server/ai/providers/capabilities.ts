/**
 * AI Provider Capabilities - Query what models can do.
 */

import type { ModelCapabilities, AIProvider } from "./types";

import { aiLogger } from "@/server/logger";

/**
 * Query model capabilities dynamically.
 *
 * For Ollama, queries the /api/show endpoint.
 * For OpenAI, uses known capabilities.
 * For others, uses sensible defaults.
 */
export async function getModelCapabilities(
  provider: AIProvider,
  endpoint?: string,
  model?: string
): Promise<ModelCapabilities> {
  const defaults: ModelCapabilities = {
    supportsTemperature: true,
    supportsMaxTokens: true,
    supportsVision: false,
    supportsStructuredOutput: true,
    maxTemperature: 2,
  };

  try {
    switch (provider) {
      case "openai":
        return {
          ...defaults,
          supportsVision: true, // Most GPT-4+ models support vision
          supportsStructuredOutput: true,
        };

      case "ollama":
        if (endpoint && model) {
          return await queryOllamaCapabilities(endpoint, model, defaults);
        }

        return {
          ...defaults,
          supportsMaxTokens: false, // Ollama uses num_predict
          supportsVision: false, // Depends on model
        };

      case "lm-studio":
        return {
          ...defaults,
          supportsVision: false, // Depends on loaded model
          supportsStructuredOutput: true,
        };

      case "generic-openai":
        return {
          ...defaults,
          supportsVision: false, // Unknown
          supportsStructuredOutput: false, // May not support json_schema
        };

      default:
        return defaults;
    }
  } catch (error) {
    aiLogger.warn({ err: error, provider }, "Failed to query model capabilities, using defaults");

    return defaults;
  }
}

/**
 * Query Ollama for model capabilities.
 */
async function queryOllamaCapabilities(
  endpoint: string,
  model: string,
  defaults: ModelCapabilities
): Promise<ModelCapabilities> {
  try {
    // Normalize endpoint (remove trailing slash)
    const baseUrl = endpoint.replace(/\/+$/, "");

    const response = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      aiLogger.debug({ status: response.status }, "Ollama /api/show request failed");

      return { ...defaults, supportsMaxTokens: false };
    }

    const data = await response.json();

    // Check model info for vision capability
    const modelInfo = data.details || {};
    const families = modelInfo.families || [];
    const hasVision =
      families.includes("clip") ||
      model.toLowerCase().includes("llava") ||
      model.toLowerCase().includes("vision");

    aiLogger.debug({ model, families, hasVision }, "Ollama model capabilities detected");

    return {
      supportsTemperature: true,
      supportsMaxTokens: false, // Ollama uses num_predict, not max_tokens
      supportsVision: hasVision,
      supportsStructuredOutput: true, // Ollama supports JSON mode
      maxTemperature: 2,
    };
  } catch (error) {
    aiLogger.debug({ err: error }, "Failed to query Ollama capabilities");

    return { ...defaults, supportsMaxTokens: false };
  }
}
