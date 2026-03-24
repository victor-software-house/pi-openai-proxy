# pi-openai-proxy

This repository implements a local OpenAI-compatible HTTP proxy built on pi's SDK (`@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`), without modifying pi.

## Planning documents

Treat these files as agent-first implementation guidance:

- `PLAN.md` — implementation source of truth for architecture, API compatibility policy, security boundaries, phase gates, and acceptance criteria
- `TODO.md` — actionable implementation checklist aligned to `PLAN.md`
- `ROADMAP.md` — short phase summary only

Read `PLAN.md` before implementation work. Keep `TODO.md` and `ROADMAP.md` aligned with it.

## Architecture

The proxy translates OpenAI-style requests into pi SDK calls.

Stable endpoints:

- `GET /v1/models` -> OpenAI-compatible list shape backed by `ModelRegistry`
- `GET /v1/models/{model}` -> OpenAI-compatible model object backed by `ModelRegistry.find()`
- `POST /v1/chat/completions` -> `completeSimple()` or `streamSimple()`

Experimental later work:

- agentic mode using `AgentSession`, preferably behind a separate endpoint or explicit opt-in contract

### Core translation layers

- **Request parsing**: Zod v4 schemas for the supported OpenAI chat-completions subset
- **Message conversion**: OpenAI messages -> pi-ai `Context`
- **Model resolution**: canonical `provider/model-id` -> pi `Model<Api>`
- **Tool conversion**: OpenAI function tools -> pi `Tool[]` via JSON Schema -> TypeBox
- **Streaming bridge**: `AssistantMessageEvent` -> OpenAI chat-completions SSE chunks
- **Response building**: pi `AssistantMessage` + `Usage` -> OpenAI-compatible JSON

### Critical implementation rules

- Canonical external model IDs use `provider/model-id`
- `GET /v1/models/{model}` must support URL-encoded IDs because model IDs can contain `/`
- Reserve `Authorization` for proxy authentication compatibility; do not reuse it for upstream provider overrides
- Keep stable responses close to OpenAI's schema; if pi-specific metadata is exposed, namespace it under a field such as `x_pi`
- Reject unsupported parameters clearly instead of silently ignoring them
- Treat agentic mode as experimental, disabled by default, and security-sensitive

### Key mappings

| OpenAI | Pi |
|---|---|
| `model` | `ModelRegistry.find(provider, id)` after canonical parsing or unique shorthand resolution |
| `messages` | `Context.messages` with `system` and `developer` merged into the effective system prompt |
| `stream: true` | `streamSimple()` + SSE encoding |
| `stream: false` | `completeSimple()` |
| `temperature` | `StreamOptions.temperature` |
| `max_tokens` / `max_completion_tokens` | `StreamOptions.maxTokens` after normalization |
| `reasoning_effort` | `SimpleStreamOptions.reasoning` -> `ThinkingLevel` |
| `tools` | `Context.tools` after JSON Schema -> TypeBox conversion for a supported subset only |
| `tool_choice` | Accepted by schema; passthrough semantics depend on provider |
| `top_p` | `onPayload` passthrough |
| `frequency_penalty` | `onPayload` passthrough |
| `presence_penalty` | `onPayload` passthrough |
| `seed` | `onPayload` passthrough |
| `response_format` | `onPayload` passthrough (`text`, `json_object`) |
| `usage` | pi `Usage` mapped to OpenAI usage fields |
| `finish_reason` | pi `stop` -> `stop`, `length` -> `length`, `toolUse` -> `tool_calls` |

## Dev workflow

- Install deps: `bun install`
- Run in dev: `bun run dev`
- Build: `bun run build`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint` (biome + oxlint with `.oxlintrc.json`)
- Test: `bun test`
- Pre-commit hooks: lefthook (oxlint-fix, biome format, lint, typecheck)
- Conventional commits: enforced via commitlint

## Coding guidelines

- Toolchain: Bun (dev/test), tsdown (npm build), Biome (format/lint), oxlint (type-aware lint with `.oxlintrc.json`)
- Tabs, double quotes, semicolons, `import type` enforced, `node:` protocol
- Import aliases: `@proxy/*` mapped to `src/*` — no relative imports, no `.js` extensions
- Zod v4 for parsing untrusted/external data (HTTP request bodies, JSON.parse boundaries)
- Zod namespace import: `import * as z from "zod"` — never named import
- No `any`, no unsafe type assertions (`as Type`), no `@ts-ignore`
- No `typeof x === 'string'` — use proper type guard functions
- Type guards: `isRecord()` for narrowing `unknown` to `Record<string, unknown>`
- Zod `safeParse()` for validating parsed JSON instead of `as` casts
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`
- Typed `process.env` via `src/env.d.ts` — dot notation, no bracket access on env vars
- Explicit null/undefined comparisons — no truthy coercion on nullable strings
- `exactOptionalPropertyTypes`: optional properties must include `| undefined` in their type

## oxlint strict rules

The `.oxlintrc.json` enforces (matching pi-acp):

- `typescript/no-unsafe-*` (assignment, call, member-access, return, argument, type-assertion)
- `typescript/strict-boolean-expressions`
- `typescript/consistent-type-assertions`
- `typescript/no-floating-promises`, `no-misused-promises`
- `zod/*` rules (consistent-import, no-any-schema, require-error-message, etc.)
- `@limegrass/import-alias` (enforces `@proxy/*` path aliases)

## Source control

- **DO NOT** commit unless explicitly asked

## References

- OpenAI API reference: https://platform.openai.com/docs/api-reference/chat/create
- Pi SDK: `@mariozechner/pi-coding-agent` exports from `dist/index.d.ts`
- Pi AI: `@mariozechner/pi-ai` exports from `dist/index.d.ts`
- Pi mono repo: https://github.com/badlogic/pi-mono
- Sister project: `pi-acp` (ACP adapter) — similar translation patterns, identical tooling config
