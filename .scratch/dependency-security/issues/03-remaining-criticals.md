# 03 — The two remaining criticals

Status: ready-for-agent
Target version: 0.25.0-beta
Blocked by: none

Spec: `.scratch/dependency-security/spec.md`

## What to build

Clear `protobufjs` < 7.5.5 (GHSA-xq3m-2v4x-88gg, via `@testcontainers/*`) and `shell-quote` ≤ 1.8.3 (GHSA-w7jw-789q-3m8p, via mobile's `react-native` dev tooling): a parent bump where one pulls a fixed version, else an entry in `pnpm-workspace.yaml` `overrides`. Take the version that also clears the same package's high advisories (protobufjs ≥ 7.6.1, shell-quote ≥ 1.9.0) when it is semver-compatible.

## Acceptance criteria

- [ ] `pnpm audit --audit-level=critical` lists nothing for `protobufjs` or `shell-quote`.
- [ ] The repository tests that use testcontainers still pass.
- [ ] `pnpm lint`, `pnpm test:run`, `pnpm build` pass.
