import { QuerySeed } from "@/components/query-seed";

export default async function RecipeLayout({ children, params }: LayoutProps<"/recipes/[id]">) {
  const { id } = await params;

  return (
    <QuerySeed reads={(trpc, client) => [client.query(trpc.recipes.get.queryOptions({ id }))]}>
      {children}
    </QuerySeed>
  );
}
