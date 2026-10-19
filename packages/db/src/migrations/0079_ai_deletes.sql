-- AI deletes tools, foods that name nothing and Junk Lines as AI Changes (ADR-0037): a deleted
-- food's change has no food to list under, and a Junk Line's is listed under its recipe.
ALTER TABLE "ingredient_ai_changes" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredient_ai_changes" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "ingredient_ai_changes" ADD CONSTRAINT "ingredient_ai_changes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ingredient_ai_changes_recipe_id" ON "ingredient_ai_changes" USING btree ("recipe_id");