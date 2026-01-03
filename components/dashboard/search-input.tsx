"use client";

import { useCallback, useEffect, useState, useTransition, useRef } from "react";
import { Input } from "@heroui/react";
import { MagnifyingGlassIcon } from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";

import Filters from "../shared/filters";
import SearchFieldToggles from "./search-field-toggles";

import { useRecipesContext } from "@/context/recipes-context";
import { useRecipesFiltersContext } from "@/context/recipes-filters-context";
import { isUrl } from "@/lib/helpers";

export default function SearchInput() {
  const t = useTranslations("recipes.dashboard");
  const { filters, setFilters } = useRecipesFiltersContext();
  const { importRecipe } = useRecipesContext();
  const [_isPending, startTransition] = useTransition();
  const [inputValue, setInputValue] = useState(filters.rawInput);
  const [isFocused, setIsFocused] = useState(false);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scheduleFilterUpdate = useCallback(
    (value: string) => {
      startTransition(() => setFilters({ rawInput: value }));
    },
    [setFilters]
  );

  useEffect(() => {
    setInputValue(filters.rawInput);
  }, [filters.rawInput]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;

    setInputValue(rawValue);
    const trimmedValue = rawValue.trim();

    if (isUrl(trimmedValue)) {
      setInputValue("");
      scheduleFilterUpdate("");
      void importRecipe(trimmedValue);
    } else {
      scheduleFilterUpdate(trimmedValue);
    }
  };

  const handleBlur = () => {
    // Delay blur to allow clicks on toggles to register
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
    }, 2000);
  };

  const handleFocus = () => {
    // Cancel any pending blur
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setIsFocused(true);
  };

  // Reset hide timer when interacting with toggles
  const resetHideTimer = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = setTimeout(() => {
        setIsFocused(false);
      }, 2000);
    }
  }, []);

  const hasFilters = filters.rawInput.trim().length > 0 || filters.searchTags.length > 0;
  const showFieldToggles = isFocused || inputValue.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full items-center gap-2">
        <Input
          isClearable
          classNames={{
            inputWrapper: "h-12",
            input: "text-[15px]",
          }}
          id="search-input"
          placeholder={t("searchPlaceholder")}
          radius="full"
          startContent={
            <MagnifyingGlassIcon
              className={`h-5 w-5 ${hasFilters ? "text-primary animate-pulse" : "text-default-400"}`}
            />
          }
          style={{ fontSize: "16px" }}
          value={inputValue}
          variant="flat"
          onBlur={handleBlur}
          onChange={handleChange}
          onClear={() => {
            setInputValue("");
            scheduleFilterUpdate("");
          }}
          onFocus={handleFocus}
        />
        <Filters isGlass={false} />
      </div>
      <AnimatePresence initial={false}>
        {showFieldToggles && (
          <motion.div
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <SearchFieldToggles className="px-1 pb-1" scrollable onInteraction={resetHideTimer} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
