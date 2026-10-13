import React, { Fragment } from "react";

// The app's own list, so a new language shows up here on the next docs build.
import { LOCALE_CATALOG } from "../../../../packages/i18n/src/locales";

/** The flag of the country a language is most at home in (CLDR's likely region: en → US). */
function flag(code: string) {
  const region = new Intl.Locale(code).maximize().region ?? "";

  return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** Every language Norish ships, by its own name; variants of one language (Sie and Du) count once. */
export default function Languages() {
  const byLanguage = new Map<string, { code: string; name: string }[]>();
  for (const [code, { name }] of Object.entries(LOCALE_CATALOG)) {
    const language = code.split("-")[0];
    byLanguage.set(language, [...(byLanguage.get(language) ?? []), { code, name }]);
  }
  const languages = [...byLanguage.values()].map((variants) => ({
    flag: flag(variants[0].code),
    name: variants.length > 1 ? variants[0].name.replace(/\s*\(.*\)$/, "") : variants[0].name,
  }));

  return (
    <>
      Norish is available in {languages.length} languages:{" "}
      {languages.map(({ flag, name }, index) => (
        <Fragment key={name}>
          {index > 0 && ", "}
          {/* A flag never wraps away from its language. */}
          <span className="whitespace-nowrap">
            {flag} {name}
          </span>
        </Fragment>
      ))}
      .
    </>
  );
}
