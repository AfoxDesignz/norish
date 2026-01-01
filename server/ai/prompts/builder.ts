/**
 * Prompt construction utilities.
 *
 * Provides helpers for building AI prompts from templates and fragments.
 */

import { loadPrompt, fillPrompt } from "./loader";
import { buildAllergyInstruction, type AllergyInstructionOptions } from "./fragments/allergies";

export interface RecipeExtractionPromptOptions {
  /**
   * Source URL of the recipe (optional).
   */
  url?: string;

  /**
   * List of allergens to detect in the recipe.
   */
  allergies?: string[];

  /**
   * Use strict allergy detection mode.
   * @default false for image/video, true for HTML/text
   */
  strictAllergyDetection?: boolean;

  /**
   * Additional context to append to the prompt.
   */
  additionalContext?: string;
}

export interface VideoExtractionPromptOptions extends RecipeExtractionPromptOptions {
  /**
   * Video title from metadata.
   */
  title: string;

  /**
   * Video description (optional).
   */
  description?: string;

  /**
   * Video duration in seconds.
   */
  duration: number;

  /**
   * Video uploader/creator name (optional).
   */
  uploader?: string;
}

/**
 * Build a recipe extraction prompt for HTML/text content.
 *
 * @param content - The sanitized webpage text or content to extract from.
 * @param options - Prompt configuration options.
 * @returns The complete prompt string ready for the AI model.
 */
export async function buildRecipeExtractionPrompt(
  content: string,
  options: RecipeExtractionPromptOptions = {}
): Promise<string> {
  const { url, allergies, strictAllergyDetection = true, additionalContext } = options;

  const basePrompt = await loadPrompt("recipe-extraction");
  const allergyInstruction = buildAllergyInstruction(allergies, { strict: strictAllergyDetection });

  const parts = [basePrompt, allergyInstruction];

  if (url) {
    parts.push(`URL: ${url}`);
  }

  parts.push(`WEBPAGE TEXT:\n${content}`);

  if (additionalContext) {
    parts.push(additionalContext);
  }

  return parts.join("\n");
}

/**
 * Build a recipe extraction prompt for image-based extraction.
 *
 * @param allergies - List of allergens to detect.
 * @returns The prompt string to use with image content.
 */
export async function buildImageExtractionPrompt(allergies?: string[]): Promise<string> {
  const basePrompt = await loadPrompt("recipe-extraction");

  // Modify prompt for image context
  const imagePrompt = basePrompt
    .replace(
      "You will receive the contents of a webpage or video transcript",
      "You will receive images of a recipe (such as photos of a cookbook, printed recipe, or recipe card)"
    )
    .replace("reads website data", "reads recipe images");

  const allergyInstruction = buildAllergyInstruction(allergies, { strict: false });

  return `${imagePrompt}${allergyInstruction}

Analyze the provided images and extract the complete recipe data. If multiple images are provided, they represent different pages/parts of the same recipe - combine them into a single complete recipe.`;
}

/**
 * Build a recipe extraction prompt for video transcript extraction.
 *
 * @param transcript - The video transcript text.
 * @param options - Video metadata and extraction options.
 * @returns The complete prompt string ready for the AI model.
 */
export async function buildVideoExtractionPrompt(
  transcript: string,
  options: VideoExtractionPromptOptions
): Promise<string> {
  const { url, title, description, duration, uploader, allergies } = options;

  const basePrompt = await loadPrompt("recipe-extraction");
  const allergyInstruction = buildAllergyInstruction(allergies, { strict: false });

  const durationMinutes = Math.floor(duration / 60);
  const durationSeconds = (duration % 60).toString().padStart(2, "0");

  const parts = [
    basePrompt,
    allergyInstruction,
    "",
    `SOURCE: Video transcript (${title})`,
    `URL: ${url}`,
    `TITLE: ${title}`,
    `DESCRIPTION: ${description || "No description provided"}`,
    `DURATION: ${durationMinutes}:${durationSeconds}`,
  ];

  if (uploader) {
    parts.push(`UPLOADER: ${uploader}`);
  }

  parts.push(
    "",
    "VIDEO TRANSCRIPT:",
    transcript,
    "",
    "NOTE: This is a video transcript, not webpage text. Extract the recipe from the spoken content. If amounts are not specified, estimate typical quantities for the dish type."
  );

  return parts.join("\n");
}

// Re-export from loader for convenience
export { loadPrompt, fillPrompt };
