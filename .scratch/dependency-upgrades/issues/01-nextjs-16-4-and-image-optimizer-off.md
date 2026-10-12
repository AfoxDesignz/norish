# 01 — Next.js moves to 16.4 and the image optimizer is switched off

Status: ready-for-agent
Blocked by: None — can start immediately
Target release: 0.25.0-beta

Spec: `.scratch/dependency-upgrades/spec.md`

## What to build

Move `next` from 16.3.2 to **16.4.0**: npm `latest`, released 2026-10-06. No 17.x exists, not even as a canary. React and sharp move with it, and Norish switches off the image optimizer it never needed. Together this clears:

- every Next.js advisory against 16.3.2:
  - three critical RCEs (AVIF in the image optimizer, Windows path handling, `next/og`);
  - an SSRF in the image optimizer;
  - two SSG/ISR cache poisonings;
  - three information disclosures.

  All of these are fixed by 16.3.8, which 16.4.0 contains.

- the two sharp advisories (libheif GHSA-rgj7-g3m4-5g8c, librsvg GHSA-wq5f-xc86-pv6w) that Norish's own media pipeline is exposed to.

Changes:

- **Catalog (`pnpm-workspace.yaml`):**
  - `next` 16.4.0;
  - `react` and `react-dom` 19.3.0;
  - `@types/react` and `@types/react-dom` 19.3.0.

  The React packages move together, because react-dom 19.3 requires `react ^19.3.0`.

- **sharp `^0.35.5`** in `packages/shared-server/package.json` and `tooling/ingredient-icons/package.json`. Since 16.3.4, Next declares an optional `sharp ^0.35.4`, and with the hoisted linker two sharp versions can end up installed. Bump both places.
- **`next-intl` `^4.14.9`** (apps/web) and **`@next/eslint-plugin-next` `^16.4.0`** (tooling/eslint).
  - next-intl: use-intl's runtime is identical to 4.13.7. 4.14 adds an optional `@types/react` peer and fixes the plugin's Turbopack loader options.
  - The eslint plugin is identical apart from its version.
- **`images: { unoptimized: true }` in `apps/web/next.config.js`** (today it has no `images` key).
  - Every `next/image` in the app already renders unoptimized or loads an SVG, which Next never optimizes.
  - With this set, Next answers 404 on `/_next/image`. That removes the whole optimizer attack surface (AVIF RCE, SSRF, optimizer DoS) on this and every future Next version.
  - Update the comment in `apps/web/app/sw.ts` that still refers to the optimizer.
  - apps/landing is a static export and cannot use the optimizer; confirm it and leave it alone.
- **`apps/web/app/images/splash/route.tsx`:** drop `export const runtime = "edge"`. The edge runtime is deprecated and already warns. Moving to the Node runtime is only safe on ≥ 16.3.6, because the `next/og` RCE affected the Node runtime. Re-check the splash PNG: `next/og` now bundles @vercel/og 1.0.1 and satori 0.29 (was 0.11.1 / 0.25).
- **The coding-agent upgrade nudge (`experimental.agentUpgrade`, default `'security'` since 16.4).**
  - When a coding-agent environment variable is set (`CLAUDECODE`, `CODEX_*`, `CURSOR_AGENT`, `GEMINI_CLI`, …) and the installed Next has a published advisory, `next build` exits 1 at the end. The dev server — including Norish's custom one, which runs Next's router server — exits once; a retry within five minutes continues.
  - Dev mode queries registry.npmjs.org on every start (skipped in CI).
  - Production and CI are unaffected.
  - **Recommended:** set `experimental: { agentUpgrade: false }` in both Next configs, and let ticket 07's audit gate be the one place a new advisory fails the build. Otherwise a new advisory fails every agent's `pnpm build`, the repo's definition-of-done gate. The alternative is to keep the default and document the retry. Decide in review.

## Notes

**Exposure in Norish.** Reachability comes from the patch diffs, the advisory titles and Norish's code, not from the GHSA texts, which were unreachable from the sandbox.

| Advisory                                                                          | Reachable?                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AVIF RCE (GHSA-2xp9-vwfh-vxw4)                                                    | **Yes**                         | `/_next/image` is served (no `images` key) and skips the auth proxy (`apps/web/proxy.ts` matcher excludes `_next`). Its internal fetch carries no cookies, but share links serve stored `.avif` media without sign-in (`lib/recipe-share-access.ts`, `lib/recipe-media.ts`), so a signed-in user can plant a file and anyone with the link can trigger the decode. Inferred, not reproduced. Separately, `packages/shared-server/src/media/storage.ts` decodes every imported or uploaded AVIF with sharp 0.35.3. The patch path says the bug is in libheif decoding: 16.3.3 passed AVIF through untouched, and 16.3.8 decodes again on sharp ≥ 0.35.4. |
| Windows RCE (CVE-2026-75604)                                                      | Not on the Docker image (Linux) | Windows dev machines and bare-metal hosts are exposed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `next/og` RCE (GHSA-vcvr-r3jv-pc5j)                                               | No                              | Only clamped integers and two fixed palettes reach the splash image.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SSRF (CVE-2026-94483)                                                             | No                              | No `remotePatterns` or `domains`, so remote images are never fetched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SSG/ISR poisoning (CVE-2026-94484, CVE-2026-94543)                                | Unlikely                        | No ISR. The root layout reads headers and cookies; only `/serwist/sw.js` and the manifest are prerendered. Cannot be fully ruled out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Metadata image routes (CVE-2026-94485), `use cache` + Draft Mode (CVE-2026-94544) | No                              | Neither is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dev MCP endpoint (CVE-2026-94486)                                                 | Dev only                        | The dev server binds 0.0.0.0, so the endpoint is reachable from the LAN while developing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**What 16.4 changes that touches Norish:**

