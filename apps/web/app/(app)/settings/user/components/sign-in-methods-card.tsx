"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SettingsCard } from "@/app/(app)/settings/components/settings-card";
import { ProviderIcon } from "@/app/(auth)/login/components/provider-icon";
import { useTRPC } from "@/app/providers/trpc-provider";
import { FingerPrintIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Button, Chip, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { ProviderInfo } from "@norish/shared/contracts/dto/auth";
import { SIGN_IN_METHODS } from "@norish/shared/contracts/dto/auth";
import { authClient } from "@norish/shared/lib/auth/client";

import NewFeatureChip from "../../components/new-feature-chip";

const ACCOUNTS_KEY = ["auth", "accounts"];

type ErrorMessage =
  | "usedByAnotherAccount"
  | "alreadyAdded"
  | "lastMethod"
  | "signInAgain"
  | "addFailed"
  | "removeFailed";

// What a refused add or remove says, by Better Auth's error code; anything else is generic.
const ERROR_MESSAGES: Record<string, ErrorMessage> = {
  account_already_linked_to_different_user: "usedByAnotherAccount",
  SIGN_IN_METHOD_ALREADY_ADDED: "alreadyAdded",
  LAST_SIGN_IN_METHOD: "lastMethod",
  SESSION_NOT_FRESH: "signInAgain",
};

export default function SignInMethodsCard() {
  const t = useTranslations("settings.user.signInMethods");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: offered = [] } = useQuery({
    ...trpc.config.authProviders.queryOptions(),
    select: (data) => data.providers,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();

      if (error) throw error;

      return data;
    },
  });

  const showError = (code: string | undefined, fallback: ErrorMessage) =>
    toast(t(`errors.${ERROR_MESSAGES[code ?? ""] ?? fallback}`), { variant: "danger" });

  // A refused add comes back from the provider as `?error=`; a cancelled one changes nothing.
  const linkError = searchParams.get("error");

  useEffect(() => {
    if (!linkError) return;
    if (linkError !== "access_denied") showError(linkError, "addFailed");

    const params = new URLSearchParams(searchParams);

    params.delete("error");
    params.delete("error_description");
    router.replace(params.size ? `${pathname}?${params}` : pathname);
    // eslint-disable-next-line @eslint-react/exhaustive-deps -- once per returned error
  }, [linkError]);

  const add = useMutation({
    mutationFn: async (provider: string) => {
      const { error } = await authClient.linkSocial({
        provider,
        callbackURL: pathname,
        errorCallbackURL: pathname,
      });

      if (error) throw error;
    },
    onError: (error: { code?: string }) => showError(error.code, "addFailed"),
  });
  const remove = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await authClient.unlinkAccount({ accountId });

      if (error) throw error;
    },
    onError: (error: { code?: string }) => showError(error.code, "removeFailed"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });

  const offeredById = new Map(offered.map((provider) => [provider.id, provider]));
  // A method the server no longer offers keeps its usual name and icon.
  const methodOf = (providerId: string) =>
    offeredById.get(providerId) ??
    (SIGN_IN_METHODS as Record<string, ProviderInfo>)[providerId] ?? {
      ...SIGN_IN_METHODS.oidc,
      name: providerId,
    };
  const nameOf = (providerId: string) =>
    providerId === "credential" ? t("password") : methodOf(providerId).name;
  const addable = offered.filter(
    (provider) =>
      provider.type === "oauth" && !accounts.some((account) => account.providerId === provider.id)
  );

  return (
    <SettingsCard
      badges={<NewFeatureChip showOnVersion="0.26.0" />}
      description={t("description")}
      icon={FingerPrintIcon}
      title={t("title")}
    >
      <ul className="divide-border divide-y">
        {accounts.map((account) => {
          // The server refuses the same: what is left must hold a method it offers.
          const canRemove = accounts.some(
            (other) => other.id !== account.id && offeredById.has(other.providerId)
          );

          return (
            <li key={account.id} className="flex items-center gap-3 py-2">
              <ProviderIcon
                icon={methodOf(account.providerId).icon}
                providerName={nameOf(account.providerId)}
              />
              <span className="flex-1">{nameOf(account.providerId)}</span>
              {!offeredById.has(account.providerId) && (
                <Chip size="sm" variant="soft">
                  {t("unavailable")}
                </Chip>
              )}
              <Button
                isDisabled={!canRemove}
                isPending={remove.isPending && remove.variables === account.id}
                size="sm"
                variant="danger-soft"
                onPress={() => remove.mutate(account.id)}
              >
                <TrashIcon className="size-4" />
                {t("remove")}
              </Button>
            </li>
          );
        })}
        {addable.map((provider) => (
          <li key={provider.id} className="flex items-center gap-3 py-2">
            <ProviderIcon icon={provider.icon} providerName={provider.name} />
            <span className="text-muted flex-1">{provider.name}</span>
            <Button
              isPending={add.isPending && add.variables === provider.id}
              size="sm"
              variant="tertiary"
              onPress={() => add.mutate(provider.id)}
            >
              <PlusIcon className="size-4" />
              {t("add")}
            </Button>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
