import { FullRecipeInsertDTO } from "@/types/dto/recipe";
import { tryExtractRecipeFromJsonLd } from "@/server/parser/jsonld";
import { tryExtractRecipeFromMicrodata } from "@/server/parser/microdata";
import { extractRecipeWithAI } from "@/server/ai/recipe-parser";
import {
  getContentIndicators,
  isAIEnabled,
  isVideoParsingEnabled,
  shouldAlwaysUseAI,
} from "@/config/server-config-loader";
import { isVideoUrl } from "@/server/helpers";
import { parserLogger as log } from "@/server/logger";
import { fetchViaPlaywright } from "./fetch";

export interface ParseRecipeResult {
  recipe: FullRecipeInsertDTO;
  /** Whether AI was used for extraction (affects auto-tagging) */
  usedAI: boolean;
}

export async function parseRecipeFromUrl(
  url: string,
  recipeId: string,
  allergies?: string[],
  forceAI?: boolean
): Promise<ParseRecipeResult> {
  // Check if URL is a video platform (YouTube, Instagram, TikTok, etc.)
  if (await isVideoUrl(url)) {
    const videoEnabled = await isVideoParsingEnabled();

    if (!videoEnabled) {
      throw new Error("Video recipe parsing is not enabled.");
    }

    try {
      const { processVideoRecipe } = await import("@/server/video/processor");
      const recipe = await processVideoRecipe(url, recipeId, allergies);

      return { recipe, usedAI: true };
    } catch (error: any) {
      log.error({ err: error }, "Video processing failed");
      throw error;
    }
  }

  const html = await fetchViaPlaywright(url);

  if (!html) throw new Error("Cannot fetch recipe page.");

  const isRecipe = await isPageLikelyRecipe(html);

  if (!isRecipe) {
    throw new Error("Page does not appear to contain a recipe.");
  }

  // Check if AI-only mode is requested or globally enabled
  const useAIOnly = forceAI ?? (await shouldAlwaysUseAI());

  if (useAIOnly) {
    log.info({ url }, "AI-only mode enabled, skipping structured parsers");
    const aiEnabled = await isAIEnabled();

    if (!aiEnabled) {
      throw new Error("AI-only import requested but AI is not enabled.");
    }

    const aiResult = await extractRecipeWithAI(html, recipeId, url, allergies);

    if (aiResult.success) {
      return { recipe: aiResult.data, usedAI: true };
    }

    throw new Error(`AI extraction failed: ${aiResult.error}`);
  }

  // Standard parsing flow: try structured parsers first, then AI fallback
  const jsonLdParsed = await tryExtractRecipeFromJsonLd(url, html, recipeId);
  const containsStepsAndIngredients =
    !!jsonLdParsed &&
    Array.isArray(jsonLdParsed.recipeIngredients) &&
    jsonLdParsed.recipeIngredients.length > 0 &&
    Array.isArray(jsonLdParsed.steps) &&
    jsonLdParsed.steps.length > 0;

  if (containsStepsAndIngredients) {
    return { recipe: jsonLdParsed, usedAI: false };
  }

  const microParsed = await tryExtractRecipeFromMicrodata(url, html, recipeId);
  const containsMicroStepsAndIngredients =
    !!microParsed &&
    Array.isArray(microParsed.recipeIngredients) &&
    microParsed.recipeIngredients.length > 0 &&
    Array.isArray(microParsed.steps) &&
    microParsed.steps.length > 0;

  if (containsMicroStepsAndIngredients) {
    return { recipe: microParsed, usedAI: false };
  }

  // Only attempt AI extraction if AI is enabled
  const aiEnabled = await isAIEnabled();

  if (aiEnabled) {
    log.info({ url }, "Falling back to AI extraction");
    const aiResult = await extractRecipeWithAI(html, recipeId, url, allergies);

    if (aiResult.success) {
      return { recipe: aiResult.data, usedAI: true };
    }

    log.warn({ url, error: aiResult.error, code: aiResult.code }, "AI fallback extraction failed");
  }

  log.error({ url }, "All extraction methods failed");
  throw new Error("Cannot parse recipe.");
}

export async function isPageLikelyRecipe(html: string): Promise<boolean> {
  const lowered = html.toLowerCase();
  const indicators = await getContentIndicators();

  const hasSchema = indicators.schemaIndicators.some((i) => lowered.includes(i.toLowerCase()));

  const hasContentHints =
    indicators.contentIndicators.filter((i) => lowered.includes(i.toLowerCase())).length >= 2;

  return hasSchema || hasContentHints;
}
