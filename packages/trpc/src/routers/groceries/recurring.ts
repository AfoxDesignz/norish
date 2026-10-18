import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { GroceryIngredientColumns } from "@norish/shared-server/ingredients/groceries";
import type { GroceryInsertDto, RecurringGroceryDto } from "@norish/shared/contracts";
import { assertHouseholdAccess } from "@norish/auth/permissions";
import { createGrocery } from "@norish/db";
import {
  checkRecurringGrocery,
  createRecurringGrocery,
  deleteRecurringGroceryById,
  detachRecurringGrocery,
  getRecurringGroceryById,
  getRecurringGroceryOwnerId,
  updateRecurringGroceryWithGrocery,
} from "@norish/db/repositories/recurring-groceries";
import { getUnits } from "@norish/shared-server/config/server-config-loader";
import { groceryPartsOf, resolveGroceryName } from "@norish/shared-server/ingredients/groceries";
import { writeResolved } from "@norish/shared-server/ingredients/resolver";
import { trpcLogger as log } from "@norish/shared-server/logger";
import { groceries } from "@norish/shared-server/realtime/groceries";
import { RECURRENCE_RULES, recurrencePatternOf } from "@norish/shared/contracts/recurrence";
import {
  clientMintedId,
  DetachRecurringGroceryInputSchema,
  PurchaseAmountSchema,
} from "@norish/shared/contracts/zod";
import { parseIngredientWithDefaults } from "@norish/shared/lib/helpers";
import { calculateNextOccurrence, getTodayString } from "@norish/shared/lib/recurrence/calculator";

import type { GroceryProcedureContext } from "./groceries-helpers";
import { authedProcedure } from "../../middleware";
import { router } from "../../trpc";
import { noticeGroceries } from "../stores/pricing";
import { createGroceriesData, rememberStorePreference } from "./groceries-helpers";

/** A recurring grocery to create: its id, name, amount and rule, and its first grocery's Store. */
type RecurringOf = Pick<
  RecurringGroceryDto,
  | "id"
  | "name"
  | "amount"
  | "unit"
  | "recurrenceRule"
  | "recurrenceInterval"
  | "recurrenceWeekday"
  | "nextPlannedFor"
> & { storeId?: string | null; purchaseAmount?: number | null };

/** Create a recurring grocery and the grocery it puts on the list, and tell the household. */
async function createRecurringOf(ctx: GroceryProcedureContext, recurring: RecurringOf) {
  const id = crypto.randomUUID();
  const recurringData = {
    id: recurring.id,
    userId: ctx.user.id,
    name: recurring.name,
    amount: recurring.amount,
    unit: recurring.unit,
    recurrenceRule: recurring.recurrenceRule,
    recurrenceInterval: recurring.recurrenceInterval,
    recurrenceWeekday: recurring.recurrenceWeekday,
    nextPlannedFor: recurring.nextPlannedFor,
    lastCheckedDate: null,
  };
  const created = await writeResolved(
    () => resolveGroceryName({ name: recurring.name }, { userId: ctx.user.id }),
    (ingredient) =>
      createRecurringGrocery({
        ...recurringData,
        ingredientAliasId: ingredient.ingredientAliasId,
        ingredientId: ingredient.ingredientId,
      })
  );
  // The grocery asks again: an exact alias match, unless the food moved
  // in between, in which case it follows.
  const groceryOf = (ingredient: GroceryIngredientColumns): GroceryInsertDto => ({
    userId: ctx.user.id,
    name: created.name,
    ingredientAliasId: ingredient.ingredientAliasId,
    ingredientId: ingredient.ingredientId,
    unit: created.unit || null,
    amount: created.amount,
    purchaseAmount: recurring.purchaseAmount,
    isDone: false,
    recurringGroceryId: created.id,
    recipeIngredientId: null,
    storeId: recurring.storeId ?? null,
  });

  const { created: grocery, shifted } = await writeResolved(
    () => resolveGroceryName({ name: created.name }, { userId: ctx.user.id }),
    (ingredient) => createGrocery(id, groceryOf(ingredient), ctx.userIds)
  );

  // A repeating grocery is a grocery on the list like any other: its Store
  // is asked what it knows about the name, exactly as the add panel asks.
  await noticeGroceries(ctx, [grocery]);

  log.info(
    { userId: ctx.user.id, recurringId: created.id, groceryId: id },
    "Recurring grocery created"
  );
  // The siblings it made room among carry new versions now; every screen
  // hears so, or its next write on one of them is refused as stale.
  if (shifted.length > 0) {
    void groceries.publish(
      "updated",
      {
        changedGroceries: shifted,
      },
      { householdKey: ctx.householdKey }
    );
  }
  void groceries.publish(
    "recurringCreated",
    {
      recurringGrocery: created,
      grocery,
    },
    { householdKey: ctx.householdKey }
  );

  return { recurringGrocery: created, grocery, shifted };
}

