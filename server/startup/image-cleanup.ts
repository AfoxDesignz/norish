import fs from "fs/promises";
import path from "path";

import { db } from "../db/drizzle";
import { recipes, recipeImages } from "../db/schema";
import { getAllUserAvatars } from "../db/repositories";

import { SERVER_CONFIG } from "@/config/env-config-server";
import { schedulerLogger } from "@/server/logger";

const RECIPES_DISK_DIR = path.join(SERVER_CONFIG.UPLOADS_DIR, "recipes");
const AVATARS_DISK_DIR = path.join(SERVER_CONFIG.UPLOADS_DIR, "avatars");

// URL pattern for per-recipe images: /recipes/{recipeId}/{filename}
const RECIPE_IMAGE_URL_PATTERN = /^\/recipes\/([a-f0-9-]{36})\/([^/]+)$/i;

/**
 * Clean up orphaned recipe images that aren't referenced in the database.
 * Scans per-recipe directories and removes files not in recipes.image or recipe_images.image.
 */
export async function cleanupOrphanedImages(): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  try {
    // Get all subdirectories in uploads/recipes/
    let entries;

    try {
      entries = await fs.readdir(RECIPES_DISK_DIR, { withFileTypes: true });
    } catch {
      // Directory doesn't exist, nothing to clean up
      return { deleted: 0, errors: 0 };
    }

    // Filter to recipe directories only (skip 'images' legacy dir if it exists)
    const recipeIdDirs = entries.filter((e) => e.isDirectory() && e.name !== "images");

    if (recipeIdDirs.length === 0) {
      schedulerLogger.info("No recipe directories found");

      return { deleted: 0, errors: 0 };
    }

    // Get all existing recipe IDs from database
    const existingRecipes = await db.select({ id: recipes.id }).from(recipes);
    const existingRecipeIds = new Set(existingRecipes.map((r) => r.id));

    // Get all image URLs from database - both recipes.image and recipe_images.image
    const [allRecipes, allGalleryImages] = await Promise.all([
      db.select({ id: recipes.id, image: recipes.image }).from(recipes),
      db.select({ recipeId: recipeImages.recipeId, image: recipeImages.image }).from(recipeImages),
    ]);

    // Build map of recipeId -> Set of referenced filenames
    const referencedFiles = new Map<string, Set<string>>();

    // From recipes.image
    for (const r of allRecipes) {
      if (r.image) {
        const match = r.image.match(RECIPE_IMAGE_URL_PATTERN);

        if (match) {
          const [, recipeId, filename] = match;

          if (!referencedFiles.has(recipeId)) {
            referencedFiles.set(recipeId, new Set());
          }
          referencedFiles.get(recipeId)!.add(filename);
        }
      }
    }

    // From recipe_images.image
    for (const img of allGalleryImages) {
      const match = img.image.match(RECIPE_IMAGE_URL_PATTERN);

      if (match) {
        const [, recipeId, filename] = match;

        if (!referencedFiles.has(recipeId)) {
          referencedFiles.set(recipeId, new Set());
        }
        referencedFiles.get(recipeId)!.add(filename);
      }
    }

    // Scan each recipe directory
    for (const dir of recipeIdDirs) {
      const recipeId = dir.name;
      const recipeDir = path.join(RECIPES_DISK_DIR, recipeId);

      // If recipe doesn't exist in DB, the whole directory is handled by cleanupOrphanedStepImages
      if (!existingRecipeIds.has(recipeId)) {
        continue;
      }

      try {
        const files = await fs.readdir(recipeDir);
        const imageFiles = files.filter(
          (f) =>
            !f.includes("/") &&
            (f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".png") || f.endsWith(".webp"))
        );

        const referenced = referencedFiles.get(recipeId) || new Set();

        for (const file of imageFiles) {
          if (!referenced.has(file)) {
            try {
              const filePath = path.join(recipeDir, file);

              await fs.unlink(filePath);
              deleted++;
              schedulerLogger.info({ recipeId, file }, "Deleted orphaned recipe image");
            } catch (err) {
              errors++;
              schedulerLogger.error({ err, recipeId, file }, "Error deleting image");
            }
          }
        }
      } catch (err) {
        schedulerLogger.error({ err, recipeId }, "Error scanning recipe directory");
        errors++;
      }
    }

    schedulerLogger.info({ deleted, errors }, "Image cleanup complete");
  } catch (err) {
    schedulerLogger.error({ err }, "Fatal error during image cleanup");
    errors++;
  }

  return { deleted, errors };
}

/**
 * Delete a specific image file by URL.
 * URL format: /recipes/{recipeId}/{filename}
 */
export async function deleteImageByUrl(imageUrl: string | null | undefined): Promise<void> {
  if (!imageUrl) {
    return;
  }

  const match = imageUrl.match(RECIPE_IMAGE_URL_PATTERN);

  if (!match) {
    schedulerLogger.warn({ imageUrl }, "Invalid recipe image URL format");

    return;
  }

  const [, recipeId, filename] = match;
  const filePath = path.join(RECIPES_DISK_DIR, recipeId, filename);

  try {
    await fs.unlink(filePath);
    schedulerLogger.info({ recipeId, filename }, "Deleted image");
  } catch (err) {
    // Ignore errors (file might not exist)
    schedulerLogger.warn({ err, recipeId, filename }, "Could not delete image");
  }
}

