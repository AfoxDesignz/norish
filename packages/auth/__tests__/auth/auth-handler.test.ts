// @vitest-environment node
/**
 * The real auth config through Better Auth's HTTP handler: OIDC sign-in
 * against a fake identity provider that signs RS256 ID tokens, sign-out, API
 * keys, account deletion and rate limits, with a real Redis for state, sessions
 * and counters. Better Auth's memory adapter stands in for Postgres, so the
 * encrypted-email adapter runs as shipped.
 */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
import type { StartedRedisContainer } from "@testcontainers/redis";
import type { AddressInfo } from "node:net";
import { RedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getRedisConnectionOptions } from "@norish/shared-server/redis/client";

import { REDIS_IMAGE } from "../../../shared-server/__tests__/helpers/redis";

const { store, client, registration } = vi.hoisted(() => ({
  store: { user: [], session: [], account: [], verification: [], apikey: [] } as Record<
    string,
    unknown[]
  >,
  client: { redis: null as unknown },
  registration: { enabled: true },
}));

vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");

  return { drizzleAdapter: () => memoryAdapter(store) };
});

vi.mock("@norish/db/drizzle", () => ({ db: {} }));
vi.mock("@norish/db/repositories/api-keys", () => ({ setApiKeyAuthService: vi.fn() }));
vi.mock("@norish/db/repositories/server-config", () => ({ setConfig: vi.fn() }));
vi.mock("@norish/db/repositories/users", () => ({
  countUsers: vi.fn().mockResolvedValue(2),
  deleteUser: vi.fn(),
}));
vi.mock("@norish/db/repositories/households", () => ({ getHouseholdForUser: vi.fn() }));
vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  isRegistrationEnabled: async () => registration.enabled,
}));
vi.mock("@norish/shared-server/media/avatar-cleanup", () => ({ sweepUserAvatars: vi.fn() }));
vi.mock("@norish/shared-server/realtime/connection", () => ({
  emitConnectionInvalidation: vi.fn(),
}));
vi.mock("@norish/shared-server/logger", () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return { authLogger: logger, trpcLogger: logger, createLogger: () => logger };
});
vi.mock("@norish/shared-server/redis/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@norish/shared-server/redis/client")>()),
  getPublisherClient: async () => client.redis,
}));

const AUTH_URL = "http://localhost:3000";
const CALLBACK = `${AUTH_URL}/api/auth/callback/oidc`;
const CLIENT_ID = "norish";

type Identity = { sub: string; email: string; email_verified?: boolean; name?: string };

/** A minimal OIDC provider: discovery, JWKS, token and userinfo. */
function createIdentityProvider() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rogueKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };
  const grants = new Map<string, { identity: Identity; nonce: string | null; forged: boolean }>();
  const tokenRequests: URLSearchParams[] = [];
  let issuer = "";
  let hanging = false;

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signIdToken = (claims: Record<string, unknown>, key = privateKey) => {
    const input = `${encode({ alg: "RS256", kid: "test", typ: "JWT" })}.${encode(claims)}`;

    return `${input}.${sign("sha256", Buffer.from(input), key).toString("base64url")}`;
  };

  const server = createServer(async (req, res) => {
    // A provider that takes the connection and never answers.
    if (hanging) return;

    const url = new URL(req.url ?? "/", issuer);
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }

    if (url.pathname === "/jwks") return json({ keys: [jwk] });

    if (url.pathname === "/token") {
      let body = "";

      for await (const chunk of req) body += chunk;

      const params = new URLSearchParams(body);
      const grant = grants.get(params.get("code") ?? "");

      tokenRequests.push(params);

      if (!grant) {
        res.writeHead(400, { "content-type": "application/json" });

        return res.end(JSON.stringify({ error: "invalid_grant" }));
      }

      const now = Math.floor(Date.now() / 1000);

      return json({
        access_token: `access-${grant.identity.sub}`,
        token_type: "Bearer",
        expires_in: 3600,
        id_token: signIdToken(
          {
            iss: issuer,
            aud: CLIENT_ID,
            iat: now,
            exp: now + 300,
            ...(grant.nonce ? { nonce: grant.nonce } : {}),
            ...grant.identity,
          },
          grant.forged ? rogueKey : privateKey
        ),
      });
    }

    if (url.pathname === "/userinfo") {
      const sub = req.headers.authorization?.replace("Bearer access-", "");
      const grant = [...grants.values()].find((candidate) => candidate.identity.sub === sub);

      return json(grant?.identity ?? {});
    }

    res.writeHead(404).end();
  });

  return {
    tokenRequests,
    get listening() {
      return server.listening;
    },
    set hanging(value: boolean) {
      hanging = value;
    },
    async start(port = 0) {
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      return issuer;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
    /** The user signs in at the provider, which sends them back with a code. */
    authorize(authorizationUrl: URL, identity: Identity, { forged = false } = {}) {
      const code = randomUUID();

      grants.set(code, { identity, nonce: authorizationUrl.searchParams.get("nonce"), forged });

      const callback = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? "");

      callback.searchParams.set("code", code);
      callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "");

      return callback;
    },
  };
}

