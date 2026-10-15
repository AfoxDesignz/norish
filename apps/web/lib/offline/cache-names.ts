/**
 * Cache Storage names shared by the service worker and window-context code.
 *
 * The Cache Warmer writes warmed primary images into the same bounded cache
 * the service worker's image route reads (ADR-0009), so the name must be a
 * single definition both bundles import.
 */
export const IMAGE_CACHE_NAME = "norish-images";
export const IMAGE_CACHE_MAX_ENTRIES = 512;
export const IMAGE_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Serwist's runtime caches of visited pages' documents and RSC payloads (its PAGES_CACHE_NAME). */
export const PAGE_CACHE_NAMES = ["pages-rsc-prefetch", "pages-rsc", "pages"];

/**
 * Drop the runtime image and page caches. Cached images and pages (a recipe page carries its
 * recipe) are personalized household data (ADR-0005), so account transitions clear them
 * alongside the read cache; entries carry no owner tag, so the unit is the whole cache.
 */
export async function deletePersonalCaches(): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }

  // Cache Storage unavailable: nothing personalized is retrievable anyway.
  await Promise.allSettled(
    [IMAGE_CACHE_NAME, ...PAGE_CACHE_NAMES].map(async (name) => caches.delete(name))
  );
}
