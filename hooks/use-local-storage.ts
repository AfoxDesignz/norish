"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Generic hook for persisting state to localStorage with SSR safety.
 *
 * @param key - localStorage key
 * @param defaultValue - Default value when no stored value exists
 * @param validate - Optional validation function to verify stored data shape
 * @returns [value, setValue, clear, isHydrated]
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  validate?: (data: unknown) => T | null
): [T, (value: T | ((prev: T) => T)) => void, () => void, boolean] {
  const [isHydrated, setIsHydrated] = useState(false);
  const [value, setValue] = useState<T>(defaultValue);

  // Hydrate from localStorage on client mount
  useEffect(() => {
    if (typeof window === "undefined") {
      setIsHydrated(true);

      return;
    }

    try {
      const stored = localStorage.getItem(key);

      if (stored) {
        const parsed = JSON.parse(stored) as unknown;

        if (validate) {
          const validated = validate(parsed);

          if (validated !== null) {
            setValue(validated);
          }
        } else {
          setValue(parsed as T);
        }
      }
    } catch {
      // Invalid JSON or other error - use default
    }

    setIsHydrated(true);
  }, [key, validate]);

  // Save to localStorage when value changes (after hydration)
  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage might be full or disabled - silently ignore
    }
  }, [key, value, isHydrated]);

  // Clear from localStorage
  const clear = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.removeItem(key);
    } catch {
      // Silently ignore errors
    }
    setValue(defaultValue);
  }, [key, defaultValue]);

  return [value, setValue, clear, isHydrated];
}
