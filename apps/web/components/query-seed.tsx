import "server-only";

import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { QuerySeedBoundary } from "@/components/query-seed-boundary";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@norish/trpc/client";
import { appRouter, createHttpContextFromHeaders } from "@norish/trpc/server";

/**
 * Hands the reads a page's first frame needs to the browser's query cache on a full load, so
 * the first paint is the page rather than its skeleton. An in-app navigation carries nothing
 * and renders from the cache, or the skeleton while the page fetches, as before. A read that
 * fails is left out, and the page handles it as it always has.
 */
export async function QuerySeed({
  children,
  reads,
}: {
  children: ReactNode;
  reads: (trpc: TRPCOptionsProxy<AppRouter>, queryClient: QueryClient) => Promise<unknown>[];
}) {
  const requestHeaders = await headers();
  let state;

  // Next hides its RSC headers from headers(); the browser's own says a document load from the
  // fetch behind a navigation or prefetch. Without it, nothing is sent, as before.
  if (requestHeaders.get("sec-fetch-dest") === "document") {
    const queryClient = new QueryClient();
    const ctx = await createHttpContextFromHeaders(new Headers(requestHeaders), null);

    await Promise.allSettled(
      reads(createTRPCOptionsProxy({ router: appRouter, ctx, queryClient }), queryClient)
    );
    state = dehydrate(queryClient);
  }

  // Always the boundary, so a refresh of the same page keeps its tree.
  return <QuerySeedBoundary state={state}>{children}</QuerySeedBoundary>;
}
