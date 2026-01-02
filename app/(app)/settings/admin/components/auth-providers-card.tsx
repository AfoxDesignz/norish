"use client";

import { useState, useCallback } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Accordion,
  AccordionItem,
  Input,
  Button,
  Chip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  addToast,
  Switch,
  Divider,
} from "@heroui/react";
import {
  KeyIcon,
  CheckIcon,
  XMarkIcon,
  TrashIcon,
  BeakerIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
} from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";

import { useAdminSettingsContext } from "../context";

import { RestartRequiredChip } from "./restart-required-chip";

import { ServerConfigKeys, type ServerConfigKey } from "@/server/db/zodSchemas/server-config";
import SecretInput from "@/components/shared/secret-input";

type ProviderKey = "oidc" | "github" | "google";

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
}

const CONFIG_KEYS: Record<ProviderKey, ServerConfigKey> = {
  oidc: ServerConfigKeys.AUTH_PROVIDER_OIDC,
  github: ServerConfigKeys.AUTH_PROVIDER_GITHUB,
  google: ServerConfigKeys.AUTH_PROVIDER_GOOGLE,
};

interface AuthProviderFormProps {
  providerKey: ProviderKey;
  providerName: string;
  config: Record<string, unknown> | undefined;
  fields: FieldDef[];
}

