import { QuerySeed } from "@/components/query-seed";

import { GroceriesScreen } from "./groceries-screen";

/**
 * Both views of Groceries under one layout, which renders the view itself:
 * the pages only give each view an address (and Next a top to scroll to), so
 * switching between the list and the Pantry stays on the client. The stored view and grouping come from
 * the App Shell's Device Preferences, already in the server's first frame.
 */
export default function GroceriesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* What either view's first frame draws: the list, its stores, and the Pantry. */}
      <QuerySeed
        reads={(trpc, client) => [
          client.query(trpc.groceries.list.queryOptions()),
          client.query(trpc.stores.list.queryOptions()),
          client.query(trpc.pantry.list.queryOptions()),
        ]}
      >
        <GroceriesScreen />
      </QuerySeed>
    </>
  );
}
