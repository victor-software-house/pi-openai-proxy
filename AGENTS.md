# pi-openai-proxy

This repository implements a local OpenAI-compatible HTTP proxy built on pi's SDK (`@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`), without modifying pi.

## Architecture

The proxy translates OpenAI API requests into pi SDK calls:

- `GET /v1/models` -> `ModelRegistry.getAll()` / `ModelRegistry.getAvailable()`
- `GET /v1/models/:model` -> `ModelRegistry.find(provider, modelId)`
- `POST /v1/chat/completions` (non-streaming) -> `completeSimple()`
- `POST /v1/chat/completions` (streaming) -> `streamSimple()` + SSE encoding
- `POST /v1/chat/completions` (agentic, Phase 3) -> `AgentSession.prompt()`

### Translation layers

- **Request parsing**: Zod schemas validating OpenAI request bodies
- **Message conversion**: OpenAI messages -> pi-ai `Message[]` + `Context`
- **Model resolution**: `provider/model-id` string -> pi `Model<Api>` via `ModelRegistry`
- **SSE encoding**: pi `AssistantMessageEvent` -> OpenAI SSE chunk format
- **Response building**: pi `AssistantMessage` + `Usage` -> OpenAI response JSON

### Key mappings

| OpenAI | Pi |
|---|---|
| `model` field | `ModelRegistry.find(provider, id)` |
| `messages` array | `Context.messages` (system -> `systemPrompt`) |
| `stream: true` | `streamSimple()` + async iteration over `AssistantMessageEvent` |
| `stream: false` | `completeSimple()` |
| `temperature` | `StreamOptions.temperature` |
| `max_tokens` | `StreamOptions.maxTokens` |
| `reasoning_effort` | `SimpleStreamOptions.reasoning` -> `ThinkingLevel` |
| `tools` | `Context.tools` (JSON Schema -> TypeBox conversion) |
| `usage` | `AssistantMessage.usage` + `calculateCost()` |
| `finish_reason` | `StopReason` mapping: `stop`->`stop`, `length`->`length`, `toolUse`->`tool_calls` |

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
