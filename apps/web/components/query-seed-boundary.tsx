"use client";

import type { DehydratedState } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { markServerCopies } from "@/lib/query-cache";
import { HydrationBoundary } from "@tanstack/react-query";

/** QuerySeed's browser half: the reads it hydrates count as current until their data changes. */
export function QuerySeedBoundary({
  state,
  children,
}: {
  state: DehydratedState | undefined;
  children: ReactNode;
}) {
  markServerCopies(state);

  return <HydrationBoundary state={state}>{children}</HydrationBoundary>;
}
