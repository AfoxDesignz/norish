"use client";

import { motion, AnimatePresence } from "motion/react";
import { Button } from "@heroui/react";
import { ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/16/solid";

type ScrollToTodayButtonProps = {
  visible: boolean;
  onClick: () => void;
  direction: "up" | "down";
};

export function ScrollToTodayButton({ visible, onClick, direction }: ScrollToTodayButtonProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="fixed right-4 bottom-24 z-40"
        >
          <Button
            isIconOnly
            color="primary"
            radius="full"
            size="sm"
            className="h-10 w-10 min-w-10"
            onPress={onClick}
          >
            {direction === "up" ? (
              <ChevronUpIcon className="h-5 w-5" />
            ) : (
              <ChevronDownIcon className="h-5 w-5" />
            )}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
