# 07: AI runs by itself in the background

**What to build:** No person starts AI any more.

- **After every mint:** the ingredient review queue runs the pass from 06 on the new foods. The minted-food port feeds it, as it feeds the new-ingredients queue today. The pass follows the AI switch, and uses the Decision where the ingredient-resolution Decision Use is on.
- **At import:** an unsure "same" answer now joins the known food and records an unsure AI Change. Today it mints a flagged duplicate.
- **Icons:** drawing an icon is a separate job on the existing icons queue, queued at the end of a pass for foods that still exist and show no icon, when "Draw an icon" is on. The new-ingredients queue is deleted. The "Clean the name" option under Automatic for new ingredients goes, since naming is part of the pass.
- **Nightly:** the scheduled task queues the pass for foods flagged because AI was unavailable or its key refused. It also sweeps sure AI Changes older than a month. Undone ones are kept as memory, and unsure ones stay until handled.
- **Buttons:** Ask AI, Find parent with AI and the Fix catalogue round are removed from the Ingredients page. Draw icons stays.

See ADR-0037's first 2026-10-17 amendment.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A recipe import that mints a food queues one pass, which applies AI's answer with no person involved.
- [ ] An unsure "same" at import joins the food, and the food shows the unsure change.
- [ ] The icon job is queued only for foods that survive the pass without an icon, and only when "Draw an icon" is on. A merged food is never drawn.
- [ ] The new-ingredients queue, its worker, its producer and the "Clean the name" setting are gone. A server config that still holds the setting loads without error.
- [ ] The nightly task re-asks foods flagged for an unreachable AI, and skips them with AI off.
- [ ] Sure AI Changes older than 30 days are swept; undone and unhandled unsure ones stay.
- [ ] The Ask AI, Find parent with AI and Fix catalogue buttons, the Fix catalogue modal and their translations are gone. Its component test is deleted.
- [ ] Every worker wraps its processor for the model ledger.
- [ ] Worker tests cover the queue order (pass, then icons). All `CONTRIBUTING.md` gates pass, and the `ai` E2E project stays green.
