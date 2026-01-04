"use client";

import type { ProviderKey, FieldDef, TestResult } from "./types";

import { useState, useCallback } from "react";
import { Input, useDisclosure, addToast } from "@heroui/react";

import { useAdminSettingsContext } from "../../context";

import { DeleteProviderModal } from "./delete-provider-modal";
import { ProviderActions } from "./provider-actions";
import { TestResultDisplay } from "./test-result-display";

import { ServerConfigKeys, type ServerConfigKey } from "@/server/db/zodSchemas/server-config";
import SecretInput from "@/components/shared/secret-input";

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

export function AuthProviderForm({
  providerKey,
  providerName,
  config,
  fields,
}: AuthProviderFormProps) {
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
  const [testResult, setTestResult] = useState<TestResult | null>(null);
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
      if (providerKey === "github") {
        await updateAuthProviderGitHub(
          saveValues as Parameters<typeof updateAuthProviderGitHub>[0]
        );
      } else if (providerKey === "google") {
        await updateAuthProviderGoogle(
          saveValues as Parameters<typeof updateAuthProviderGoogle>[0]
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const result = await deleteAuthProvider(providerKey);

    if (!result.success) {
      deleteModal.onClose();
      addToast({
        severity: "danger",
        title: "Cannot delete provider",
        description: result.error,
      });

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

      <TestResultDisplay result={testResult} />

      <ProviderActions
        hasConfig={!!config}
        saving={saving}
        testing={testing}
        onDeleteClick={deleteModal.onOpen}
        onSave={handleSave}
        onTest={handleTest}
      />

      <DeleteProviderModal
        isOpen={deleteModal.isOpen}
        providerName={providerName}
        onClose={deleteModal.onClose}
        onConfirm={handleDelete}
      />
    </div>
  );
}
