# 04 — The image runs a current Node 22

Status: ready-for-agent
Blocked by: None — can start immediately
Target release: 0.25.0-beta

Spec: `.scratch/dependency-upgrades/spec.md`

## What to build

The production image is built `FROM node:22-alpine3.21`. That tag was last pushed on 2025-10-30 with Node 22.21.1; docker-node now builds Node 22 only for alpine3.23 and alpine3.24. As a result:

- the image has missed four Node security releases: 22.22.0, 22.22.2, 22.23.0 and 22.23.2;
- the `apk upgrade` in the Dockerfile does not update Node;
- the image runs a different Node from CI, which uses `.nvmrc`'s 22.23.2.

Changes:

- **Base image.** `docker/Dockerfile` moves to `node:22-alpine3.24` (22.23.3 at research time) in both `FROM` lines that use it. `.nvmrc` moves to the same version.
- **Everything that names the Node version agrees with it:**
  - `.devcontainer/default/Dockerfile`;
  - `.github/workflows/_docker-build.yml`;
  - `CONTRIBUTING.md`, which still says 22.22.0.
- **`@types/node` `^22.20.5`** in the catalog, replacing `^25.9.5`. The 25.x types accept Node 23–25 APIs that fail at runtime on Node 22, so the types should follow the runtime major (`^24` with ticket 15). The vitest and vite peer ranges accept both.
- **Alpine packages on 3.24.** Re-check the packages the image installs (`libc6-compat`, `vips-dev`, `ffmpeg`, and the Python 3.14 install through uv).
- **Settle the libvips question while you're in there.**
  - sharp 0.35 ships a prebuilt libvips and has no install script.
  - The image sets `SHARP_IGNORE_GLOBAL_LIBVIPS=0`, which sharp reads as truthy, so it should be using the prebuilt one.
  - Run `node -e "console.log(require('sharp').versions)"` inside the container and record the output in this ticket's comments.
  - If it reports the prebuilt libvips, then `vips-dev` and the variable are dead weight: remove them in this PR, or file the removal.

## Acceptance criteria

- [ ] **Node version.** `docker run … node --version` prints v22.23.3 (or the newest 22.x at implementation time).
- [ ] **Consistency.** `.nvmrc`, the devcontainer, the CI workflows and `CONTRIBUTING.md` name the same version.
- [ ] **Types.** `@types/node` is `^22.x` in the catalog. A strict `tsc --noEmit` on packages/db, which type-checks for real, passes.
- [ ] **Image smoke.**
  - `pnpm docker:build` succeeds and the container starts.
  - `/api/v1/health` is OK.
  - A video import works (ffmpeg, yt-dlp).
  - An image upload works (sharp, HEIC).
  - A URL import through the parser works (Python).
- [ ] **libvips.** The `sharp.versions` output is recorded in the comments.
- [ ] **E2E.** `pnpm test:e2e` passes.
- [ ] **Release notes.** A bullet under `## Fixes and Improvements`: "The Docker image now runs Node.js 22.23 (security fixes)."

## Comments

- Filed 2026-10-12 with the spec.
- Sources:
  - the Docker Hub tags API for `library/node`;
  - `versions.json` from nodejs/docker-node;
  - `index.json` from nodejs.org/dist.
