# TODO

Open issues, gaps, and decisions. Checked items are resolved.

## Project Setup

- [ ] Initialize Bun project with `package.json`
- [ ] Configure `tsconfig.json` (strict mode, path aliases)
- [ ] Configure Biome (`biome.json`) and oxlint
- [ ] Configure tsdown for npm builds
- [ ] Add Hono as HTTP server dependency
- [ ] Add `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` as dependencies
- [ ] Add Zod for request validation
- [ ] Set up lefthook for pre-commit hooks
- [ ] CLI entry point (`src/index.ts`) with port configuration

## OpenAI API Conformance

### Chat Completions -- Request

- [ ] `model` -- resolve `provider/model-id` via `ModelRegistry.find()`
- [ ] `model` -- shorthand resolution (bare model ID scans all providers)
- [ ] `messages` -- convert `system` role to `Context.systemPrompt`
- [ ] `messages` -- convert `user` role (text content) to `UserMessage`
- [ ] `messages` -- convert `user` role (image content, base64) to `ImageContent`
- [ ] `messages` -- convert `user` role (image content, URL) -- fetch and convert to base64
- [ ] `messages` -- convert `assistant` role (text) to `AssistantMessage`
- [ ] `messages` -- convert `assistant` role with `tool_calls` to `AssistantMessage` with `ToolCall` content
- [ ] `messages` -- convert `tool` role to `ToolResultMessage`
- [ ] `stream` -- route to `streamSimple()` vs `completeSimple()`
- [ ] `temperature` -- passthrough to `StreamOptions`
- [ ] `max_tokens` / `max_completion_tokens` -- passthrough to `StreamOptions.maxTokens`
- [ ] `tools` -- convert OpenAI JSON Schema tool defs to pi-ai `Tool` (TypeBox)
- [ ] `tool_choice` -- passthrough via `onPayload`
- [ ] `reasoning_effort` -- map to `SimpleStreamOptions.reasoning` (`ThinkingLevel`)
- [ ] `stop` -- passthrough via `onPayload`
- [ ] `response_format` -- passthrough via `onPayload`
- [ ] `top_p` -- passthrough via `onPayload`
- [ ] `frequency_penalty` -- passthrough via `onPayload`
- [ ] `presence_penalty` -- passthrough via `onPayload`
- [ ] `seed` -- passthrough via `onPayload`
- [ ] `n` -- reject with error (unsupported)
- [ ] `logprobs` -- reject with error (unsupported)

### Chat Completions -- Response (Non-Streaming)

- [ ] `id` -- generate unique request ID
- [ ] `object` -- `"chat.completion"`
- [ ] `created` -- timestamp from `AssistantMessage.timestamp`
- [ ] `model` -- echo back resolved model ID
- [ ] `choices[0].index` -- always `0`
- [ ] `choices[0].message.role` -- `"assistant"`
- [ ] `choices[0].message.content` -- extract `TextContent` from `AssistantMessage.content`
- [ ] `choices[0].message.tool_calls` -- extract `ToolCall` blocks, map to OpenAI format
- [ ] `choices[0].finish_reason` -- map `StopReason`: `stop`->`stop`, `length`->`length`, `toolUse`->`tool_calls`
- [ ] `usage.prompt_tokens` -- `Usage.input`
- [ ] `usage.completion_tokens` -- `Usage.output`
- [ ] `usage.total_tokens` -- `Usage.totalTokens`
- [ ] `usage.prompt_tokens_details.cached_tokens` -- `Usage.cacheRead`

### Chat Completions -- Response (Streaming SSE)

- [ ] SSE format: `data: {json}\n\n` per chunk, `data: [DONE]\n\n` at end
- [ ] `text_delta` -> `choices[0].delta.content`
- [ ] `thinking_delta` -> `choices[0].delta.reasoning_content` (extended field)
- [ ] `toolcall_start` -> `choices[0].delta.tool_calls[].id` + `function.name`
- [ ] `toolcall_delta` -> `choices[0].delta.tool_calls[].function.arguments`
- [ ] `toolcall_end` -> (no explicit chunk, covered by finish_reason)
- [ ] `done` -> `choices[0].finish_reason` + final usage chunk
- [ ] `error` -> SSE error event or close connection
- [ ] Include `usage` in final chunk when `stream_options.include_usage` is true

### Models Endpoint

- [ ] `GET /v1/models` -- list from `ModelRegistry.getAll()`
- [ ] Filter to available models only (have auth configured)
- [ ] Response shape: `{ object: "list", data: [{ id, object, created, owned_by }] }`
- [ ] Extended fields: `context_window`, `max_tokens`, `reasoning`, `cost`
- [ ] `GET /v1/models/:model` -- single model lookup via `ModelRegistry.find()`

### Error Responses

- [ ] Match OpenAI error format: `{ error: { message, type, param, code } }`
- [ ] `400` -- malformed request body
- [ ] `401` -- no API key for target provider
- [ ] `404` -- model not found
- [ ] `422` -- unsupported parameter (e.g., `n > 1`)
- [ ] `429` -- rate limit from upstream provider (forward)
- [ ] `500` -- internal server error
- [ ] `503` -- provider overloaded (forward)

## Design Decisions

- [ ] **JSON Schema -> TypeBox**: evaluate whether to convert at request time or pass raw JSON Schema to providers that support it natively
- [ ] **Model name format**: confirm `provider/model-id` as canonical, decide on shorthand behavior when multiple providers have the same model ID
- [ ] **Per-request auth**: decide how `Authorization: Bearer` header maps to provider-specific API keys (provider must be inferable from the model)
- [ ] **`onPayload` passthrough scope**: decide which unsupported params to silently pass vs reject
- [ ] **Agentic mode activation**: `x-pi-mode: agent` header vs separate endpoint vs query param
- [ ] **CORS**: decide on default CORS policy for browser-based clients (Open WebUI, etc.)

## Not Planned (Out of Scope)

- `POST /v1/completions` -- legacy text completions API (deprecated)
- `POST /v1/embeddings` -- pi has no embedding infrastructure
- `POST /v1/images/generations` -- pi has no image generation
- `POST /v1/audio/*` -- pi has no audio transcription/TTS
- Files, fine-tuning, assistants, threads, runs, batches -- OpenAI-platform-specific
