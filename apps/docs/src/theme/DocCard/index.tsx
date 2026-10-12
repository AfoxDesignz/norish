import type {
  PropSidebarItem,
  PropSidebarItemCategory,
  PropSidebarItemLink,
} from "@docusaurus/plugin-content-docs";
import React from "react";
import Link from "@docusaurus/Link";
import { findFirstSidebarItemLink, useDocById } from "@docusaurus/plugin-content-docs/client";
import { ArrowRightIcon, FolderIcon } from "@heroicons/react/24/outline";

/** One page or section on a category's index. */
export default function DocCard({ item }: { item: PropSidebarItem }) {
  if (item.type === "category") return <CategoryCard item={item} />;
  if (item.type === "link") return <LinkCard item={item} />;

  return null;
}

function LinkCard({ item }: { item: PropSidebarItemLink }) {
  const doc = useDocById(item.docId ?? undefined);

  return (
    <CardLink
      description={item.description ?? doc?.description}
      href={item.href}
      title={item.label}
    />
  );
}

function CategoryCard({ item }: { item: PropSidebarItemCategory }) {
  const href = findFirstSidebarItemLink(item);

  if (!href) return null;

  return (
    <CardLink
      description={item.description ?? `${item.items.length} pages`}
      folder
      href={href}
      title={item.label}
    />
  );
}

function CardLink({
  href,
  title,
  description,
  folder,
}: {
  href: string;
  title: string;
  description?: string;
  folder?: boolean;
}) {
  return (
    <Link
      className="group border-border bg-background/50 hover:bg-background flex flex-col gap-1.5 rounded-3xl border p-5 no-underline transition-colors"
      to={href}
    >
      <span className="text-foreground flex items-center gap-2 font-medium">
        {folder && <FolderIcon className="text-muted size-4.5" />}
        {title}
        <ArrowRightIcon className="text-muted ml-auto size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
      {description && (
        <span className="text-muted line-clamp-2 text-sm leading-relaxed font-normal">
          {description}
        </span>
      )}
    </Link>
  );
}
