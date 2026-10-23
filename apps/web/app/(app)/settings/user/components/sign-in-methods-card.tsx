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

import {
  keepsOfferedSignInMethod,
  LAST_SIGN_IN_METHOD,
  SIGN_IN_METHODS,
} from "@norish/shared/contracts/dto/auth";
import { authClient } from "@norish/shared/lib/auth/client";

type ErrorMessage =
  "usedByAnotherAccount" | "lastMethod" | "signInAgain" | "addFailed" | "removeFailed";

// What a refused add or remove says, by Better Auth's error code; anything else is generic.
const ERROR_MESSAGES: Record<string, ErrorMessage> = {
  account_already_linked_to_different_user: "usedByAnotherAccount",
  [LAST_SIGN_IN_METHOD]: "lastMethod",
  SESSION_NOT_FRESH: "signInAgain",
};

// Better Auth's client answers `{ data, error }` rather than throwing.
async function orThrow(request: Promise<{ error: unknown }>): Promise<void> {
  const { error } = await request;

  if (error) throw error;
}

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
  const accountsQuery = trpc.user.signInMethods.queryOptions();
  const { data: accounts = [] } = useQuery(accountsQuery);

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
    mutationFn: (provider: string) =>
      orThrow(
        authClient.linkSocial({ provider, callbackURL: pathname, errorCallbackURL: pathname })
      ),
    onError: (error: { code?: string }) => showError(error.code, "addFailed"),
  });
  const remove = useMutation({
    mutationFn: (accountId: string) => orThrow(authClient.unlinkAccount({ accountId })),
    onError: (error: { code?: string }) => showError(error.code, "removeFailed"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountsQuery.queryKey }),
  });

  const offeredIds = new Set(offered.map((provider) => provider.id));
  // A method the server no longer offers keeps its usual name and icon.
  const methods = new Map(
    [...Object.values(SIGN_IN_METHODS), ...offered].map((method) => [method.id, method])
  );
  const methodOf = (providerId: string) =>
    methods.get(providerId) ?? { ...SIGN_IN_METHODS.oidc, name: providerId };
  const nameOf = (providerId: string) =>
    providerId === "credential" ? t("password") : methodOf(providerId).name;
  const addable = offered.filter(
    (provider) =>
      provider.type === "oauth" && !accounts.some((account) => account.providerId === provider.id)
  );

  // With one method on the server there is nothing to add or remove.
  if (offered.length < 2) return null;

  return (
    <SettingsCard description={t("description")} icon={FingerPrintIcon} title={t("title")}>
      <ul className="divide-border divide-y">
        {accounts.map((account) => {
          const canRemove = keepsOfferedSignInMethod(accounts, account.id, offeredIds);

          return (
            <li key={account.id} className="flex items-center gap-3 py-2">
              <ProviderIcon
                icon={methodOf(account.providerId).icon}
                providerName={nameOf(account.providerId)}
              />
              <span className="flex-1">{nameOf(account.providerId)}</span>
              {!offeredIds.has(account.providerId) && (
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
