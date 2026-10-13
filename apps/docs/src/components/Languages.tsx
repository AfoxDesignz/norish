import React from "react";

// The app's own list, so a new language shows up here on the next docs build.
import { LOCALE_CATALOG } from "../../../../packages/i18n/src/locales";

/** Every language Norish ships, by its own name; variants of one language (Sie and Du) count once. */
export default function Languages() {
  const byLanguage = new Map<string, string[]>();
  for (const [code, { name }] of Object.entries(LOCALE_CATALOG)) {
    const language = code.split("-")[0];
    byLanguage.set(language, [...(byLanguage.get(language) ?? []), name]);
  }
  const names = [...byLanguage.values()].map((variants) =>
    variants.length > 1 ? variants[0].replace(/\s*\(.*\)$/, "") : variants[0]
  );

  return (
    <>
      Norish is available in {names.length} languages: {names.join(", ")}.
    </>
  );
}
