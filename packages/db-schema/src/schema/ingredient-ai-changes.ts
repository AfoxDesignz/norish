import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { recipeIngredientJoinEnum } from "./recipe-ingredients";
import type { measurementSystemEnum } from "./recipes";
import { ingredients } from "./ingredients";
import { recipes } from "./recipes";

/** A food AI deleted, its spellings and the rows that named it, for Undo to mint it again under its ids. */
export interface DeletedFood {
  ingredientId: string;
  name: string;
  ownerId: string | null;
  parentId: string | null;
  aliases: Array<{
    id: string;
    text: string;
    fold: string;
    locale: string | null;
    ownerId: string | null;
  }>;
  lineFoods: Array<{ lineId: string; position: number; aliasId: string }>;
  groceries: Array<{ id: string; aliasId: string | null }>;
  recurring: Array<{ id: string; aliasId: string | null }>;
}

/** A recipe line AI deleted as a Junk Line; `fold` is its clean spelling, which Undo remembers as not junk. */
export interface DeletedLine {
  id: string;
  name: string;
  joined: (typeof recipeIngredientJoinEnum.enumValues)[number] | null;
  amount: string | null;
  unit: string | null;
  order: string | null;
  systemUsed: (typeof measurementSystemEnum.enumValues)[number];
  aliasIds: string[];
  fold: string;
}

/** What Undo needs per kind of AI Change; a parent's `fromWords` says the name's words gave it, not AI. */
export type AIChangeUndo =
  | {
      kind: "merge";
      name: string;
      ownerId: string | null;
      aliasIds: string[];
      parentId: string | null;
    }
  | { kind: "parent"; formerParentId: string | null; fromWords?: boolean }
  | { kind: "plain-name"; formerName: string; name: string }
  | { kind: "tool" | "not-a-food"; food: DeletedFood }
  | { kind: "junk-line"; line: DeletedLine };

/**
 * AI Changes (CONTEXT.md): under `ingredientId` (naming `targetId`), or a Junk Line's `recipeId`; a
 * deleted food's food is in `undo`. An undone row stays, so AI never makes that change again.
 */
export const ingredientAIChanges = pgTable(
  "ingredient_ai_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    ingredientId: uuid("ingredient_id").references(() => ingredients.id, { onDelete: "cascade" }),
    targetId: uuid("target_id").references(() => ingredients.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "cascade" }),
    sure: boolean("sure").notNull(),
    undo: jsonb("undo").$type<AIChangeUndo>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    keptAt: timestamp("kept_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_ingredient_ai_changes_ingredient_id").on(t.ingredientId),
    index("idx_ingredient_ai_changes_recipe_id").on(t.recipeId),
    index("idx_ingredient_ai_changes_created_at").on(t.createdAt),
  ]
);
