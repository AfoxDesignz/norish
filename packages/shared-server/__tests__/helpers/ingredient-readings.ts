/** What the language model answers when the AI pass reads a name, as `generateStructured` returns it. */
const NO_READING = {
  englishName: null,
  generalFood: null,
  otherNames: null,
  parts: null,
  joined: null,
};

/** A name read as one food. */
export function foodReading(reading: {
  englishName: string | null;
  generalFood: string | null;
  otherNames?: string[];
  sure: boolean;
}) {
  return { ...NO_READING, verdict: "food", ...reading };
}

/** A name read as several foods. */
export function severalReading(
  parts: string[],
  joined: "together" | "alternatives",
  sure: boolean
) {
  return { ...NO_READING, verdict: "several", parts, joined, sure };
}

/** A name read as no food. */
export function noFoodReading(sure: boolean) {
  return { ...NO_READING, verdict: "not-a-food", sure };
}