const createRecurring = authedProcedure
  .input(
    z.object({
      id: clientMintedId,
      name: z.string(),
      amount: z.number().nullable(),
      unit: z.string().nullable(),
      recurrenceRule: z.enum(RECURRENCE_RULES),
      recurrenceInterval: z.number().min(1),
      recurrenceWeekday: z.number().nullable(),
      nextPlannedFor: z.string(),
      storeId: z.uuid().nullable().optional(),
      purchaseAmount: PurchaseAmountSchema,
    })
  )
  .mutation(async ({ ctx, input }) => {
    log.info(
      { userId: ctx.user.id, rule: input.recurrenceRule, interval: input.recurrenceInterval },
      "Creating recurring grocery"
    );

    try {
      // A name whose words join foods repeats each on its rule, the first under the client's id.
      const [name, ...others] = await groceryPartsOf({ name: input.name });
      const created = await createRecurringOf(ctx, {
        ...input,
        id: input.id ?? crypto.randomUUID(),
        name,
      });

      for (const other of others) {
        await createRecurringOf(ctx, { ...input, id: crypto.randomUUID(), name: other });
      }

      return created;
    } catch (err) {
      log.error({ err, userId: ctx.user.id }, "Failed to create recurring grocery");
      void groceries.publish(
        "failed",
        {
          reason: "Failed to create recurring grocery",
        },
        { userId: ctx.user.id }
      );
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create recurring grocery",
      });
    }
  });

const updateRecurring = authedProcedure
  .input(
    z.object({
      recurringGroceryId: z.string(),
      recurringVersion: z.number().int().positive(),
      groceryId: z.string(),
      groceryVersion: z.number().int().positive(),
      storeId: z.uuid().nullable().optional(),
      purchaseAmount: PurchaseAmountSchema,
      data: z.object({
        name: z.string().optional(),
        amount: z.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        recurrenceRule: z.enum(RECURRENCE_RULES).optional(),
        recurrenceInterval: z.number().min(1).optional(),
        recurrenceWeekday: z.number().nullable().optional(),
        nextPlannedFor: z.string().optional(),
      }),
    })
  )
  .mutation(({ ctx, input }) => {
    const { recurringGroceryId, recurringVersion, groceryId, groceryVersion, storeId, data } =
      input;

    log.debug({ userId: ctx.user.id, recurringGroceryId, groceryId }, "Updating recurring grocery");

    getRecurringGroceryOwnerId(recurringGroceryId)
      .then(async (ownerId) => {
        if (!ownerId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recurring grocery not found",
          });
        }

        await assertHouseholdAccess(ctx.user.id, ownerId);

        // A new name is resolved, and the grocery on the list takes the same answer; one
        // joining foods renames it to the first and repeats the rest on its rule.
        const [name, ...others] =
          data.name === undefined
            ? [undefined]
            : await groceryPartsOf({ name: data.name, groceryId });
        const outcome = await writeResolved(
          async () =>
            name !== undefined
              ? await resolveGroceryName({ name, groceryId }, { userId: ctx.user.id })
              : null,
          (ingredient) =>
            updateRecurringGroceryWithGrocery(
              {
                id: recurringGroceryId,
                version: recurringVersion,
                ...data,
                name,
                // An unchanged name keeps the food it had.
                ingredientAliasId: ingredient?.ingredientAliasId,
                ingredientId: ingredient?.ingredientId,
              },
              {
                id: groceryId,
                version: groceryVersion,
                storeId,
                purchaseAmount: input.purchaseAmount,
              }
            )
        );

        if (outcome.stale) {
          log.info(
            { userId: ctx.user.id, recurringGroceryId, groceryId },
            "Stale recurring grocery update; requesting client refresh"
          );
          void groceries.publish(
            "stale",
            {
              reason: "Recurring grocery was updated elsewhere",
            },
            { householdKey: ctx.householdKey }
          );

          return;
        }

        await rememberStorePreference(ctx.user.id, outcome.value.grocery.ingredientId, storeId);

        // Renamed or moved, the grocery asks its Store a new question.
        await noticeGroceries(ctx, [outcome.value.grocery]);

        log.debug(
          { userId: ctx.user.id, recurringGroceryId, groceryId },
          "Recurring grocery updated"
        );
        void groceries.publish(
          "recurringUpdated",
          {
            recurringGrocery: outcome.value.recurringGrocery,
            grocery: outcome.value.grocery,
          },
          { householdKey: ctx.householdKey }
        );

        for (const other of others) {
          await createRecurringOf(ctx, {
            ...outcome.value.recurringGrocery,
            id: crypto.randomUUID(),
            name: other,
          });
        }
      })
      .catch((err) => {
        log.error(
          { err, userId: ctx.user.id, recurringGroceryId },
          "Failed to update recurring grocery"
        );
        void groceries.publish(
          "failed",
          {
            reason: err.message || "Failed to update recurring grocery",
          },
          { userId: ctx.user.id }
        );
      });

    return { success: true };
  });

