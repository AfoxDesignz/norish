// @vitest-environment node
/**
 * What queues the AI pass: the foods a mint made, or the nightly task's, each by name, and
 * nothing while AI is off or for a food gone since.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addIngredientReviewJob } from "@norish/queue/ingredient-review/producer";

const config = vi.hoisted(() => ({ isAIEnabled: vi.fn(async () => true) }));
const catalogue = vi.hoisted(() => ({
  findCatalogueIngredientNames: vi.fn(
    async (ids: readonly string[]) =>
      new Map(ids.filter((id) => id !== "gone").map((id) => [id, `${id}!`]))
  ),
}));
const reviewQueue = vi.hoisted(() => ({ add: vi.fn(async () => ({ id: "pass-1" })) }));

vi.mock("@norish/shared-server/config/server-config-loader", () => config);
vi.mock("@norish/db/repositories/ingredient-catalogue", () => catalogue);
vi.mock("@norish/queue/registry", () => ({ getQueues: () => ({ ingredientReview: reviewQueue }) }));

beforeEach(() => {
  config.isAIEnabled.mockResolvedValue(true);
  reviewQueue.add.mockClear();
});

describe("addIngredientReviewJob", () => {
  it("queues one pass over the foods still there, each by name", async () => {
    await addIngredientReviewJob(["uien", "gone", "knaks"]);

    expect(reviewQueue.add).toHaveBeenCalledExactlyOnceWith("review", {
      ingredients: [
        { id: "uien", name: "uien!" },
        { id: "knaks", name: "knaks!" },
      ],
    });
  });

  it("queues nothing while AI is off, without a food, or when every food is gone", async () => {
    config.isAIEnabled.mockResolvedValueOnce(false);
    await addIngredientReviewJob(["uien"]);
    await addIngredientReviewJob([]);
    await addIngredientReviewJob(["gone"]);

    expect(reviewQueue.add).not.toHaveBeenCalled();
  });
});
