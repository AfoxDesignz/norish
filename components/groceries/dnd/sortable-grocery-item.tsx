"use client";

import type { GroceryDto } from "@/types";
import type { ReactNode } from "react";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bars3Icon } from "@heroicons/react/16/solid";

interface SortableGroceryItemProps {
  grocery: GroceryDto;
  children: ReactNode;
}

/**
 * Wraps a grocery item to make it sortable with dnd-kit.
 * Provides a drag handle and applies transform/transition for smooth animations.
 *
 * When dragging:
 * - The original item shows at 50% opacity as a "ghost" placeholder
 * - The DragOverlay shows the actual dragged item following the cursor
 * - Other items shift via CSS transforms to make room
 */
export function SortableGroceryItem({ grocery, children }: SortableGroceryItemProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: grocery.id,
  });

  // Style matches reference implementation:
  // - When dragging, show at 50% opacity as ghost/placeholder
  // - Transform and transition handle the shifting animation
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} className="relative" style={style}>
      {/* Drag handle - positioned absolutely on the left */}
      <button
        ref={setActivatorNodeRef}
        className="absolute top-1/2 left-2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        type="button"
        {...attributes}
        {...listeners}
      >
        <Bars3Icon className="text-default-400 h-5 w-5" />
      </button>

      {/* The actual grocery item content */}
      {children}
    </div>
  );
}
