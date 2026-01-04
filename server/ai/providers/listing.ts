/**
 * AI Provider Listing - List available models from providers.
 */

import type { AvailableModel, AIProvider } from "./types";

import { aiLogger } from "@/server/logger";

/**
 * List available models from Ollama.
 */
export async function listOllamaModels(endpoint: string): Promise<string[]> {
  try {
    const baseUrl = endpoint.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return (data.models || []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

/**
 * List available models from OpenAI.
 * Filters to only include chat models suitable for our use case.
 */
export async function listOpenAIModels(apiKey: string): Promise<AvailableModel[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      aiLogger.debug({ status: response.status }, "OpenAI /v1/models request failed");

      return [];
    }

    const data = await response.json();
    const models: Array<{ id: string; owned_by: string }> = data.data || [];

    // Filter to chat/completion models and sort by name
    // Exclude embedding, whisper, tts, dall-e models
    const chatModels = models
      .filter((m) => {
        const id = m.id.toLowerCase();

        return (
          !id.includes("embedding") &&
          !id.includes("whisper") &&
          !id.includes("tts") &&
          !id.includes("dall-e") &&
          !id.includes("davinci") &&
          !id.includes("babbage") &&
          !id.includes("curie") &&
          !id.includes("ada") &&
          !id.startsWith("ft:") // Exclude fine-tuned models from list (user can still type them)
        );
      })
      .map((m) => ({
        id: m.id,
        name: m.id,
        supportsVision: m.id.includes("vision") || m.id.includes("gpt-4") || m.id.includes("gpt-5"),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    aiLogger.debug({ count: chatModels.length }, "OpenAI models listed");

    return chatModels;
  } catch (error) {
    aiLogger.debug({ err: error }, "Failed to list OpenAI models");

    return [];
  }
}

/**
 * List available models from an OpenAI-compatible endpoint (LM Studio, etc.).
 * These endpoints expose /v1/models like OpenAI.
 */
export async function listOpenAICompatibleModels(
  endpoint: string,
  apiKey?: string
): Promise<AvailableModel[]> {
  try {
    // Normalize endpoint: remove trailing slashes and /v1 suffix if present
    // We'll add /v1/models ourselves
    let baseUrl = endpoint.replace(/\/+$/, "");

    if (baseUrl.endsWith("/v1")) {
      baseUrl = baseUrl.slice(0, -3);
    }

    const headers: Record<string, string> = {};

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      aiLogger.debug(
        { status: response.status, endpoint },
        "OpenAI-compatible /v1/models request failed"
      );

      return [];
    }

    const data = await response.json();
    const models: Array<{ id: string; owned_by?: string }> = data.data || [];

    const result = models.map((m) => ({
      id: m.id,
      name: m.id,
      supportsVision: m.id.toLowerCase().includes("vision") || m.id.toLowerCase().includes("llava"),
    }));

    aiLogger.debug({ count: result.length, endpoint }, "OpenAI-compatible models listed");

    return result;
  } catch (error) {
    aiLogger.debug({ err: error, endpoint }, "Failed to list OpenAI-compatible models");

    return [];
  }
}

/**
 * List available models for any supported provider.
 * Returns an empty array if listing fails or is not supported.
 */
export async function listModels(
  provider: AIProvider,
  options: { endpoint?: string; apiKey?: string }
): Promise<AvailableModel[]> {
  const { endpoint, apiKey } = options;

  switch (provider) {
    case "openai":
      if (!apiKey) {
        aiLogger.debug("Cannot list OpenAI models without API key");

        return [];
      }

      return listOpenAIModels(apiKey);

    case "ollama":
      if (!endpoint) {
        aiLogger.debug("Cannot list Ollama models without endpoint");

        return [];
      }
      // Convert string[] to AvailableModel[]
      const ollamaModels = await listOllamaModels(endpoint);

      return ollamaModels.map((id) => ({
        id,
        name: id,
        supportsVision:
          id.toLowerCase().includes("llava") ||
          id.toLowerCase().includes("vision") ||
          id.toLowerCase().includes("bakllava"),
      }));

    case "lm-studio":
    case "generic-openai":
      if (!endpoint) {
        aiLogger.debug("Cannot list models without endpoint");

        return [];
      }

      return listOpenAICompatibleModels(endpoint, apiKey);

    case "perplexity":
      // Perplexity doesn't have a models list endpoint, return known models
      // See: https://docs.perplexity.ai
      return [
        { id: "sonar", name: "Sonar", supportsVision: false },
        { id: "sonar-pro", name: "Sonar Pro", supportsVision: false },
        { id: "sonar-reasoning", name: "Sonar Reasoning", supportsVision: false },
        { id: "sonar-reasoning-pro", name: "Sonar Reasoning Pro", supportsVision: false },
        { id: "sonar-deep-research", name: "Sonar Deep Research", supportsVision: false },
      ];

    default:
      aiLogger.debug({ provider }, "Unknown provider for model listing");

      return [];
  }
}

/**
 * List available transcription (Whisper) models from OpenAI.
 * Filters to only include whisper models.
 */
export async function listOpenAITranscriptionModels(apiKey: string): Promise<AvailableModel[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      aiLogger.debug({ status: response.status }, "OpenAI /v1/models request failed");

      return [];
    }

    const data = await response.json();
    const models: Array<{ id: string; owned_by: string }> = data.data || [];

    // Filter to whisper/transcription models only
    const whisperModels = models
      .filter((m) => m.id.toLowerCase().includes("whisper"))
      .map((m) => ({
        id: m.id,
        name: m.id,
        supportsVision: false,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    aiLogger.debug({ count: whisperModels.length }, "OpenAI transcription models listed");

    return whisperModels;
  } catch (error) {
    aiLogger.debug({ err: error }, "Failed to list OpenAI transcription models");

    return [];
  }
}

/**
 * List available transcription models from an OpenAI-compatible endpoint.
 * Filters to whisper/transcription models if possible.
 */
export async function listOpenAICompatibleTranscriptionModels(
  endpoint: string,
  apiKey?: string
): Promise<AvailableModel[]> {
  try {
    // Normalize endpoint
    let baseUrl = endpoint.replace(/\/+$/, "");

    if (baseUrl.endsWith("/v1")) {
      baseUrl = baseUrl.slice(0, -3);
    }

    const headers: Record<string, string> = {};

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      aiLogger.debug(
        { status: response.status, endpoint },
        "OpenAI-compatible /v1/models request failed for transcription"
      );

      return [];
    }

    const data = await response.json();
    const models: Array<{ id: string; owned_by?: string }> = data.data || [];

    // Try to filter to whisper models, but if none found return all (user can pick)
    const whisperModels = models.filter((m) => m.id.toLowerCase().includes("whisper"));
    const modelsToReturn = whisperModels.length > 0 ? whisperModels : models;

    const result = modelsToReturn.map((m) => ({
      id: m.id,
      name: m.id,
      supportsVision: false,
    }));

    aiLogger.debug(
      { count: result.length, endpoint },
      "OpenAI-compatible transcription models listed"
    );

    return result;
  } catch (error) {
    aiLogger.debug(
      { err: error, endpoint },
      "Failed to list OpenAI-compatible transcription models"
    );

    return [];
  }
}

/**
 * List available transcription models for a given provider.
 */
export async function listTranscriptionModels(
  provider: "openai" | "generic-openai" | "disabled",
  options: { endpoint?: string; apiKey?: string }
): Promise<AvailableModel[]> {
  const { endpoint, apiKey } = options;

  switch (provider) {
    case "openai":
      if (!apiKey) {
        aiLogger.debug("Cannot list OpenAI transcription models without API key");

        return [];
      }

      return listOpenAITranscriptionModels(apiKey);

    case "generic-openai":
      if (!endpoint) {
        aiLogger.debug("Cannot list transcription models without endpoint");

        return [];
      }

      return listOpenAICompatibleTranscriptionModels(endpoint, apiKey);

    case "disabled":
    default:
      return [];
  }
}