const detachRecurring = authedProcedure
  .input(DetachRecurringGroceryInputSchema)
  .mutation(({ ctx, input }) => {
    const { recurringGroceryId, recurringVersion, groceryId, groceryVersion, raw, storeId } = input;

    log.info({ userId: ctx.user.id, recurringGroceryId, groceryId }, "Detaching recurring grocery");

    getRecurringGroceryOwnerId(recurringGroceryId)
      .then(async (ownerId) => {
        if (!ownerId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recurring grocery not found",
          });
        }

        await assertHouseholdAccess(ctx.user.id, ownerId);

        const units = await getUnits();
        const parsedIngredient = parseIngredientWithDefaults(raw, units)[0];

        if (!parsedIngredient) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid grocery data",
          });
        }

        // A new name joining foods keeps the grocery as the first and puts the rest on the list.
        const [name, ...others] = await groceryPartsOf({
          name: parsedIngredient.description,
          groceryId,
        });
        const outcome = await writeResolved(
          () => resolveGroceryName({ name, groceryId }, { userId: ctx.user.id }),
          (ingredient) =>
            detachRecurringGrocery({
              recurringGroceryId,
              recurringVersion,
              grocery: {
                id: groceryId,
                version: groceryVersion,
                name,
                ingredientAliasId: ingredient.ingredientAliasId,
                ingredientId: ingredient.ingredientId,
                unit: parsedIngredient.unitOfMeasure,
                amount: parsedIngredient.quantity ?? null,
                purchaseAmount: input.purchaseAmount,
                ...(storeId !== undefined ? { storeId } : {}),
              },
            })
        );

        if (outcome.stale) {
          log.info(
            { userId: ctx.user.id, recurringGroceryId, groceryId },
            "Stale recurring grocery detach; requesting client refresh"
          );
          void groceries.publish(
            "stale",
            {
              reason: "Grocery was updated elsewhere",
            },
            { householdKey: ctx.householdKey }
          );

          return;
        }

        await rememberStorePreference(ctx.user.id, outcome.value.ingredientId, storeId);

        // Detaching edits the grocery too — a new name or Store is a new question.
        await noticeGroceries(ctx, [outcome.value]);

        log.info(
          { userId: ctx.user.id, recurringGroceryId, groceryId },
          "Recurring grocery detached"
        );
        void groceries.publish(
          "recurringDeleted",
          {
            recurringGroceryId,
          },
          { householdKey: ctx.householdKey }
        );
        void groceries.publish(
          "updated",
          {
            changedGroceries: [outcome.value],
          },
          { householdKey: ctx.householdKey }
        );

        if (others.length > 0) {
          await createGroceriesData(
            ctx,
            others.map((other) => ({
              name: other,
              amount: parsedIngredient.quantity ?? null,
              unit: parsedIngredient.unitOfMeasure,
              isDone: false,
            }))
          );
        }
      })
      .catch((err) => {
        log.error(
          { err, userId: ctx.user.id, recurringGroceryId },
          "Failed to detach recurring grocery"
        );
        void groceries.publish(
          "failed",
          {
            reason: err.message || "Failed to detach recurring grocery",
          },
          { userId: ctx.user.id }
        );
      });

    return { success: true };
  });