const idp = createIdentityProvider();
let container: StartedRedisContainer;
let redis: Redis;
let issuer: string;

type AuthModule = typeof import("@norish/auth/auth");
let authModule: AuthModule;

function cookiesFrom(response: Response, previous = ""): string {
  const jar = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((pair) => pair.split("=") as [string, string])
  );

  for (const cookie of response.headers.getSetCookie()) {
    const [pair = ""] = cookie.split(";");
    const index = pair.indexOf("=");

    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function post(path: string, body: unknown, cookie = "", forwardedFor = "203.0.113.7"): Request {
  return new Request(`${AUTH_URL}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: AUTH_URL,
      "x-forwarded-for": forwardedFor,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Clicks the provider button, signs in at the provider and lands back on Norish. */
async function signInWithOIDC(identity: Identity, options?: { forged?: boolean }) {
  const { auth } = authModule;
  const start = await auth.handler(
    post("/sign-in/social", { provider: "oidc", callbackURL: "/", errorCallbackURL: "/auth-error" })
  );
  const { url } = (await start.json()) as { url: string };
  const authorizationUrl = new URL(url);
  const callback = idp.authorize(authorizationUrl, identity, options);
  const response = await auth.handler(
    new Request(callback, { headers: { cookie: cookiesFrom(start) } })
  );

  return { authorizationUrl, response, cookie: cookiesFrom(response) };
}

async function sessionFor(cookie: string) {
  return authModule.auth.api.getSession({ headers: new Headers({ cookie }) });
}

async function context() {
  return authModule.auth.$context;
}

async function importAuth(): Promise<AuthModule> {
  vi.resetModules();

  const { setAuthProviderCache } = await import("@norish/auth/provider-cache");

  setAuthProviderCache({
    github: { clientId: "github-id", clientSecret: "github-secret", isOverridden: false },
    google: { clientId: "google-id", clientSecret: "google-secret", isOverridden: false },
    oidc: {
      name: "Test IdP",
      issuer,
      clientId: CLIENT_ID,
      clientSecret: "secret",
      isOverridden: false,
    },
    passwordEnabled: true,
  });

  return import("@norish/auth/auth");
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_URL", AUTH_URL);
  vi.stubEnv("AUTH_RATE_LIMIT_ENABLED", "true");
  vi.stubEnv("TRUSTED_PROXIES", "10.0.0.0/24");
  container = await new RedisContainer(REDIS_IMAGE).start();
  redis = new Redis(getRedisConnectionOptions(container.getConnectionUrl()));
  client.redis = redis;
  issuer = await idp.start();
  authModule = await importAuth();
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await idp.stop();
  await redis?.quit();
  await container?.stop();
});

beforeEach(async () => {
  for (const rows of Object.values(store)) rows.length = 0;
  await redis.flushall();
  registration.enabled = true;
});

const ADA: Identity = {
  sub: "ada-sub",
  email: "ada@example.com",
  email_verified: true,
  name: "Ada",
};

describe("OIDC sign-in", () => {
  it("creates the user on first sign-in and keys the account on the subject", async () => {
    const { response, cookie } = await signInWithOIDC(ADA);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).not.toContain("error");

    const session = await sessionFor(cookie);

    expect(session?.user.email).toBe(ADA.email);
    expect(store.account).toEqual([
      expect.objectContaining({ providerId: "oidc", accountId: ADA.sub }),
    ]);
  });

  it("signs a returning user in to the same account", async () => {
    const first = await signInWithOIDC(ADA);
    const firstUser = (await sessionFor(first.cookie))?.user.id;
    const second = await signInWithOIDC(ADA);

    expect((await sessionFor(second.cookie))?.user.id).toBe(firstUser);
    expect(store.user).toHaveLength(1);
    expect(store.account).toHaveLength(1);
  });

  it("sends the callback URL the docs tell administrators to register", async () => {
    const { authorizationUrl } = await signInWithOIDC(ADA);

    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(idp.tokenRequests.at(-1)?.get("redirect_uri")).toBe(CALLBACK);
  });

  it("refuses an ID token the provider's key did not sign", async () => {
    const { response } = await signInWithOIDC(ADA, { forged: true });

    expect(response.headers.get("location")).toContain("error=unable_to_get_user_info");
    expect(store.user).toHaveLength(0);
  });

  it("sends a new user to the error page while registration is closed", async () => {
    registration.enabled = false;

    const { response } = await signInWithOIDC(ADA);

    expect(response.headers.get("location")).toContain(
      "/auth-error?error=REGISTRATION_IS_CURRENTLY_DISABLED"
    );
    expect(store.user).toHaveLength(0);
  });
});

describe("account linking", () => {
  it("refuses to link an OIDC sign-in to an existing user with the same verified email", async () => {
    const ctx = await context();
    const { user } = await ctx.internalAdapter.createOAuthUser(
      { email: ADA.email, name: "Ada", emailVerified: true },
      { providerId: "google", accountId: "google-1" }
    );

    const { response } = await signInWithOIDC(ADA);

    expect(response.headers.get("location")).toContain("/auth-error?error=account_not_linked");
    expect((await ctx.internalAdapter.findAccounts(user.id)).map((a) => a.providerId)).toEqual([
      "google",
    ]);
  });
});

describe("sign-out", () => {
  it("ends the session without sending the user to the provider's logout page", async () => {
    const { cookie } = await signInWithOIDC(ADA);

    const response = await authModule.auth.handler(post("/sign-out", {}, cookie));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).not.toHaveProperty("url");
    expect(await sessionFor(cookie)).toBeNull();
  });
});

describe("API keys", () => {
  it("signs a request in as the key's owner", async () => {
    const { cookie } = await signInWithOIDC(ADA);
    const userId = (await sessionFor(cookie))?.user.id ?? "";
    const { key } = await authModule.auth.api.createApiKey({ body: { userId, name: "Scripts" } });

    const session = await authModule.auth.api.getSession({
      headers: new Headers({ "x-api-key": key }),
    });

    expect(session?.user.id).toBe(userId);
  });
});

describe("account deletion", () => {
  it("ends every session of the deleted user at once", async () => {
    const first = await signInWithOIDC(ADA);
    const second = await signInWithOIDC(ADA);
    const userId = (await sessionFor(first.cookie))?.user.id ?? "";
    const { deleteUserAccount } = await import("@norish/auth/account-deletion");

    await deleteUserAccount(userId);

    expect(await sessionFor(first.cookie)).toBeNull();
    expect(await sessionFor(second.cookie)).toBeNull();
  });
});

describe("rate limiting", () => {
  it("answers the fourth sign-in attempt within ten seconds with 429", async () => {
    const attempt = () =>
      authModule.auth.handler(post("/sign-in/email", { email: ADA.email, password: "wrong-pass" }));
    const statuses = [];

    for (let i = 0; i < 4; i++) statuses.push((await attempt()).status);

    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);
  });

  it("limits each visitor on their own behind two trusted proxies", async () => {
    // A second proxy appends the first one's address, so the header holds two hops.
    const attempt = (visitor: string) =>
      authModule.auth.handler(
        post(
          "/sign-in/email",
          { email: ADA.email, password: "wrong-pass" },
          "",
          `${visitor}, 10.0.0.2`
        )
      );

    for (let i = 0; i < 3; i++) await attempt("198.51.100.1");

    expect((await attempt("198.51.100.1")).status).toBe(429);
    expect((await attempt("198.51.100.2")).status).not.toBe(429);
  });
});

describe("an identity provider that is down when Norish starts", () => {
  it("turns OIDC sign-in on once the provider can be reached again", async () => {
    const port = Number(new URL(issuer).port);

    await idp.stop();
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      authModule = await importAuth();

      // Held the way the auth route holds it, from before the instance is rebuilt.
      const handler = authModule.auth.handler;
      const startSignIn = () =>
        handler(post("/sign-in/social", { provider: "oidc", callbackURL: "/" }));

      expect((await startSignIn()).status).toBe(404);

      // A provider that is back is asked again only once the retry delay is up.
      await idp.start(port);
      expect((await startSignIn()).status).toBe(404);

      vi.setSystemTime(Date.now() + 30_000);

      // The next use builds a replacement in the background, which takes over
      // once it has the provider.
      await authModule.auth.api.getSession({ headers: new Headers() });
      await vi.waitFor(async () => {
        const ctx = await authModule.auth.$context;

        expect(ctx.socialProviders.map((provider) => provider.id)).toContain("oidc");
      });

      expect((await startSignIn()).status).toBe(200);
    } finally {
      vi.useRealTimers();
      if (!idp.listening) await idp.start(port);
    }
  });

  it("keeps answering session checks while a provider that never responds is retried", async () => {
    const port = Number(new URL(issuer).port);

    await idp.stop();
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      authModule = await importAuth();
      expect(
        (
          await authModule.auth.handler(
            post("/sign-in/social", { provider: "oidc", callbackURL: "/" })
          )
        ).status
      ).toBe(404);

      idp.hanging = true;
      await idp.start(port);
      vi.setSystemTime(Date.now() + 30_000);

      // The replacement's discovery request never gets an answer.
      await expect(authModule.auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
      idp.hanging = false;
      if (!idp.listening) await idp.start(port);
    }
  });
});
