# 19: Deleting a food resolves its rows again

**What to build:** Deleting a food resolves each recipe line, Grocery and recurring grocery that pointed at it again from its own text, with AI off and minting nothing. Today they all point at no food. Without the deleted food blocking the whole match, the words can split a line:

- "zout en peper" and "salt and pepper", merged into a "kruidenmix" that is then deleted, point at zout + peper;
- a text another food knows whole points at that food;
- everything else ("kruidenmix" itself) points at no food, so a delete still never mints the food back.

Pantry Ingredients are still deleted, since they have no text. The resolving is the first-start cleanup's step 3 (`resolveAgain` in `first-start-cleanup.ts`), moved into the catalogue so both use it, with a resolver option that leaves no food where it would mint.

The nightly sweep needs nothing: what it deletes names nothing.

**Blocked by:** 02, 09

**Status:** ready-for-agent

- [ ] Deleting a food whose translations are "zout en peper" and "salt and pepper" points those lines and groceries at zout + peper. A "kruidenmix" line points at no food, and no food is minted.
- [ ] A line whose text another food knows whole points at that food after the delete.
- [ ] The delete dialog's counts still say what the delete touches.
- [ ] All `CONTRIBUTING.md` gates pass.
