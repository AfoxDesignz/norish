"use client";

import { motion, useMotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Chip } from "@heroui/react";

import TagsSkeleton from "@/components/skeleton/tags-skeleton";
import { cssGlassBackdropChip } from "@/config/css-tokens";

interface RecipeTagsProps {
  tags: { name: string }[];
  isAutoTagging?: boolean;
}

export default function RecipeTags({ tags, isAutoTagging = false }: RecipeTagsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragLimit, setDragLimit] = useState(0);
  const x = useMotionValue(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const update = () => setDragLimit(el.scrollWidth - el.offsetWidth);

    update();

    window.addEventListener("resize", update);

    return () => window.removeEventListener("resize", update);
  }, [tags]);

  if (isAutoTagging) {
    return (
      <div className="absolute inset-x-0 bottom-0 z-30 overflow-hidden p-2">
        <TagsSkeleton glass />
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 overflow-hidden p-2">
      <motion.div
        ref={containerRef}
        className="flex cursor-grab gap-2 active:cursor-grabbing"
        drag="x"
        dragConstraints={{ left: -dragLimit, right: 0 }}
        dragElastic={0.1}
        style={{ x }}
      >
        {tags.map((t, i) => (
          <Chip
            key={i}
            className={`shrink-0 text-white ${cssGlassBackdropChip}`}
            size="sm"
            variant="flat"
          >
            {t.name}
          </Chip>
        ))}
      </motion.div>
    </div>
  );
}