const deleteRecurring = authedProcedure
  .input(
    z.object({
      recurringGroceryId: z.string(),
      version: z.number().int().positive(),
    })
  )
  .mutation(({ ctx, input }) => {
    const { recurringGroceryId, version } = input;

    log.info({ userId: ctx.user.id, recurringGroceryId, version }, "Deleting recurring grocery");

    getRecurringGroceryOwnerId(recurringGroceryId)
      .then(async (ownerId) => {
        if (!ownerId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recurring grocery not found",
          });
        }

        await assertHouseholdAccess(ctx.user.id, ownerId);
        const result = await deleteRecurringGroceryById(recurringGroceryId, version);

        if (result.stale) {
          log.info(
            { userId: ctx.user.id, recurringGroceryId, version },
            "Stale recurring grocery delete; requesting client refresh"
          );
          void groceries.publish(
            "stale",
            {
              reason: "Recurring grocery was updated elsewhere",
            },
            { householdKey: ctx.householdKey }
          );

          return;
        }

        log.info({ userId: ctx.user.id, recurringGroceryId }, "Recurring grocery deleted");

        if (result.deletedGroceryIds.length > 0) {
          void groceries.publish(
            "deleted",
            {
              groceryIds: result.deletedGroceryIds,
            },
            { householdKey: ctx.householdKey }
          );
        }

        void groceries.publish(
          "recurringDeleted",
          {
            recurringGroceryId,
          },
          { householdKey: ctx.householdKey }
        );
      })
      .catch((err) => {
        log.error(
          { err, userId: ctx.user.id, recurringGroceryId },
          "Failed to delete recurring grocery"
        );
        void groceries.publish(
          "failed",
          {
            reason: err.message || "Failed to delete recurring grocery",
          },
          { userId: ctx.user.id }
        );
      });

    return { success: true };
  });

const checkRecurring = authedProcedure
  .input(
    z.object({
      recurringGroceryId: z.string(),
      recurringVersion: z.number().int().positive(),
      groceryId: z.string(),
      groceryVersion: z.number().int().positive(),
      isDone: z.boolean(),
    })
  )
  .mutation(({ ctx, input }) => {
    const { recurringGroceryId, recurringVersion, groceryId, groceryVersion, isDone } = input;
    const checkedDate = getTodayString();

    log.debug(
      { userId: ctx.user.id, recurringGroceryId, groceryId, isDone },
      "Checking recurring grocery"
    );

    getRecurringGroceryOwnerId(recurringGroceryId)
      .then(async (ownerId) => {
        if (!ownerId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recurring grocery not found",
          });
        }

        await assertHouseholdAccess(ctx.user.id, ownerId);

        const recurringGrocery = await getRecurringGroceryById(recurringGroceryId);

        if (!recurringGrocery) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recurring grocery not found",
          });
        }

        let recurringUpdate: {
          id: string;
          version: number;
          lastCheckedDate: string;
          nextPlannedFor: string;
        } | null = null;

        if (isDone) {
          const pattern = recurrencePatternOf(recurringGrocery);

          const nextDate = calculateNextOccurrence(
            pattern,
            recurringGrocery.nextPlannedFor,
            recurringGrocery.nextPlannedFor
          );

          recurringUpdate = {
            id: recurringGroceryId,
            version: recurringVersion,
            lastCheckedDate: checkedDate,
            nextPlannedFor: nextDate,
          };
        }

        const outcome = await checkRecurringGrocery({
          groceryId,
          groceryVersion,
          isDone,
          recurringUpdate,
        });

        if (outcome.stale) {
          log.info(
            { userId: ctx.user.id, recurringGroceryId, groceryId },
            "Stale recurring grocery check; requesting client refresh"
          );
          void groceries.publish(
            "stale",
            {
              reason: "Grocery was updated elsewhere",
            },
            { householdKey: ctx.householdKey }
          );

          return;
        }

        log.debug({ userId: ctx.user.id, recurringGroceryId, isDone }, "Recurring grocery checked");
        void groceries.publish(
          "recurringUpdated",
          {
            recurringGrocery: outcome.value.recurringGrocery ?? recurringGrocery,
            grocery: outcome.value.grocery,
          },
          { householdKey: ctx.householdKey }
        );
      })
      .catch((err) => {
        log.error(
          { err, userId: ctx.user.id, recurringGroceryId },
          "Failed to check recurring grocery"
        );
        void groceries.publish(
          "failed",
          {
            reason: err.message || "Failed to check recurring grocery",
          },
          { userId: ctx.user.id }
        );
      });

    return { success: true };
  });

export const recurringGroceriesProcedures = router({
  createRecurring,
  updateRecurring,
  detachRecurring,
  deleteRecurring,
  checkRecurring,
});
