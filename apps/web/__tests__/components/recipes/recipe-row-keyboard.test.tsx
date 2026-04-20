import React, { forwardRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import IngredientInput from "@/components/recipes/ingredient-input";
import StepInput from "@/components/recipes/step-input";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/config", () => ({
  useUnitsQuery: () => ({ units: [] }),
}));

vi.mock("@/hooks/recipes", () => ({
  useRecipeAutocomplete: () => ({ suggestions: [], isLoading: false }),
  useRecipeImages: () => ({
    uploadStepImage: vi.fn(),
    deleteStepImage: vi.fn(),
  }),
}));

vi.mock("motion/react", () => ({
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
  useDragControls: () => ({ start: vi.fn() }),
}));

vi.mock("@heroui/react", () => ({
  Button: ({ children, onPress, ...props }: React.ComponentPropsWithoutRef<"button"> & { onPress?: () => void }) => (
    <button {...props} onClick={onPress}>
      {children}
    </button>
  ),
  Image: (props: React.ComponentPropsWithoutRef<"img">) => <img alt={props.alt ?? ""} {...props} />,
  Textarea: forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<"textarea"> & { onValueChange?: (value: string) => void }>(
    ({ onValueChange, ...props }, ref) => (
      <textarea
        {...props}
        ref={ref}
        onChange={(event) => {
          props.onChange?.(event);
          onValueChange?.(event.currentTarget.value);
        }}
      />
    )
  ),
}));

describe("recipe row keyboard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves focus to the next ingredient row when Enter is pressed", async () => {
    render(
      <IngredientInput
        ingredients={[
          {
            ingredientName: "Flour",
            amount: 1,
            unit: null,
            order: 0,
            systemUsed: "metric",
          },
        ]}
        onChange={vi.fn()}
      />
    );

    const inputs = await screen.findAllByRole("textbox");

    expect(inputs).toHaveLength(2);

    inputs[0].focus();
    fireEvent.keyDown(inputs[0], { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(inputs[1]).toHaveFocus();
    });
  });

  it("moves focus to the next step row when Enter is pressed", async () => {
    render(
      <StepInput
        steps={[
          {
            step: "Mix the batter",
            order: 0,
            systemUsed: "metric",
          },
        ]}
        onChange={vi.fn()}
      />
    );

    const inputs = await screen.findAllByRole("textbox");

    expect(inputs).toHaveLength(2);

    inputs[0].focus();
    fireEvent.keyDown(inputs[0], { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(inputs[1]).toHaveFocus();
    });
  });
});
