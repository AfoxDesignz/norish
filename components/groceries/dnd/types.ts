import type { GroceryDto, StoreDto, RecurringGroceryDto } from "@/types";
import type { UniqueIdentifier } from "@dnd-kit/core";

// =============================================================================
// Constants
// =============================================================================

/**
 * Container ID for groceries without a store assignment.
 */
export const UNSORTED_CONTAINER = "unsorted" as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Container ID can be either a store ID or the UNSORTED_CONTAINER constant.
 */
export type ContainerId = string;

/**
 * Maps container IDs to arrays of grocery item IDs.
 * This represents the current visual order of items during drag operations.
 *
 * Example:
 * {
 *   'unsorted': ['grocery-1', 'grocery-2'],
 *   'store-abc-123': ['grocery-3', 'grocery-4', 'grocery-5']
 * }
 */
export type ItemsState = Record<ContainerId, string[]>;

/**
 * Context value provided by DndGroceryProvider.
 */
export interface DndGroceryContextValue {
  /** ID of the currently dragged item, or null if not dragging */
  activeId: string | null;

  /** The grocery DTO of the currently dragged item, or null if not dragging */
  activeGrocery: GroceryDto | null;

  /** Current container ID the dragged item is over */
  overContainerId: ContainerId | null;

  /**
   * Current items state - container ID to array of grocery IDs.
   * This updates during drag to reflect visual state.
   */
  items: ItemsState;

  /**
   * Get the ordered grocery IDs for a specific container.
   * Returns IDs in the current drag-adjusted order.
   */
  getItemsForContainer: (containerId: ContainerId) => string[];
}

/**
 * Props for the DndGroceryProvider component.
 */
export interface DndGroceryProviderProps {
  children: React.ReactNode;
  groceries: GroceryDto[];
  stores: StoreDto[];
  recurringGroceries: RecurringGroceryDto[];
  onReorderInStore: (updates: { id: string; sortOrder: number; storeId?: string | null }[]) => void;
  getRecipeNameForGrocery?: (grocery: GroceryDto) => string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the container ID for a grocery item.
 * Maps null storeId to UNSORTED_CONTAINER.
 */
export function getContainerIdForGrocery(grocery: GroceryDto): ContainerId {
  return grocery.storeId ?? UNSORTED_CONTAINER;
}

/**
 * Convert a container ID to a storeId for database operations.
 * Maps UNSORTED_CONTAINER back to null.
 */
export function containerIdToStoreId(containerId: ContainerId): string | null {
  return containerId === UNSORTED_CONTAINER ? null : containerId;
}

/**
 * Check if an ID is a container ID (store or unsorted) vs a grocery item ID.
 */
export function isContainerId(id: UniqueIdentifier, stores: StoreDto[]): boolean {
  if (id === UNSORTED_CONTAINER) return true;

  return stores.some((s) => s.id === id);
}

/**
 * Find which container an item belongs to.
 */
export function findContainerForItem(
  itemId: UniqueIdentifier,
  items: ItemsState
): ContainerId | null {
  for (const [containerId, itemIds] of Object.entries(items)) {
    if (itemIds.includes(itemId as string)) {
      return containerId;
    }
  }

  return null;
}

/**
 * Build initial items state from groceries.
 * Only includes active (not done) items, sorted by sortOrder.
 */
export function buildItemsState(groceries: GroceryDto[], stores: StoreDto[]): ItemsState {
  const items: ItemsState = {
    [UNSORTED_CONTAINER]: [],
  };

  // Initialize all store containers
  for (const store of stores) {
    items[store.id] = [];
  }

  // Group active groceries by container
  const activeGroceries = groceries.filter((g) => !g.isDone);

  for (const grocery of activeGroceries) {
    const containerId = getContainerIdForGrocery(grocery);

    if (!items[containerId]) {
      items[containerId] = [];
    }
    items[containerId].push(grocery.id);
  }

  // Sort each container by sortOrder
  for (const containerId of Object.keys(items)) {
    items[containerId].sort((aId, bId) => {
      const a = groceries.find((g) => g.id === aId);
      const b = groceries.find((g) => g.id === bId);

      return (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0);
    });
  }

  return items;
}
