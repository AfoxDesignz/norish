/**
 * Audio Transcription.
 *
 * Transcribes audio files to text using the configured transcription provider.
 * Uses Vercel AI SDK for OpenAI, falls back to OpenAI client for compatible endpoints.
 */

import type { TranscriptionProvider } from "@/server/db/zodSchemas/server-config";

import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";

import { experimental_transcribe as transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";

import { getVideoConfig, getAIConfig } from "@/config/server-config-loader";
import { aiLogger } from "@/server/logger";

/**
 * Transcribe audio using Vercel AI SDK (OpenAI provider).
 */
async function transcribeWithSDK(
  audioPath: string,
  apiKey: string,
  model: string
): Promise<string> {
  const openai = createOpenAI({ apiKey });
  const audioData = await readFile(audioPath);

  aiLogger.debug(
    { audioPath, model, provider: "openai-sdk" },
    "Starting transcription with AI SDK"
  );

  const result = await transcribe({
    model: openai.transcription(model),
    audio: audioData,
    providerOptions: {
      openai: { language: "en" },
    },
  });

  aiLogger.debug(
    {
      durationSeconds: result.durationInSeconds,
      language: result.language,
      segmentCount: result.segments?.length,
    },
    "Transcription completed"
  );

  return result.text?.trim() || "";
}

/**
 * Transcribe audio using OpenAI client directly (for compatible endpoints).
 * The Vercel AI SDK's openai-compatible provider doesn't support transcription.
 */
async function transcribeWithClient(
  audioPath: string,
  apiKey: string,
  model: string,
  endpoint?: string
): Promise<string> {
  let baseURL = endpoint;

  if (baseURL) {
    baseURL = baseURL.replace(/\/+$/, "");
    if (!baseURL.endsWith("/v1")) {
      baseURL = `${baseURL}/v1`;
    }
  }

  aiLogger.debug(
    { audioPath, model, provider: "openai-client", endpoint: baseURL },
    "Starting transcription with OpenAI client"
  );

  const client = new OpenAI({
    apiKey,
    ...(baseURL && { baseURL }),
  });

  const audioFile = createReadStream(audioPath);

  const response = await client.audio.transcriptions.create({
    file: audioFile,
    model,
    language: "en",
    response_format: "json",
  });

  aiLogger.debug({ response }, "Transcription response received");

  // The OpenAI SDK returns { text: string } for transcription
  const transcript = response.text?.trim();

  if (!transcript) {
    throw new Error("Transcription response missing text content");
  }

  return transcript;
}

/**
 * Transcribe an audio file to text.
 *
 * @param audioPath - Path to the audio file to transcribe.
 * @returns The transcribed text.
 * @throws If transcription is disabled, not configured, or fails.
 */
export async function transcribeAudio(audioPath: string): Promise<string> {
  const [videoConfig, aiConfig] = await Promise.all([getVideoConfig(true), getAIConfig(true)]);

  if (!videoConfig?.enabled) {
    throw new Error("Video parsing is not enabled. Enable it in admin settings.");
  }

  const provider: TranscriptionProvider = videoConfig.transcriptionProvider;

  if (provider === "disabled") {
    throw new Error(
      "Transcription is disabled. Configure a transcription provider in admin settings."
    );
  }

  const apiKey = videoConfig.transcriptionApiKey || aiConfig?.apiKey;

  if (!apiKey) {
    throw new Error("No API key configured for transcription. Set it in admin settings.");
  }

  const model = videoConfig.transcriptionModel || "whisper-1";

  try {
    let transcript: string;

    if (provider === "openai") {
      // Use Vercel AI SDK for native OpenAI
      transcript = await transcribeWithSDK(audioPath, apiKey, model);
    } else {
      // Use OpenAI client for generic-openai compatible endpoints
      const endpoint = videoConfig.transcriptionEndpoint || aiConfig?.endpoint;

      transcript = await transcribeWithClient(audioPath, apiKey, model, endpoint);
    }

    if (!transcript || transcript.length === 0) {
      throw new Error("Transcription returned empty text");
    }

    return transcript;
  } catch (error: unknown) {
    aiLogger.error({ err: error }, "Transcription failed");

    // Handle specific error cases
    if (error instanceof Error) {
      if (error.message.includes("ENOENT")) {
        throw new Error("Audio file not found");
      }

      // Re-throw our own errors
      if (
        error.message.includes("disabled") ||
        error.message.includes("not enabled") ||
        error.message.includes("No API key") ||
        error.message.includes("empty text")
      ) {
        throw error;
      }
    }

    // Handle API errors
    const apiError = error as { status?: number; message?: string };

    if (apiError.status === 429) {
      throw new Error("Rate limit exceeded on transcription service. Please try again later.");
    }
    if (apiError.status === 401 || apiError.status === 403) {
      throw new Error(
        "Invalid API key for transcription service. Check your API key in admin settings."
      );
    }

    const errorMessage = apiError.message || "Unknown error";

    throw new Error(`Failed to transcribe audio: ${errorMessage}`);
  }
}
