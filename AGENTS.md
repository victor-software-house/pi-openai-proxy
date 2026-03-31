# pi-openai-proxy

This repo is a **local OpenAI-compatible HTTP proxy for pi**. It exposes a small OpenAI-style API on top of pi's SDK, model registry, and auth flow.

`AGENTS.md` is always-on Pi context. Keep this file short, precise, and operational. Put deep architecture detail in [`PLAN.md`](PLAN.md), human onboarding in [`README.md`](README.md), the execution checklist in [`TODO.md`](TODO.md), and phase summary in [`ROADMAP.md`](ROADMAP.md).

User instructions override this file.

## Start here

Before changing code:

1. Read [`PLAN.md`](PLAN.md) for architecture, API compatibility policy, and security boundaries.
2. Skim [`README.md`](README.md) for public contract and operator-facing behavior.
3. Check `package.json`, `lefthook.yml`, `biome.json`, `.oxlintrc.json`, and `tsconfig.json` before changing tooling.
4. Use recent git history when behavior or workflow intent is unclear: `git log --oneline -20`.

## Repo shape

- `src/server/` — Hono HTTP app, middleware, routes, request/response handling
- `src/openai/` — OpenAI request schemas, message conversion, tool conversion, SSE/response shaping
- `src/pi/` — pi SDK integration and model registry resolution
- `src/config/` — env/config parsing and validation
- `src/sync/` — external/editor sync integrations
- `extensions/` — Pi extension surface for the package
- `test/unit/`, `test/integration/`, `test/conformance/` — behavior checks
- `docs/` — supporting analysis/discovery docs, not the main source of truth

## Core constraints

Treat these as stable unless the user explicitly changes direction:

- Stable HTTP surface is:
  - `GET /v1/models`
  - `GET /v1/models/{model}`
  - `POST /v1/chat/completions`
- Canonical internal model IDs use `provider/model-id`.
- `GET /v1/models/{model}` must support URL-encoded IDs because model IDs may contain `/`.
- Reserve `Authorization` for proxy auth compatibility. Do **not** repurpose it for upstream provider override headers.
- Keep stable responses close to OpenAI's schema. If pi-specific metadata is exposed, namespace it under `x_pi`.
- Reject unsupported parameters clearly. Do **not** silently ignore them.
- Agentic mode is experimental and security-sensitive. Do not expand it casually under the stable chat-completions contract.
- Default network posture should remain local-first and safe by default.

For detailed rationale and edge cases, defer to [`PLAN.md`](PLAN.md) instead of duplicating them here.

## Coding rules that matter in this repo

- Runtime/tooling: **Bun + TypeScript + Hono + Zod v4 + TypeBox**.
- Use import alias `@proxy/*` for `src/*`. Do **not** introduce relative imports across the source tree.
- Use `import type` where required.
- Use `node:` protocol for Node built-ins.
- Use `import * as z from "zod"`; do not use named Zod imports.
- Validate untrusted input with Zod at boundaries.
- Prefer `safeParse()` over assertion-based parsing.
- No `any`, no `@ts-ignore`, no unsafe `as Type` casts.
- Use repo type guards such as `isRecord()` instead of ad-hoc unsafe narrowing.
- Respect strict TS settings, especially `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noPropertyAccessFromIndexSignature`.
- `process.env` is typed via `src/env.d.ts`; prefer dot notation.

## Verification workflow

When you change code, run the smallest relevant checks first, then expand as needed.

Common commands:

```bash
bun run typecheck
bun run lint
bun test
bun run build
```

Expected discipline in this repo:

- Before committing, run **lint + tests**.
- If types were affected, run `bun run typecheck` too.
- If packaging/runtime entrypoints changed, run `bun run build`.
- If only docs changed, skip code checks unless the change affects documented commands or behavior.
- In your summary, state exactly what you ran and what you did **not** run.

Hook-backed workflow already exists and should be preserved:

- `commit-msg` -> commitlint
- `pre-commit` -> format, lint, typecheck
- `pre-push` -> lockfile sync check, typecheck, lint, `bun run test:ci`

Do not weaken these hooks unless the user asks.

## Git workflow

Repository preference:

- Make **frequent small commits** for logical slices.
- Use **Conventional Commits**.
- It is safe to **push automatically**, including `main`, when the task is complete and verified.
- Normal collaboration model is **feature branches + PRs**.

Practical guidance:

- Keep commits reviewable and scoped.
- Prefer one logical concern per commit.
- If the work changes behavior materially, update docs in the same slice.
- Do not rewrite history unless the user asks.

## Docs synchronization

Keep durable docs aligned with implementation:

- Update [`PLAN.md`](PLAN.md) when architecture, constraints, compatibility policy, or security boundaries change.
- Update [`TODO.md`](TODO.md) when execution status or next tasks change.
- Update [`ROADMAP.md`](ROADMAP.md) when the current phase summary changes.
- Update [`README.md`](README.md) when user-facing behavior, installation, configuration, or public API examples change.
- Prefer linking to those docs from here instead of copying large sections into `AGENTS.md`.

## When to stop and ask

Stop and confirm with the user before:

- expanding the stable API surface beyond the documented endpoints
- changing auth semantics or header contracts
- altering model ID resolution behavior or exposure policy
- loosening validation/security behavior
- weakening hooks, lint/type-safety rules, or release workflow
- making a broad refactor across server/openai/pi translation layers without clear acceptance criteria

## Scope of this file

A single repo-root `AGENTS.md` is enough for the current tree. Add nested `AGENTS.md` files only if a subtree develops a genuinely different workflow or safety boundary.
