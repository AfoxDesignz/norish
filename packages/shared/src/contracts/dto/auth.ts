export interface ProviderInfo {
  id: string;
  name: string;
  icon: string;
  type?: "oauth" | "credential";
}

/** How each Sign-in Method is shown; OIDC goes by the administrator's name for it when it has one. */
export const SIGN_IN_METHODS = {
  credential: { id: "credential", name: "Email", icon: "mdi:email-outline", type: "credential" },
  github: { id: "github", name: "GitHub", icon: "mdi:github", type: "oauth" },
  google: { id: "google", name: "Google", icon: "flat-color-icons:google", type: "oauth" },
  oidc: { id: "oidc", name: "SSO", icon: "mdi:shield-account-outline", type: "oauth" },
} as const satisfies Record<string, ProviderInfo>;

export interface AuthProvidersResponse {
  providers: ProviderInfo[];
  registrationEnabled: boolean;
  passwordAuthEnabled: boolean;
}

export type ApiKeyCreateInput = {
  body: {
    name: string;
    expiresIn: null;
    userId: string;
  };
};

export type ApiKeyCreateResult = {
  key: string;
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  enabled: boolean | null;
};

export type ApiKeyVerifyInput = {
  body: { key: string };
};

export type ApiKeyVerifyResult = {
  valid: boolean;
  key?: {
    referenceId: string;
  } | null;
};

export type ApiKeyAuthService = {
  createApiKey(input: ApiKeyCreateInput): Promise<ApiKeyCreateResult>;
  verifyApiKey(input: ApiKeyVerifyInput): Promise<ApiKeyVerifyResult>;
};
