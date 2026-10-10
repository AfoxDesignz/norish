"use client";

import { useTRPC } from "@/app/providers/trpc-provider";
import { AIButton } from "@/components/shared/ai-button";
import { cssAIIconColor } from "@/config/css-tokens";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { Button, Modal, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";

import { RoundTokens } from "./ask-ai-round-modal";

/**
 * Asks before a round of Clean names starts: AI reads the Plain Name of
 * every food the viewer may edit whose name is not settled, and proposes a
 * rename where it differs, for a person to confirm. Says how many foods
 * that is across the catalogue and about how many tokens it takes.
 */
export function CleanNamesModal({
  isOpen,
  isStarting,
  onClose,
  onStart,
}: {
  isOpen: boolean;
  isStarting: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  const t = useTranslations("settings.ingredients");
  const tActions = useTranslations("common.actions");
  const format = useFormatter();
  const trpc = useTRPC();
  const { data: summary, isError } = useQuery({
    ...trpc.ingredients.nameScope.queryOptions(),
    enabled: isOpen,
  });
  const foods = summary?.foods ?? 0;
  const perFood = summary?.tokens.models.reduce((sum, use) => sum + use.perFood, 0) ?? 0;

  return (
    <Modal.Backdrop className="z-[1099]" isOpen={isOpen} onOpenChange={onClose}>
      <Modal.Container className="z-[1100]">
        <Modal.Dialog data-testid="ingredients-clean-names-dialog">
          <Modal.Header className="flex-row items-center gap-2">
            <SparklesIcon className={twMerge("size-5 shrink-0", cssAIIconColor)} />
            <Modal.Heading>{t("cleanNames.title")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col">
            <p>{t("cleanNames.intro")}</p>
            {summary ? (
              <>
                <p className="mt-4 tabular-nums" data-testid="ingredients-clean-names-size">
                  {t("askAIRound.scopeSize", {
                    count: foods,
                    tokens: format.number(foods * perFood, {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }),
                  })}
                </p>
                <RoundTokens
                  count={foods}
                  testId="ingredients-clean-names"
                  tokens={summary.tokens}
                />
              </>
            ) : isError ? (
              <p className="text-danger mt-4">{t("errors.unknown")}</p>
            ) : (
              <div className="flex justify-center pt-6 pb-2">
                <Spinner size="sm" />
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={onClose}>
              {tActions("cancel")}
            </Button>
            <AIButton
              data-testid="ingredients-clean-names-start"
              isDisabled={foods === 0}
              isPending={isStarting}
              variant="secondary"
              onPress={onStart}
            >
              {t("cleanNames.start")}
            </AIButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
