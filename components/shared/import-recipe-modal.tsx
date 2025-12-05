"use client";

import { useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Button,
  addToast,
} from "@heroui/react";

import { useRecipesContext } from "@/context/recipes-context";

interface ImportRecipeModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ImportRecipeModal({ isOpen, onOpenChange }: ImportRecipeModalProps) {
  const { importRecipe } = useRecipesContext();
  const [importUrl, setImportUrl] = useState("");

  async function handleImportFromUrl() {
    if (importUrl.trim() === "") return;

    try {
      await importRecipe(importUrl);
      onOpenChange(false);
      setImportUrl("");
    } catch (e) {
      onOpenChange(false);
      setImportUrl("");
      addToast({
        title: "Failed to import recipe",
        description: (e as Error).message,
        color: "danger",
      });
    }
  }

  return (
    <Modal isOpen={isOpen} size="md" onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">Import recipe</ModalHeader>
            <ModalBody>
              <Input
                label="Recipe URL"
                placeholder="https://example.com/your-recipe"
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                Cancel
              </Button>
              <Button color="primary" onPress={handleImportFromUrl}>
                Import
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
