import { QuerySeed } from "@/components/query-seed";

// The cookbook itself; its recipes stay in the browser, since their filters live only there.
export default async function CookbookLayout({ children, params }: LayoutProps<"/cookbooks/[id]">) {
  const { id } = await params;

  return (
    <QuerySeed reads={(trpc, client) => [client.query(trpc.cookbooks.get.queryOptions({ id }))]}>
      {children}
    </QuerySeed>
  );
}
