"use client";

import React, { useState } from "react";
import { Button } from "@heroui/react";
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/dropdown";
import { useRouter } from "next/navigation";
import { PlusIcon, ArrowDownTrayIcon } from "@heroicons/react/16/solid";

import ImportRecipeModal from "@/components/shared/import-recipe-modal";

export default function CreateRecipeButton() {
  const router = useRouter();
  const [showImportModal, setShowImportModal] = useState(false);

  return (
    <>
      {/* Desktop */}
      <Dropdown placement="bottom-end">
        <DropdownTrigger>
          <Button
            className="hidden font-medium md:flex"
            color="primary"
            radius="full"
            size="md"
            startContent={<PlusIcon className="h-4 w-4" />}
          >
            Add Recipe
          </Button>
        </DropdownTrigger>
        <DropdownMenu aria-label="Add recipe options">
          <DropdownItem
            key="import"
            startContent={<ArrowDownTrayIcon className="h-4 w-4" />}
            onPress={() => setShowImportModal(true)}
          >
            Import
          </DropdownItem>
          <DropdownItem
            key="create"
            startContent={<PlusIcon className="h-4 w-4" />}
            onPress={() => router.push("/recipes/new")}
          >
            Create
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>

      {/* Mobile - Icon only */}
      <Dropdown placement="bottom-end">
        <DropdownTrigger>
          <Button
            isIconOnly
            className="md:hidden mx-2"
            color="primary"
            radius="full"
            size="md"
          >
            <PlusIcon className="h-5 w-5" />
          </Button>
        </DropdownTrigger>
        <DropdownMenu aria-label="Add recipe options">
          <DropdownItem
            key="import"
            startContent={<ArrowDownTrayIcon className="h-4 w-4" />}
            onPress={() => setShowImportModal(true)}
          >
            Import
          </DropdownItem>
          <DropdownItem
            key="create"
            startContent={<PlusIcon className="h-4 w-4" />}
            onPress={() => router.push("/recipes/new")}
          >
            Create
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>

      <ImportRecipeModal isOpen={showImportModal} onOpenChange={setShowImportModal} />
    </>
  );
}