- **Internal routing was rewritten:** the route-matcher managers are gone and the client navigator is new. The custom server (`packages/api/src/startup/http-server.ts`) uses only `next()`, `prepare()` and `getRequestHandler()`. Their signatures are unchanged; only the internal `compileMode` option was dropped. This is still the biggest behavioural risk, and only the E2E suite catches it.
- **Production Turbopack output** now uses one shared runtime plus a bootstrap inlined into the HTML, and mangles export names.
  - Serwist builds its precache list from `.next/static` when it prerenders `/serwist/[path]`; the offline E2E project covers that.
  - Inline scripts would clash with a page CSP, but Norish sets a CSP only on `/serwist/:path*`.
- **`reactBrowserBailout`** is on by default. No effect is expected: no `next/dynamic` call uses `ssr: false`.

**Doesn't touch Norish:**

- the parallel-routes slot changes and strict route matching (there are no `@slot` directories);
- the removed `appNewScrollHandler` and `partialPrefetching: 'unstable_eager'`;
- the Cache Components–only APIs (typed `cacheLife()`, `navigation()` / `prefetch()`, `ensureStatic`);
- FID attribution and the narrowed `experimental.ppr`;
- the React 18 deprecation warning;
- the `distDir` location check;
- the Turbopack worker-thread fallback on Node ≥ 24.13.1;
- `agentRules`, which only runs under `next dev` (apps/landing).

16.4 ships no codemods.

**Also in 16.3.3–16.3.8, beyond the security fixes:**

- 0-byte image-cache entries no longer break the cache;
- the CSP nonce reaches component scripts;
- `/_next/data` matching is case-sensitive;
- Playwright test-mode fetch recursion is fixed.

**Fallback.** If the release candidate cannot take a minor, ship **16.3.8** instead. It is a pure patch with no changed defaults. Keep the same sharp bump and `images.unoptimized`, and move to 16.4 at the start of 0.26.

## Acceptance criteria

- [ ] **Versions.** The catalog has `next` 16.4.0 (or 16.3.8 per the fallback) and React plus its types at 19.3.0; sharp is `^0.35.5` everywhere. `pnpm why next react react-dom sharp` shows one version of each.
- [ ] **Audit.** `pnpm audit --prod` reports nothing for `next`, `react*` or `sharp`.
- [ ] **Optimizer off.** On a production build `/_next/image?url=/nora.jpg&w=640&q=75` returns 404. Every image still renders: recipe cards, recipe page, avatars, logo, landing.
- [ ] **Upgrade nudge.** The `agentUpgrade` decision is applied in both Next configs, or the default is kept and documented in `CONTRIBUTING.md`.
- [ ] **Splash.** `/images/splash?width=1170&height=2532&scheme=dark` renders correctly on the Node runtime.
- [ ] **Service worker.** `/serwist/sw.js` still prerenders and returns 200 with its headers, and the offline E2E project passes.
- [ ] **Media pipeline.** An imported or uploaded AVIF and HEIC image is still stored as JPEG.
- [ ] **Smoke.**
  - Signed out, `/` redirects to `/login`.
  - The `/trpc` WebSocket connects.
  - `pnpm dev` boots.
- [ ] **Gates.** `pnpm lint`, `pnpm test:run`, `pnpm i18n:check`, `pnpm build`, the full `pnpm test:e2e`, `pnpm docker:build` with the health check, and `pnpm --filter @norish/landing build` all pass. Check the build log for new warnings.
- [ ] **Release notes.** Under `## Fixes and Improvements` in `apps/docs/docs/release-notes/0.25.0-beta.md` (add the heading if it's missing): the security update to Next.js 16.4, and the image optimization endpoint no longer being served. No environment variables change.

## Non-goals

These are follow-ups listed in the spec, not part of this ticket:

- the React 19.3 `<ViewTransition>`;
- `next analyze`;
- custom-server clean-up (`url.parse`, the `serveStaticFile` that never serves);
- the Cache Components spike.

## Comments

- Filed 2026-10-12 with the spec. Sources:
  - the next 16.3.2, 16.3.3, 16.3.8 and 16.4.0 tarballs (`dist/docs`, `server/config-shared.js`, `config-schema.js`, `image-optimizer`, `next-server.js`, `lib/upgrade/nudge.js`, `server/lib/router-server.js`, `compiled/@vercel/og`);
  - react and react-dom 19.2.3 and 19.3.0;
  - next-intl 4.13.7 and 4.14.9;
  - the npm bulk advisory endpoint.
