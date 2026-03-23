# pi-openai-proxy

This repository implements a local OpenAI-compatible HTTP proxy built on pi's SDK (`@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`), without modifying pi.

## Planning documents

Treat these files as agent-first implementation guidance:

- `PLAN.md` -- implementation source of truth for architecture, API compatibility policy, security boundaries, phase gates, and acceptance criteria
- `TODO.md` -- actionable implementation checklist aligned to `PLAN.md`
- `ROADMAP.md` -- short phase summary only

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

- **Request parsing**: Zod schemas for the supported OpenAI chat-completions subset
- **Message conversion**: OpenAI messages -> pi-ai `Context`
- **Model resolution**: canonical `provider/model-id` -> pi `Model<Api>`
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
| `usage` | pi `Usage` mapped to OpenAI usage fields |
| `finish_reason` | pi `stop` -> `stop`, `length` -> `length`, `toolUse` -> `tool_calls` |

## Dev workflow

- Install deps: `bun install`
- Run in dev: `bun run dev`
- Build: `bun run build`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint` (biome + oxlint)
- Test: `bun test`

## Coding guidelines

- Toolchain: Bun (dev/test), tsup (npm build), Biome (format/lint), oxlint (type-aware lint)
- Tabs, double quotes, semicolons, `import type` enforced, `node:` protocol
- No `any`, no unsafe type assertions (`as Type`), no `@ts-ignore`
- Zod for parsing untrusted/external data (HTTP request bodies, pi SDK `any` boundaries)
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`
- Explicit null/undefined comparisons -- no truthy coercion on nullable strings

## Source control

- **DO NOT** commit unless explicitly asked

## References

- OpenAI API reference: https://platform.openai.com/docs/api-reference/chat/create
- Pi SDK: `@mariozechner/pi-coding-agent` exports from `dist/index.d.ts`
- Pi AI: `@mariozechner/pi-ai` exports from `dist/index.d.ts`
- Pi mono repo: https://github.com/badlogic/pi-mono
- Sister project: `pi-acp` (ACP adapter) -- similar translation patterns