/**
 * Clean up orphaned avatar images that aren't referenced in the database
 */
export async function cleanupOrphanedAvatars(): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  try {
    // Get all avatar files from disk
    let files;

    try {
      files = await fs.readdir(AVATARS_DISK_DIR);
    } catch {
      // Directory doesn't exist, nothing to clean up
      return { deleted: 0, errors: 0 };
    }

    const avatarFiles = files.filter(
      (f) =>
        f.endsWith(".jpg") ||
        f.endsWith(".jpeg") ||
        f.endsWith(".png") ||
        f.endsWith(".webp") ||
        f.endsWith(".gif")
    );

    if (avatarFiles.length === 0) {
      schedulerLogger.info("No avatar images found");

      return { deleted: 0, errors: 0 };
    }

    // Get all users with avatars from database
    const usersWithAvatars = await getAllUserAvatars();

    // Extract filenames from encrypted paths
    // Avatar paths are stored encrypted but follow pattern /avatars/{userId}.{ext}
    const usedAvatars = new Set<string>();

    for (const user of usersWithAvatars) {
      if (user.image) {
        // The encrypted field contains the path pattern, extract potential filename
        // Avatars use pattern: {userId}.{ext}
        // Since we store encrypted paths, we need to check which files match user IDs
        const userIdPattern = `${user.userId}.`;
        const matchingFiles = avatarFiles.filter((f) => f.startsWith(userIdPattern));

        matchingFiles.forEach((f) => usedAvatars.add(f));
      }
    }

    schedulerLogger.info(
      { total: avatarFiles.length, referenced: usedAvatars.size },
      "Found avatar files"
    );

    // Delete orphaned avatars
    for (const file of avatarFiles) {
      if (!usedAvatars.has(file)) {
        try {
          const filePath = path.join(AVATARS_DISK_DIR, file);

          await fs.unlink(filePath);
          deleted++;
          schedulerLogger.info({ file }, "Deleted orphaned avatar");
        } catch (err) {
          errors++;
          schedulerLogger.error({ err, file }, "Error deleting avatar");
        }
      }
    }

    schedulerLogger.info({ deleted, errors }, "Avatar cleanup complete");
  } catch (err) {
    schedulerLogger.error({ err }, "Fatal error during avatar cleanup");
    errors++;
  }

  return { deleted, errors };
}

/**
 * Delete a specific avatar file by filename
 */
export async function deleteAvatarByFilename(filename: string | null | undefined): Promise<void> {
  if (!filename) {
    return;
  }

  const filePath = path.join(AVATARS_DISK_DIR, filename);

  try {
    await fs.unlink(filePath);
    schedulerLogger.info({ filename }, "Deleted avatar");
  } catch (err) {
    // Ignore errors (file might not exist)
    schedulerLogger.warn({ err, filename }, "Could not delete avatar");
  }
}

/**
 * Clean up orphaned step images and recipe directories for deleted recipes.
 * Deletes entire per-recipe directories when the recipe no longer exists.
 */
export async function cleanupOrphanedStepImages(): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  try {
    // Get all subdirectories in uploads/recipes/
    let entries;

    try {
      entries = await fs.readdir(RECIPES_DISK_DIR, { withFileTypes: true });
    } catch {
      // Directory doesn't exist, nothing to clean up
      return { deleted: 0, errors: 0 };
    }

    // Filter to directories only (skip 'images' legacy dir if it exists)
    const recipeIdDirs = entries.filter((e) => e.isDirectory() && e.name !== "images");

    if (recipeIdDirs.length === 0) {
      return { deleted: 0, errors: 0 };
    }

    // Get all existing recipe IDs from database
    const existingRecipes = await db.select({ id: recipes.id }).from(recipes);
    const existingRecipeIds = new Set(existingRecipes.map((r) => r.id));

    schedulerLogger.info(
      { totalDirs: recipeIdDirs.length, existingRecipes: existingRecipeIds.size },
      "Checking recipe directories"
    );

    // Delete directories for recipes that no longer exist
    for (const dir of recipeIdDirs) {
      const recipeId = dir.name;

      if (!existingRecipeIds.has(recipeId)) {
        try {
          const dirPath = path.join(RECIPES_DISK_DIR, recipeId);

          await fs.rm(dirPath, { recursive: true, force: true });
          deleted++;
          schedulerLogger.info({ recipeId }, "Deleted orphaned recipe directory");
        } catch (err) {
          errors++;
          schedulerLogger.error({ err, recipeId }, "Error deleting recipe directory");
        }
      }
    }

    schedulerLogger.info({ deleted, errors }, "Recipe directory cleanup complete");
  } catch (err) {
    schedulerLogger.error({ err }, "Fatal error during recipe directory cleanup");
    errors++;
  }

  return { deleted, errors };
}
