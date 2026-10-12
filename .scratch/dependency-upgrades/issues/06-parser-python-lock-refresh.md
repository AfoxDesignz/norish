# 06 — The parser's Python lock picks up the security fixes

Status: ready-for-agent
Blocked by: None. It needs an environment with Python 3.14 and uv; the research sandbox could not download an interpreter.
Target release: 0.25.0-beta

Spec: `.scratch/dependency-upgrades/spec.md`

## What to build

`apps/parser-api` (Python 3.14, uv, FastAPI) runs inside the production image and parses untrusted pages. Its lock (`uv.lock`) holds known-vulnerable versions. Every patched version is allowed by the current constraints (checked against PyPI `requires_dist`), so `uv lock --upgrade-package <name>` per package is enough.

| Package         | Locked | Fix                    | Why it matters                                                                                                                             |
| --------------- | ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| lxml            | 6.0.2  | ≥ 6.1.0 (6.1.3 latest) | CVE-2026-41066: XML entity resolution can read local files, and lxml parses untrusted pages through extruct. cp314 musllinux wheels exist. |
| lxml-html-clean | 0.4.4  | 0.4.5                  | CVE-2026-49825                                                                                                                             |
| starlette       | 0.47.3 | ≥ 1.3.1                | 6 advisories. Lower risk, because the parser listens on 127.0.0.1 only.                                                                    |
| urllib3         | 2.6.3  | 2.8.0                  | 5 advisories (via requests)                                                                                                                |
| anyio           | 4.13.0 | ≥ 4.14.2               | 2 advisories                                                                                                                               |
| idna            | 3.11   | ≥ 3.15                 | CVE-2026-45409                                                                                                                             |
| soupsieve       | 2.8.3  | ≥ 2.9.0                | 4 selector-parsing DoS advisories. Low risk: the selectors are hard-coded.                                                                 |

**Bump the direct dependencies to their latest at the same time:**

- `fastapi` 0.136.1 → 0.143.0. It allows `starlette>=0.46.0` with no upper bound, so land on a FastAPI release that supports the starlette you end up with. starlette 0.x → 1.x is a major of a transitive dependency; read its 1.0 notes for anything FastAPI-facing.
- `uvicorn` 0.46.0 → 0.54.0.
- `beautifulsoup4` 4.14.3 → 4.15.0.
- `recipe-scrapers` 15.12.0 is current.

**Optional:** the image installs uv from the uv 0.12.5 image; 0.13.0 is out.

## Acceptance criteria

- [ ] **Lock.** `uv.lock` holds the fixed versions, and the `pyproject.toml` bounds for direct dependencies are updated.
- [ ] **Tests.** `uv run pytest` passes in apps/parser-api. No CI gate runs the Python tests today; ticket 07 adds `pip-audit`.
- [ ] **Imports.** A production Docker build imports a handful of real recipe URLs, including one through the extruct path, and the E2E URL-import tests pass.
- [ ] **Release notes.** A bullet under `## Fixes and Improvements`: "Security updates to the recipe parser's dependencies."

## Comments

- Filed 2026-10-12 with the spec.
- Source: the PyPI JSON API, including each release's `vulnerabilities` list.
