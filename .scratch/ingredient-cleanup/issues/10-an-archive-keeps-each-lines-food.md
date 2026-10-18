# 10: An archive keeps each line's food

**What to build:** A Recipe Archive round trip keeps the foods each recipe line names, not only its text. Today the Norish writer exports a line's text with `ingredientId: null` (`packages/shared-server/src/archive/norish-writer.ts`), and import resolves the food again from that text. So a line whose text is no longer a spelling of its food imports as a new food when AI is off. Ticket 03 makes that common: removing a spelling moves its lines onto another spelling of the same food.

The writer exports each line's foods as the spellings they point at, in order. The Norish parser hands them to the resolver, the way the Mealie and Tandoor importers already hand over `foodText` (`withLineFoodTexts` in `parser-helpers.ts`).

**Blocked by:** 04, so the archive carries every food a line names.

**Status:** ready-for-agent

- [ ] A line whose spelling was removed, its food kept under another spelling, round-trips to the same food with AI off.
- [ ] A line naming several foods round-trips with all of them, in order.
- [ ] An archive without foods imports as it does today.
- [ ] All `CONTRIBUTING.md` gates pass.