function AuthProviderForm({ providerKey, providerName, config, fields }: AuthProviderFormProps) {
  const t = useTranslations("settings.admin.authProviders.form");
  const tActions = useTranslations("common.actions");
  const {
    updateAuthProviderGitHub,
    updateAuthProviderGoogle,
    deleteAuthProvider,
    testAuthProvider,
    fetchConfigSecret,
  } = useAdminSettingsContext();

  // Initialize form values from config (secrets start empty)
  const [values, setValues] = useState<Record<string, string>>(() =>
    fields.reduce(
      (acc, f) => {
        acc[f.key] = f.secret ? "" : ((config?.[f.key] as string) ?? "");

        return acc;
      },
      {} as Record<string, string>
    )
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const deleteModal = useDisclosure();

  const handleRevealSecret = useCallback(
    (field: string) => () => fetchConfigSecret(CONFIG_KEYS[providerKey], field),
    [fetchConfigSecret, providerKey]
  );

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const testValues = Object.fromEntries(fields.map((f) => [f.key, values[f.key] || undefined]));

      setTestResult(await testAuthProvider(providerKey, testValues));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saveValues = Object.fromEntries(fields.map((f) => [f.key, values[f.key] || undefined]));

      // Route to correct update function (OIDC uses OIDCProviderForm, not this generic form)
      if (providerKey === "github")
        await updateAuthProviderGitHub(
          saveValues as Parameters<typeof updateAuthProviderGitHub>[0]
        );
      else if (providerKey === "google")
        await updateAuthProviderGoogle(
          saveValues as Parameters<typeof updateAuthProviderGoogle>[0]
        );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const result = await deleteAuthProvider(providerKey);

    if (!result.success) {
      deleteModal.onClose();
      addToast({ severity: "danger", title: "Cannot delete provider", description: result.error });

      return;
    }
    deleteModal.onClose();
    setValues(
      fields.reduce(
        (acc, f) => {
          acc[f.key] = "";

          return acc;
        },
        {} as Record<string, string>
      )
    );
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      {fields.map((field) =>
        field.secret ? (
          <SecretInput
            key={field.key}
            isConfigured={!!config?.[field.key]}
            label={field.label}
            placeholder={field.placeholder}
            value={values[field.key]}
            onReveal={handleRevealSecret(field.key)}
            onValueChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          />
        ) : (
          <Input
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            value={values[field.key]}
            onValueChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          />
        )
      )}

      {testResult && (
        <div
          className={`flex items-center gap-2 rounded-lg p-2 ${testResult.success ? "bg-success-100 text-success-700" : "bg-danger-100 text-danger-700"}`}
        >
          {testResult.success ? (
            <CheckIcon className="h-4 w-4" />
          ) : (
            <XMarkIcon className="h-4 w-4" />
          )}
          {testResult.success ? t("testSuccess") : testResult.error}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        {config && (
          <Button
            color="danger"
            startContent={<TrashIcon className="h-5 w-5" />}
            variant="flat"
            onPress={deleteModal.onOpen}
          >
            {tActions("remove")}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            isLoading={testing}
            startContent={<BeakerIcon className="h-5 w-5" />}
            variant="flat"
            onPress={handleTest}
          >
            {tActions("test")}
          </Button>
          <Button
            color="primary"
            isLoading={saving}
            startContent={<CheckIcon className="h-5 w-5" />}
            onPress={handleSave}
          >
            {tActions("save")}
          </Button>
        </div>
      </div>

      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.onClose}>
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <ExclamationTriangleIcon className="text-danger h-5 w-5" />
            {t("removeTitle", { provider: providerName })}
          </ModalHeader>
          <ModalBody>
            <p>{t("removeConfirm")}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={deleteModal.onClose}>
              {tActions("cancel")}
            </Button>
            <Button color="danger" onPress={handleDelete}>
              {tActions("remove")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ============================================================================
// OIDC Provider Form with Claim Mapping
// ============================================================================

interface OIDCProviderFormProps {
  config: Record<string, unknown> | undefined;
}

function OIDCProviderForm({ config }: OIDCProviderFormProps) {
  const t = useTranslations("settings.admin.authProviders.form");
  const tOidc = useTranslations("settings.admin.authProviders.oidc.fields");
  const tClaimMapping = useTranslations("settings.admin.authProviders.oidc.claimMapping");
  const tActions = useTranslations("common.actions");
  const {
    updateAuthProviderOIDC,
    deleteAuthProvider,
    testAuthProvider,
    fetchConfigSecret,
  } = useAdminSettingsContext();

  // Get existing claim config
  const existingClaimConfig = config?.claimConfig as {
    enabled?: boolean;
    scopes?: string[];
    groupsClaim?: string;
    adminGroup?: string;
    householdPrefix?: string;
  } | undefined;

  // Core OIDC fields
  const [name, setName] = useState((config?.name as string) ?? "");
  const [issuer, setIssuer] = useState((config?.issuer as string) ?? "");
  const [clientId, setClientId] = useState((config?.clientId as string) ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [wellknown, setWellknown] = useState((config?.wellknown as string) ?? "");

  // Claim mapping fields
  const [claimMappingEnabled, setClaimMappingEnabled] = useState(existingClaimConfig?.enabled ?? false);
  const [scopes, setScopes] = useState(existingClaimConfig?.scopes?.join(", ") ?? "");
  const [groupsClaim, setGroupsClaim] = useState(existingClaimConfig?.groupsClaim ?? "groups");
  const [adminGroup, setAdminGroup] = useState(existingClaimConfig?.adminGroup ?? "norish_admin");
  const [householdPrefix, setHouseholdPrefix] = useState(existingClaimConfig?.householdPrefix ?? "norish_household_");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const deleteModal = useDisclosure();

  const handleRevealSecret = useCallback(
    (field: string) => () => fetchConfigSecret(ServerConfigKeys.AUTH_PROVIDER_OIDC, field),
    [fetchConfigSecret]
  );

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const testValues = {
        name: name || undefined,
        issuer: issuer || undefined,
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
        wellknown: wellknown || undefined,
      };

      setTestResult(await testAuthProvider("oidc", testValues));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Parse scopes from comma-separated string
      const scopesArray = scopes
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      await updateAuthProviderOIDC({
        name,
        issuer,
        clientId,
        clientSecret: clientSecret || undefined,
        wellknown: wellknown || undefined,
        claimConfig: {
          enabled: claimMappingEnabled,
          scopes: scopesArray,
          groupsClaim,
          adminGroup,
          householdPrefix,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const result = await deleteAuthProvider("oidc");

    if (!result.success) {
      deleteModal.onClose();
      addToast({ severity: "danger", title: "Cannot delete provider", description: result.error });

      return;
    }
    deleteModal.onClose();
    // Reset all fields
    setName("");
    setIssuer("");
    setClientId("");
    setClientSecret("");
    setWellknown("");
    setClaimMappingEnabled(false);
    setScopes("");
    setGroupsClaim("groups");
    setAdminGroup("norish_admin");
    setHouseholdPrefix("norish_household_");
  };

  return (
    <div className="flex flex-col gap-4 p-2">
      {/* Core OIDC Fields */}
      <Input
        label={tOidc("name")}
        placeholder={tOidc("namePlaceholder")}
        value={name}
        onValueChange={setName}
      />
      <Input
        label={tOidc("issuer")}
        placeholder={tOidc("issuerPlaceholder")}
        value={issuer}
        onValueChange={setIssuer}
      />
      <Input
        label={tOidc("clientId")}
        value={clientId}
        onValueChange={setClientId}
      />
      <SecretInput
        isConfigured={!!config?.clientSecret}
        label={tOidc("clientSecret")}
        value={clientSecret}
        onReveal={handleRevealSecret("clientSecret")}
        onValueChange={setClientSecret}
      />
      <Input
        label={tOidc("wellknown")}
        placeholder={tOidc("wellknownPlaceholder")}
        value={wellknown}
        onValueChange={setWellknown}
      />

      {/* Claim Mapping Section */}
      <Divider className="my-2" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserGroupIcon className="text-default-500 h-4 w-4" />
          <span className="text-default-700 font-medium">{tClaimMapping("title")}</span>
          <RestartRequiredChip />
        </div>
        <Switch
          color="success"
          isSelected={claimMappingEnabled}
          onValueChange={setClaimMappingEnabled}
        />
      </div>
      <p className="text-default-500 text-sm">
        {tClaimMapping("description")}
      </p>
      {claimMappingEnabled && (
        <div className="bg-warning-50 border-warning-200 text-warning-700 flex items-start gap-2 rounded-lg border p-3">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p className="text-sm">{tClaimMapping("securityWarning")}</p>
        </div>
      )}

      <Input
        description={tClaimMapping("scopesDescription")}
        isDisabled={!claimMappingEnabled}
        label={tClaimMapping("scopes")}
        placeholder={tClaimMapping("scopesPlaceholder")}
        value={scopes}
        onValueChange={setScopes}
      />
      <Input
        description={tClaimMapping("groupsClaimDescription")}
        isDisabled={!claimMappingEnabled}
        label={tClaimMapping("groupsClaim")}
        placeholder="groups"
        value={groupsClaim}
        onValueChange={setGroupsClaim}
      />
      <Input
        description={tClaimMapping("adminGroupDescription")}
        isDisabled={!claimMappingEnabled}
        label={tClaimMapping("adminGroup")}
        placeholder="norish_admin"
        value={adminGroup}
        onValueChange={setAdminGroup}
      />
      <Input
        description={tClaimMapping("householdPrefixDescription")}
        isDisabled={!claimMappingEnabled}
        label={tClaimMapping("householdPrefix")}
        placeholder="norish_household_"
        value={householdPrefix}
        onValueChange={setHouseholdPrefix}
      />

      {testResult && (
        <div
          className={`flex items-center gap-2 rounded-lg p-2 ${testResult.success ? "bg-success-100 text-success-700" : "bg-danger-100 text-danger-700"}`}
        >
          {testResult.success ? (
            <CheckIcon className="h-4 w-4" />
          ) : (
            <XMarkIcon className="h-4 w-4" />
          )}
          {testResult.success ? t("testSuccess") : testResult.error}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        {config && (
          <Button
            color="danger"
            startContent={<TrashIcon className="h-5 w-5" />}
            variant="flat"
            onPress={deleteModal.onOpen}
          >
            {tActions("remove")}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            isLoading={testing}
            startContent={<BeakerIcon className="h-5 w-5" />}
            variant="flat"
            onPress={handleTest}
          >
            {tActions("test")}
          </Button>
          <Button
            color="primary"
            isLoading={saving}
            startContent={<CheckIcon className="h-5 w-5" />}
            onPress={handleSave}
          >
            {tActions("save")}
          </Button>
        </div>
      </div>

      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.onClose}>
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <ExclamationTriangleIcon className="text-danger h-5 w-5" />
            {t("removeTitle", { provider: "OIDC" })}
          </ModalHeader>
          <ModalBody>
            <p>{t("removeConfirm")}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={deleteModal.onClose}>
              {tActions("cancel")}
            </Button>
            <Button color="danger" onPress={handleDelete}>
              {tActions("remove")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

function EnvManagedBadge({ isOverridden }: { isOverridden?: boolean }) {
  const t = useTranslations("settings.admin.authProviders.envBadge");
  if (isOverridden === undefined) return null;

  return (
    <Chip color={isOverridden ? "success" : "warning"} size="sm" variant="flat">
      {isOverridden ? t("db") : t("env")}
    </Chip>
  );
}

export default function AuthProvidersCard() {
  const t = useTranslations("settings.admin.authProviders");
  const tGithub = useTranslations("settings.admin.authProviders.github.fields");
  const tGoogle = useTranslations("settings.admin.authProviders.google.fields");
  const {
    authProviderOIDC,
    authProviderGitHub,
    authProviderGoogle,
    passwordAuthEnabled,
    updatePasswordAuth,
    isLoading,
  } = useAdminSettingsContext();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyIcon className="h-5 w-5" />
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <RestartRequiredChip />
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <p className="text-default-500 text-base">
          {t("description")}
        </p>

        <div className="bg-default-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{t("passwordAuth.title")}</span>
                <span className="text-default-500 text-base">
                  {t("passwordAuth.description")}
                </span>
              </div>
            </div>
            <Switch
              color="success"
              isDisabled={isLoading}
              isSelected={passwordAuthEnabled ?? false}
              onValueChange={updatePasswordAuth}
            />
          </div>
        </div>

        <Divider />

        <p className="text-default-500 text-base">
          {t("oauthDescription")}
        </p>

        <Accordion selectionMode="multiple" variant="bordered">
          <AccordionItem
            key="oidc"
            subtitle={t("oidc.subtitle")}
            title={
              <span className="flex items-center gap-2">
                {t("oidc.title")} <EnvManagedBadge isOverridden={authProviderOIDC?.isOverridden} />
              </span>
            }
          >
            <OIDCProviderForm
              config={authProviderOIDC as Record<string, unknown> | undefined}
            />
          </AccordionItem>
          <AccordionItem
            key="github"
            subtitle={t("github.subtitle")}
            title={
              <span className="flex items-center gap-2">
                {t("github.title")} <EnvManagedBadge isOverridden={authProviderGitHub?.isOverridden} />
              </span>
            }
          >
            <AuthProviderForm
              config={authProviderGitHub as Record<string, unknown> | undefined}
              fields={[
                { key: "clientId", label: tGithub("clientId") },
                { key: "clientSecret", label: tGithub("clientSecret"), secret: true },
              ]}
              providerKey="github"
              providerName={t("github.title")}
            />
          </AccordionItem>
          <AccordionItem
            key="google"
            subtitle={t("google.subtitle")}
            title={
              <span className="flex items-center gap-2">
                {t("google.title")} <EnvManagedBadge isOverridden={authProviderGoogle?.isOverridden} />
              </span>
            }
          >
            <AuthProviderForm
              config={authProviderGoogle as Record<string, unknown> | undefined}
              fields={[
                {
                  key: "clientId",
                  label: tGoogle("clientId"),
                  placeholder: tGoogle("clientIdPlaceholder"),
                },
                { key: "clientSecret", label: tGoogle("clientSecret"), secret: true },
              ]}
              providerKey="google"
              providerName={t("google.title")}
            />
          </AccordionItem>
        </Accordion>
      </CardBody>
    </Card>
  );
}
