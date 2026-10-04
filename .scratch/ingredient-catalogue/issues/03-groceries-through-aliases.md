# 03: Groceries and recurring groceries through aliases

**What to build:** Groceries and recurring groceries point at an alias. A grocery typed by hand, a recurring grocery, a grocery added from a recipe and a grocery added offline (resolved on Replay) all resolve through the resolver and keep their free-text name as the as-written text shown on the list. "Uien" typed on a phone resolves to the same Ingredient as "onions" from a recipe. This is the *migrate* step for groceries: existing rows are resolved from their name, and store and aisle lookups still use the folded-name keys until 04.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Grocery create and rename, and recurring grocery create and rename, resolve through the resolver and store the alias.
- [ ] A grocery from a recipe line takes that line's alias.
- [ ] Replaying an offline create or rename resolves on the server. Replay stays idempotent.
- [ ] Existing groceries and recurring groceries gain an alias in a migration, and the text shown on the list is unchanged.
- [ ] Grocery merging of same-unit adds still behaves as before.
