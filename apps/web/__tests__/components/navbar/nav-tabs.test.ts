import { navTabPosition, tabTransitionTypes } from "@/components/navbar/nav-tabs";
import { describe, expect, it } from "vitest";

describe("navTabPosition", () => {
  it("counts the tabs from the left: Recipes, Groceries, Calendar, Settings", () => {
    expect(["/", "/groceries", "/calendar", "/settings"].map(navTabPosition)).toEqual([0, 1, 2, 3]);
  });

  it("places a page under its tab, query or not", () => {
    expect(navTabPosition("/groceries/pantry")).toBe(1);
    expect(navTabPosition("/settings?tab=household")).toBe(3);
    expect(navTabPosition("/?q=stew")).toBe(0);
  });

  it("gives a page outside the tabs no position", () => {
    expect(navTabPosition("/recipes/abc")).toBe(-1);
    expect(navTabPosition("/cookbooks/abc")).toBe(-1);
    expect(navTabPosition("/groceriesx")).toBe(-1);
  });
});

describe("tabTransitionTypes", () => {
  it("slides a tab left of the current page in from the left", () => {
    expect(tabTransitionTypes("/calendar", "/groceries")).toEqual(["nav-back"]);
    expect(tabTransitionTypes("/settings", "/")).toEqual(["nav-back"]);
  });

  it("slides a tab to the right, or one opened from outside the tabs, forward", () => {
    expect(tabTransitionTypes("/", "/calendar")).toBeUndefined();
    expect(tabTransitionTypes("/groceries", "/settings?tab=user")).toBeUndefined();
    expect(tabTransitionTypes("/recipes/abc", "/")).toBeUndefined();
  });
});
