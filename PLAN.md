# Plan

This document is the implementation source of truth for `pi-openai-proxy`.

Use this file for architecture, API compatibility policy, security boundaries, phase gates, and acceptance criteria. Use `TODO.md` for the actionable checklist. Use `ROADMAP.md` for a short phase summary.

## Goals

Build a local OpenAI-compatible HTTP proxy on top of pi's SDK and model registry.

Primary goals:

- Expose `GET /v1/models`
- Expose `GET /v1/models/{model}`
- Expose `POST /v1/chat/completions`
- Reuse pi's configured auth and model definitions
- Support streaming and non-streaming chat completions
- Support OpenAI function tools where they can be translated safely

Secondary goals:

- Preserve request and usage observability
- Be safe by default for local usage
- Provide a path for optional experimental agentic mode later

## Non-goals

Out of scope for the stable proxy:

- `POST /v1/completions`
- `POST /v1/embeddings`
- `POST /v1/audio/*`
- `POST /v1/images/*`
- assistants, threads, runs, files, batches, fine-tuning
- full OpenAI platform parity
- exposing unrestricted agent tool execution under the standard chat-completions contract

## Production defaults

- Bind to `127.0.0.1` by default
- Do not expose the proxy on `0.0.0.0` unless explicitly configured
- Log a per-request proxy request ID
- Accept an incoming `X-Client-Request-Id` and propagate it through logs
- Abort upstream work when the client disconnects
- Reject unsupported parameters clearly instead of silently ignoring them

## Tooling and type safety

Strict tooling, identical to pi-acp:

- **TypeScript**: ultra-strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`)
- **Biome**: format + lint (recommended rules, `noExplicitAny: error`, `noFloatingPromises: error`, `noUnnecessaryConditions: error`)
- **oxlint**: type-aware with `.oxlintrc.json` (`no-unsafe-*`, `strict-boolean-expressions`, `consistent-type-assertions`, zod plugin, import-alias)
- **Zod v4**: namespace import (`import * as z`), `safeParse()` for all external data, `z.int()` for integer fields
- **Type guards**: `isRecord()` for narrowing `unknown`, never `as` casts
- **Import aliases**: `@proxy/*` -> `src/*`, no `.js` extensions, no relative imports
- **Typed env**: `src/env.d.ts` for `process.env` dot notation
- **lefthook**: pre-commit (oxlint-fix, biome format, lint, typecheck), pre-push (lockfile sync, typecheck, lint, test)
- **commitlint**: conventional commits via `@commitlint/config-conventional`
- **semantic-release**: changelog, npm publish, GitHub release, git commit

## API compatibility policy

### Stable endpoints

- `GET /v1/models`
- `GET /v1/models/{model}`
- `POST /v1/chat/completions`

### Unsupported endpoints

Return OpenAI-style errors for:

- `POST /v1/completions`
- `POST /v1/embeddings`
- `POST /v1/audio/*`
- `POST /v1/images/*`
- assistants, threads, runs, files, batches, fine-tuning

## Public and canonical model IDs

Internal canonical model IDs remain:

- `provider/model-id`

Examples:

- `openai/gpt-4o`
- `anthropic/claude-sonnet-4-20250514`
- `openrouter/anthropic/claude-sonnet-4-20250514`

Canonical IDs are an internal storage and routing primitive.
Use them for:

- internal registry lookup
- persisted custom-model selections
- backward-compatible request resolution for models that are still exposed

The public HTTP API does not always expose canonical IDs.
Public model IDs are configurable and should prefer universal provider-neutral names when possible.

### Public model ID modes

Supported public ID modes:

- `collision-prefixed` — default
- `universal`
- `always-prefixed`

#### `collision-prefixed`

Start from the raw model ID (`model.id`) for every exposed model.
If any two exposed providers share at least one raw model ID, prefix **all** models from providers in that connected conflict group.

This is a provider-group rule, not a per-model rule.
If `openai` and `codex` collide on one exposed model name, prefix all exposed `openai/*` and all exposed `codex/*` public IDs.
Do not prefix unrelated providers that are outside that conflict group.

#### `universal`

Expose raw model IDs only.
If the exposed model set contains duplicates, configuration is invalid and must fail validation explicitly.
Do not silently downgrade to a prefixed mode.

#### `always-prefixed`

Expose `<public-prefix>/<model-id>` for every model.
This is the closest behavior to the current implementation.

### Public prefix labels

Prefixed public IDs use:

- `<public-prefix>/<model-id>`

Default `public-prefix` is the provider key.
The prefix label must be configurable per provider via settings.

Validation rules:

- prefix labels must be unique among exposed providers in prefixed modes
- invalid prefix collisions must surface as explicit configuration errors

### Exposure modes

Supported exposure modes:

- `all` — expose all available models
- `scoped` — expose all available models from selected providers only
- `custom` — expose only an allowlist of canonical model IDs

Persist custom-model selections as canonical IDs, not public IDs.
That keeps configuration stable when public ID mode or prefix labels change.

### Resolution policy

For incoming model references on the HTTP API, resolve in this order:

1. exact public ID match
2. exact canonical ID match for backward compatibility

Canonical fallback is only allowed for models inside the current exposed set.
Hidden models must not become reachable through canonical fallback.

Do not rely on the old registry-wide shorthand ambiguity rules on the public HTTP surface.
The public model list itself defines the valid request IDs.

### Route handling

`GET /v1/models/{model}` must support URL-encoded full model IDs because both canonical IDs and prefixed public IDs can contain `/`.

Examples:

- `/v1/models/gpt-5.4-mini`
- `/v1/models/openai%2Fgpt-5.4-mini`
- `/v1/models/codex%2Fgpt-5.4-mini`
- `/v1/models/openrouter%2Fanthropic%2Fclaude-sonnet-4-20250514`

Do not rely on a single path-segment router parameter without decoding support.

## Model exposure configuration

Shared proxy configuration must grow to include model-exposure controls.
The JSON config file, CLI overrides, env handling, and settings panel must all agree on the same schema.

Required settings:

- `publicModelIdMode`: `collision-prefixed` | `universal` | `always-prefixed`
- `modelExposureMode`: `all` | `scoped` | `custom`
- `customModels`: string[] — canonical model IDs only
- `providerPrefixes`: record of provider key -> public prefix label

Note: `scoped` mode delegates to pi's global `enabledModels` setting (from `/scoped-models` Ctrl+S).
No proxy-side config is needed — the proxy reads `SettingsManager.getEnabledModels()` at request time.

Settings-panel requirements:

- the main `/proxy` panel remains the default no-arg entry point
- enum settings for public ID mode and exposure mode must persist immediately
- `scoped` mode is managed via pi's `/scoped-models` command, not a proxy-specific UI
- model selection for `custom` mode should use a searchable selector UI
- prefix overrides should be editable without requiring manual JSON editing
- `/proxy verify` should validate collisions, invalid universal mode, unknown providers, and missing custom models
- `/proxy show` should summarize the effective exposure policy and preview representative public IDs

## Authentication model

### Upstream credentials

Primary source:

- pi `AuthStorage`
- `ModelRegistry.getApiKey(model)`

### Per-request override

Do not use the standard `Authorization: Bearer ...` header for upstream provider overrides.

Use a proxy-specific header instead, for example:

- `X-Pi-Upstream-Api-Key`

Reason:

- OpenAI-compatible clients already use `Authorization` for proxy authentication
- reserving `Authorization` keeps future proxy auth compatible with ecosystem expectations

### Optional proxy auth

Future-compatible design:

- incoming `Authorization: Bearer <proxy-key>` may be used to protect the proxy itself
- disabled by default for local use

## Request contract for `POST /v1/chat/completions`

### Supported fields

- `model`
- `messages`
- `stream`
- `temperature`
- `max_tokens`
- `max_completion_tokens`
- `stop`
- `user`
- `stream_options.include_usage`
- `tools`
- `tool_choice`
- assistant `tool_calls`
- `tool` role messages
- `reasoning_effort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`)
- `response_format` (`text`, `json_object`, `json_schema`)
- `top_p`
- `frequency_penalty`
- `presence_penalty`
- `seed`
- `parallel_tool_calls`
- `metadata`
- `prediction`
- image content parts (base64 data URIs only)

Compatibility preference:

- prefer `max_completion_tokens` over deprecated `max_tokens`
- support `json_schema` in `response_format` on the stable chat-completions path
- broaden `reasoning_effort` to match the current OpenAI enum surface

### Rejected

- `n > 1`
- `logprobs`
- `top_logprobs`
- `logit_bias`
- `functions` (deprecated)
- `function_call` (deprecated)
- audio output/modality
- input audio content parts
- file content parts
- unsupported multimodal content parts
- unsupported tool schema shapes
- any parameter not explicitly supported or allowlisted for passthrough

### Unknown field policy

Default behavior:

- reject with `422`
- return an OpenAI-style error body naming the offending field where possible

## Message mapping policy

### Roles

- `system` -> system prompt accumulator
- `developer` -> merged into the effective system prompt in message order
- `user` -> pi user message
- `assistant` -> pi assistant message history
- `tool` -> pi tool result message

### Content parts

Supported:

- text
- image content parts using base64 data URIs

Rejected:

- remote image URLs (disabled by default, requires SSRF protections)
- input audio
- file parts
- unsupported structured content variants

### Assistant tool calls

Support OpenAI `function` tool calls first.

Do not claim support for custom tool shapes until a compatible mapping is defined and tested.

## Tool schema policy

OpenAI tool parameter schemas are JSON Schema. pi tools expect TypeBox schemas.

Stable policy:

- support a documented subset of JSON Schema only
- reject unsupported schema constructs with `422`
- do not silently downgrade complex schemas

Supported subset:

- `type: object` with `properties` and `required`
- `type: string`, `number`, `integer`, `boolean`, `null`
- `type: array` with `items` schema
- `enum` (string values only, mapped to TypeBox Union of literals)
- nullable types via `type: [T, "null"]`
- `description` on any schema node
- `additionalProperties` as boolean (not as schema)
- `anyOf` for nullable types and simple unions (max 10 branches)

Rejected:

- `$ref`
- `oneOf` / `allOf`
- `if` / `then` / `else`
- `patternProperties`
- `not`
- `additionalProperties` as a schema object
- recursive schemas
- non-string enum values

## Known gaps and silent drops

The following issues violate the project's own policy of rejecting unsupported parameters
clearly instead of silently ignoring them. These should be addressed before the proxy is
considered production-complete.

### `tool_choice` — resolved

`tool_choice` is forwarded to upstream providers via `onPayload` passthrough, the same
mechanism used for `top_p`, `seed`, `response_format`, and other provider-specific fields.
All OpenAI `tool_choice` values are supported: `"none"`, `"auto"`, `"required"`, and
named function choice `{ type: "function", function: { name: "..." } }`.

Passthrough fields (including `tool_choice`) are only injected via `onPayload` for
OpenAI-compatible APIs (`openai-completions`, `openai-responses`, `azure-openai-responses`,
`mistral-conversations`). Non-compatible APIs (Anthropic, Google, Bedrock, Codex) reject
unknown payload fields, so the proxy skips injection entirely for those APIs. The fields
are still accepted by the proxy schema — they just have no effect on non-compatible
providers.

### `strict` on function tools — resolved

The `strict` flag on function tool definitions is forwarded to upstream providers via
`onPayload`. The pi SDK's `Tool` interface has no `strict` field and the SDK always sets
`strict: false` when building the upstream payload. The proxy extracts per-tool strict
flags from the original request and patches them into the payload after the SDK builds it.

This means `strict: true` reaches OpenAI and compatible providers correctly. Like all
passthrough fields, `strict` is only injected for OpenAI-compatible APIs. Non-compatible
providers are unaffected.

### `parallel_tool_calls` — resolved

`parallel_tool_calls` is forwarded to upstream providers via `onPayload` passthrough.
The field was previously rejected (422) because the pi SDK does not expose parallel tool
call control. Analysis showed this rejection broke real clients:

- **Continue** sends `parallel_tool_calls: false` for most models
- **Open WebUI** and **Aider** do not send the field

The proxy's SSE streaming code already handles multiple tool calls per response via
`contentIndex` tracking, so the response side was always capable. Like all passthrough
fields, `parallel_tool_calls` is only injected for OpenAI-compatible APIs. Non-compatible
providers are unaffected — their default parallel behavior applies.

### `metadata` and `prediction` — resolved

`metadata` is accepted as an arbitrary key-value record and forwarded via `onPayload`.
Open WebUI sends it with task info on every request.

`prediction` is accepted with OpenAI's `{ type: "content", content: string | TextPart[] }`
shape and forwarded via `onPayload`. Continue sends it for models that support predicted
output (speculative decoding).

Both fields are only injected for OpenAI-compatible APIs. Non-compatible providers
are unaffected.

### Resilience architecture — intentional design

The proxy is a stateless translation layer, not a load balancer or API gateway. The
following are intentionally omitted:

- **No concurrency limiter**: The primary deployment model is a local proxy serving one
  client (Zed, Continue, etc.). The client controls its own concurrency. A server-side
  limiter would duplicate client logic and cause confusing double-throttling.
- **No circuit breaker**: For a single-client local proxy, a circuit breaker would
  prevent requests after upstream failures even when the upstream has recovered. The
  client already handles retries.
- **No rate limiting**: Same argument — the client controls its own request rate.
- **No retry logic**: Retries are the client's responsibility. The proxy never resends
  a failed upstream request.

Upstream overload is handled reactively:
- `mapUpstreamError()` detects rate limit (429) and overload (503/529) patterns
- A structured `upstream_overload` warn-level log is emitted for these events
- The mapped error propagates to the client as an OpenAI-style error response

If the proxy is deployed in a multi-client scenario (e.g., shared team proxy), resilience
features should be provided by an external reverse proxy (nginx, Caddy, etc.) rather
than built into this translation layer.

### Stateless architecture — no session continuity

The proxy is fully stateless. Each `POST /v1/chat/completions` request builds a fresh
`Context` from the `messages` array and discards it after the response. There is no
session persistence, no conversation memory, and no model-change detection across requests.

This is by design (matches the standard OpenAI chat completions contract), but means:
- The client is solely responsible for maintaining conversation history
- Switching models between requests is invisible to the proxy
- There is no server-side context caching or optimization

The pi SDK's stateful `AgentSession` is not used. Phase 4 (experimental agentic mode)
is intended to address this but is not started.

### API-aware payload translation

The proxy translates OpenAI request fields into the correct format for each provider API.
Fields that have no equivalent in a target API are silently skipped — the request succeeds
and the provider's default behavior applies.

#### OpenAI-compatible APIs

`openai-completions`, `openai-responses`, `azure-openai-responses`, `mistral-conversations`

All passthrough fields injected directly as flat top-level properties (same names):
`stop`, `user`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`,
`response_format`, `tool_choice`, `parallel_tool_calls`, `metadata`, `prediction`.

#### Anthropic (`anthropic-messages`)

Fields translated to Anthropic's wire format:

| OpenAI field | Anthropic translation |
|---|---|
| `top_p` | `top_p` (same name, natively supported) |
| `stop` | `stop_sequences` (string or array → always array) |
| `user` | `metadata: { user_id }` |
| `tool_choice: "auto"` | `tool_choice: { type: "auto" }` |
| `tool_choice: "none"` | `tool_choice: { type: "none" }` |
| `tool_choice: "required"` | `tool_choice: { type: "any" }` |
| `tool_choice: { function: { name } }` | `tool_choice: { type: "tool", name }` |
| `parallel_tool_calls: false` | `disable_parallel_tool_use: true` on `tool_choice` |
| `seed` | Skipped (not supported) |
| `frequency_penalty` | Skipped (not supported) |
| `presence_penalty` | Skipped (not supported) |
| `response_format` | Skipped (not directly supported) |
| `metadata` (arbitrary) | Skipped (Anthropic only accepts `user_id`) |
| `prediction` | Skipped (not supported) |

#### Google (`google-generative-ai`, `google-gemini-cli`, `google-vertex`)

Fields translated into Google's nested `config.generationConfig` structure (camelCase):

| OpenAI field | Google translation |
|---|---|
| `top_p` | `config.generationConfig.topP` |
| `stop` | `config.generationConfig.stopSequences` (always array) |
| `seed` | `config.generationConfig.seed` |
| `frequency_penalty` | `config.generationConfig.frequencyPenalty` |
| `presence_penalty` | `config.generationConfig.presencePenalty` |
| `tool_choice: "auto"` | `config.toolConfig.functionCallingConfig.mode: "AUTO"` |
| `tool_choice: "none"` | `config.toolConfig.functionCallingConfig.mode: "NONE"` |
| `tool_choice: "required"` | `config.toolConfig.functionCallingConfig.mode: "ANY"` |
| `user` | Skipped (not supported) |
| `parallel_tool_calls` | Skipped (not supported) |
| `response_format` | Skipped (Google uses `responseMimeType` / `responseSchema`) |
| `metadata` | Skipped (not supported) |
| `prediction` | Skipped (not supported) |

#### Other APIs (`bedrock-converse-stream`, `openai-codex-responses`)

No passthrough. These APIs use completely different payload schemas. Fields are accepted
by the proxy schema but have no effect.

## Response contract

### Non-streaming

Return an OpenAI-compatible object with:

- `id`
- `object: "chat.completion"`
- `created`
- `model`
- `choices`
- `usage`

Choice policy:

- always `choices[0].index = 0`
- emit assistant text in `choices[0].message.content`
- emit tool calls in `choices[0].message.tool_calls`
- map finish reasons conservatively

Finish reason mapping:

- pi `stop` -> `stop`
- pi `length` -> `length`
- pi `toolUse` -> `tool_calls`

Do not synthesize OpenAI finish reasons that pi cannot actually distinguish, such as `content_filter`.

### Streaming

Emit standard server-sent events:

- `data: {json}\n\n`
- terminal `data: [DONE]\n\n`

Each chunk should include:

- `id`
- `object: "chat.completion.chunk"`
- `created`
- `model`
- `choices`

Chunk policy:

- emit a first delta with `role: "assistant"`
- map text deltas to `choices[0].delta.content`
- map tool call deltas to `choices[0].delta.tool_calls`
- keep a stable chunk `id` for the full streamed response

Usage policy:

- if `stream_options.include_usage` is true, emit a final chunk with empty `choices` and populated `usage`
- if the stream is interrupted, do not guarantee a final usage chunk

Reasoning policy:

- do not emit non-standard reasoning fields on the stable OpenAI-compatible path
- if reasoning streaming is exposed later, use an explicit experimental flag or namespaced extension field

## Models endpoints

### `GET /v1/models`

Return the OpenAI-compatible list shape:

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-5.4-mini",
      "object": "model",
      "created": 0,
      "owned_by": "openai"
    }
  ]
}
```

Compatibility rule:

- keep the stable response strictly to the standard OpenAI model object fields
- do not attach capability metadata such as context window, max tokens, reasoning support, or modality support to the standard `/v1/models` path
- if richer metadata is exposed later, use a separate non-standard endpoint rather than `x_pi` on the standard model object

Availability rule:

- distinguish between `configured` and `healthy`
- do not claim a model is healthy just because credentials are configured
- apply exposure filtering before public ID generation

### `GET /v1/models/{model}`

Return the standard OpenAI-compatible model object:

- `id`
- `object: "model"`
- `created`
- `owned_by`

Resolution rule:

- resolve within the currently exposed model set only
- accept exact public IDs first
- accept canonical IDs only as backward-compatible aliases for models that remain exposed

## Error contract

Use an OpenAI-style shape:

```json
{
  "error": {
    "message": "...",
    "type": "...",
    "param": "...",
    "code": "..."
  }
}
```

### Error mapping

- `400` invalid request shape, ambiguous shorthand model, invalid headers
- `401` proxy auth failure or no upstream credential for target provider
- `404` model not found
- `422` unsupported parameter, unsupported content part, unsupported tool schema
- `429` upstream rate limit
- `500` internal proxy failure
- `502` malformed upstream/provider response
- `503` provider unavailable or overloaded
- `504` upstream timeout

Error rules:

- never leak secrets in errors
- preserve useful parameter names in `param` where possible
- log upstream request IDs when available

## Security boundaries

### Image URL fetching

If remote image URLs are supported:

- allow only `http` and `https`
- block localhost and private IP ranges
- set strict timeout and size limits
- validate content type
- limit redirects
- disable by default unless explicitly enabled

### Agentic mode

Agentic mode is experimental.

Security defaults for any future agentic mode:

- disabled by default
- explicit opt-in
- tools on an allowlist
- `cwd` controlled by server policy or strict allowlist
- extension loading disabled by default

## Internal architecture

Module layout:

```text
src/
├── index.ts            -- entry point, CLI bootstrap (citty)
├── env.d.ts            -- typed process.env
├── config/
│   ├── schema.ts         -- ProxyConfig type, defaults, JSON I/O (exported via ./config)
│   └── env.ts            -- ServerConfig from file + env + CLI overrides
├── server/
│   ├── app.ts            -- Hono app assembly (middleware + routes)
│   ├── routes.ts         -- GET /v1/models, GET /v1/models/:model, POST /v1/chat/completions
│   ├── middleware.ts     -- request-id, proxy-auth, body size limit, disconnect detection
│   ├── errors.ts         -- OpenAI-style error helpers
│   ├── logging.ts        -- structured JSON logging
│   ├── request-id.ts     -- piproxy-{random} generation
│   └── types.ts          -- Hono ProxyEnv type
├── openai/
│   ├── schemas.ts              -- Zod v4 request schemas
│   ├── validate.ts             -- request validation with rejected-field checks
│   ├── messages.ts             -- OpenAI messages -> pi Context
│   ├── model-exposure.ts       -- exposure engine: filtering, public IDs, resolution (exported via ./exposure)
│   ├── models.ts               -- ExposedModel -> OpenAI model object
│   ├── responses.ts            -- pi AssistantMessage -> OpenAI ChatCompletion
│   ├── sse.ts                  -- pi events -> SSE ChatCompletionChunk frames
│   ├── tools.ts                -- OpenAI function tools -> pi Tool[]
│   └── json-schema-to-typebox.ts -- JSON Schema -> TypeBox conversion
└── pi/
    ├── registry.ts       -- AuthStorage + ModelRegistry init
    └── complete.ts       -- completeSimple/streamSimple bridge
```

### Dead code

`src/pi/resolve-model.ts` was superseded by `src/openai/model-exposure.ts` in Phase 3A.
No production code imports it. Remove it along with its test file.

### Scaling notes

`routes.ts` is the sole composition root (267 lines, 15 imports). The chat completions handler is ~170 lines covering body parse, validate, resolve model, convert messages, convert tools, check API key, and stream/non-stream branching. This is manageable for the current three-endpoint surface but should be decomposed if new endpoints or complex middleware (agentic mode) are added.

`extensions/proxy.ts` (896 lines) mixes process management, config UI, model queries, verification logic, and TUI rendering. It is isolated from the core proxy. If it grows further (agentic mode controls), extract helpers into separate extension modules.

The proxy has no concurrency controls. Bun's runtime handles request parallelism, but
there are no semaphores, connection pools, or circuit breakers protecting upstream
providers. This is acceptable for local single-user use but would need addressing for
any multi-user or high-concurrency deployment.

## Delivery phases

### Phase 0 — Contract lock [DONE]

Before runtime work:

- freeze model ID strategy
- freeze auth override strategy
- freeze streaming chunk contract
- freeze error contract
- freeze initial parameter support matrix
- freeze image-fetch security policy
- mark agentic mode experimental

Deliverable:

- this plan file
- aligned `ROADMAP.md`
- aligned `TODO.md`

### Phase 1 — Stable core proxy [DONE]

Build:

- project scaffolding (Bun, Hono, Zod v4, tsdown, Biome, oxlint, lefthook, commitlint)
- `AuthStorage` and `ModelRegistry` integration
- model resolution (canonical + shorthand with ambiguity detection)
- `GET /v1/models`
- `GET /v1/models/{model}` with encoded slash support
- non-streaming chat completions via `completeSimple()`
- streaming chat completions via `streamSimple()`
- request IDs and structured logging
- disconnect cancellation via AbortController
- OpenAI-style errors

Release gate:

- unit tests for mapping logic
- integration tests for models and validation
- no unsupported parameters silently accepted
- zero oxlint errors, zero biome errors
- typecheck passes with ultra-strict tsconfig

### Phase 2 — Tools and richer compatibility [DONE]

Build:

- OpenAI function tools subset (JSON Schema -> TypeBox for supported subset)
- tool-call message roundtrip (assistant tool_calls + tool role results)
- `stream_options.include_usage` (final usage chunk in SSE)
- base64 image inputs (remote URLs rejected by default)
- `reasoning_effort` (mapped to pi ThinkingLevel)
- passthrough parameters: `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `response_format`

Deliverable:

- `src/openai/json-schema-to-typebox.ts` — JSON Schema -> TypeBox conversion
- `src/openai/tools.ts` — OpenAI function tools -> pi Tool definitions
- updated `src/openai/schemas.ts` — Phase 2 fields added to request schema
- updated `src/pi/complete.ts` — reasoning_effort + passthrough parameters
- unit tests for JSON Schema conversion and tool acceptance/rejection
- integration tests for tool validation

Release gate:

- tool schema tests pass
- tool streaming already wired in Phase 1 SSE module
- remote image security deferred (disabled by default)

### Phase 3 — Hardening and packaging [DONE]

Build:

- request body limits
- timeout defaults
- graceful shutdown
- compatibility smoke tests with real clients
- CI gates for typecheck, lint, test
- npm packaging

Release gate:

- compatibility smoke tests pass for target clients
- logs and trace IDs are stable
- no known security policy gaps remain for stable features

### Phase 3A — Model exposure and identifier controls [DONE]

Build:

- standardize `/v1/models` and `/v1/models/{model}` to the minimal OpenAI model object
- remove `x_pi` from the standard models path
- add shared model-exposure computation with public-ID generation and reverse lookup
- add configurable public ID modes: `collision-prefixed`, `universal`, `always-prefixed`
- add configurable exposure modes: `all`, `scoped`, `custom`
- add provider prefix overrides with explicit uniqueness validation
- restrict model resolution to the exposed set for models listing, detail lookup, and chat requests
- preserve canonical-ID backward compatibility only for models that remain exposed
- refactor the Pi extension toward a controller-backed config flow
- add `/proxy verify` and model-exposure preview to the command family
- add focused selector UIs for scoped providers and custom model selection

Deliverable:

- shared model-exposure module used by models endpoints and chat resolution
- shared config schema extended with exposure controls
- updated settings panel and `/proxy` command family
- route and integration tests covering exposure modes and ID modes
- documentation aligned to the new public ID policy

Release gate:

- public model IDs are unique under every valid configuration
- invalid `universal` mode and invalid prefix collisions fail validation explicitly
- hidden models are not reachable by canonical fallback
- `/v1/models` stays standard OpenAI shape with no capability extensions
- typecheck, lint, and tests pass

### Phase 3B — SDK conformance and robustness testing

Validate that the proxy produces responses the official OpenAI SDK can parse without errors. This is the single highest-value test investment because it catches the exact field-level bugs that break real clients (Open WebUI, Continue, Aider).

There is no standard conformance test suite for OpenAI-compatible APIs. Every project (LiteLLM, vLLM, Ollama) rolls its own. The approach here uses the official `openai` Node SDK (v6+) as a client with strict response validation enabled.

Pre-work:

- remove dead `src/pi/resolve-model.ts` and its test
- add `openai` as an explicit devDependency (currently transitive via pi-ai)

Build:

**Wire-level SSE conformance (no credentials needed)**

Validate the exact SSE frame format against the `ChatCompletionChunk` contract using mock `AssistantMessage` / `AssistantMessageEvent` objects:

- each chunk has `id`, `object: "chat.completion.chunk"`, `created` (number), `model`
- `delta.role` is `"assistant"` on first chunk only
- `delta.content` is a string (never `undefined` when text is present)
- `finish_reason` is `null` on intermediate chunks, then `"stop"` / `"length"` / `"tool_calls"` on the final content chunk
- tool call delta chunks: `delta.tool_calls[n].index`, `.id`, `.type`, `.function.name`, `.function.arguments` are present and well-typed
- usage chunk: `choices` is an empty array, `usage` has `prompt_tokens`, `completion_tokens`, `total_tokens` as numbers
- final line is `data: [DONE]\n\n`

**Non-streaming response conformance (no credentials needed)**

Validate the exact `ChatCompletion` shape from `buildChatCompletion` output:

- required fields: `id`, `object: "chat.completion"`, `created`, `model`, `choices`, `usage`
- `choices[0].finish_reason` is never `null` (unlike streaming)
- `choices[0].message.role` is `"assistant"`
- `choices[0].message.content` is `string | null` (explicitly `null` when tool_calls present, not `undefined`)
- `choices[0].message.tool_calls` shape includes `id`, `type: "function"`, `function.name`, `function.arguments`
- `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens` are all numbers

**SDK round-trip conformance (requires one API credential)**

Use `new OpenAI({ baseURL, apiKey: "dummy" })` with `_strict_response_validation: true` against the running proxy:

- `client.models.list()` succeeds and returns iterable model objects
- `client.models.retrieve(id)` succeeds for an exposed model
- `client.chat.completions.create({ stream: false })` -- simple text completion
- `client.chat.completions.create({ stream: true })` -- streaming text, collect all chunks
- `client.chat.completions.create({ tools })` -- non-streaming tool call
- `client.chat.completions.create({ stream: true, tools })` -- streaming tool call
- `client.chat.completions.create({ stream: true, stream_options: { include_usage: true } })` -- usage chunk

These tests skip gracefully when no credentials are available.

**Security tests (no credentials needed)**

- blocked localhost image URL returns error
- blocked private-range image URL returns error
- oversized image payload rejected

Deliverable:

- `test/unit/sse-conformance.test.ts` — wire-level SSE validation
- `test/unit/response-conformance.test.ts` — non-streaming shape validation
- `test/unit/security.test.ts` — image URL blocking
- `test/conformance/helpers.ts` — SDK client factory, skip-if-no-auth
- `test/conformance/sdk-models.test.ts` — SDK models endpoint tests
- `test/conformance/sdk-chat.test.ts` — SDK non-streaming chat
- `test/conformance/sdk-streaming.test.ts` — SDK streaming chat
- `test/conformance/sdk-tools.test.ts` — SDK tool call tests

Release gate:

- all SSE conformance tests pass without credentials
- all response conformance tests pass without credentials
- all security tests pass without credentials
- SDK conformance tests pass when credentials are available, skip cleanly otherwise
- the `openai` Node SDK with `_strict_response_validation: true` parses every response without errors
- typecheck, lint, and tests pass

### Phase 4 — Experimental agentic mode

Only after stable proxy behavior is complete:

- explicit agentic endpoint or explicit opt-in header
- `AgentSession` event bridge
- session persistence and resume
- strict cwd policy
- extension allowlist

Recommendation:

- prefer a separate endpoint such as `/v1/pi/agent/completions` instead of overloading the stable OpenAI-compatible route

## Observability

Minimum production observability:

- generated proxy request ID
- accepted `X-Client-Request-Id`
- upstream request ID capture where available
- structured request logs
- latency logging
- disconnect and abort logging
- usage logging when available

## Test strategy

### Unit tests

- role and content mapping
- finish reason mapping
- usage mapping
- error mapping
- JSON Schema -> TypeBox conversion (supported subset and rejected keywords)
- OpenAI function tool -> pi Tool conversion
- model-exposure filtering, public ID generation, conflict groups

### Conformance tests — wire-level (no credentials)

Validate the exact response shapes that the OpenAI SDK expects. These are the highest-value offline tests because field-level mistakes (wrong type, missing field, `undefined` vs `null`) silently break real clients.

- SSE chunk conformance: required/optional fields, `delta` shape, `finish_reason` lifecycle, tool call deltas, usage chunk, `[DONE]` termination
- non-streaming response conformance: `ChatCompletion` required fields, `message.content` nullability, `tool_calls` shape, `usage` fields

### Conformance tests — SDK round-trip (require credentials)

Use the official `openai` Node SDK as client with `_strict_response_validation: true`. This is the same approach vLLM uses (Python SDK against their server).

- `client.models.list()` and `client.models.retrieve()`
- non-streaming text completion
- streaming text completion
- non-streaming and streaming tool calls
- `stream_options.include_usage` usage chunk

Skip gracefully when no credentials are available (CI without auth).

### Security tests (no credentials)

- blocked localhost image URL
- blocked private-range image URL
- oversized image response

### Integration tests

- `GET /v1/models` shape
- `GET /v1/models/{model}` with encoded IDs
- chat completions validation and rejection
- tool acceptance and unsupported schema rejection
- model-not-found flow
- proxy auth enforcement
- unsupported endpoint rejection

### Compatibility smoke tests

Target at least:

- `curl`
- Open WebUI
- Continue
- Aider

## Acceptance criteria

The implementation is production-ready for the stable proxy only if all of the following are true:

- `GET /v1/models` returns an OpenAI-compatible list shape using only standard model object fields
- `GET /v1/models/{model}` supports encoded slash-containing IDs
- public model IDs are unique under the active exposure configuration
- canonical fallback does not bypass exposure filtering
- non-streaming chat completions return OpenAI-compatible payloads
- streaming returns valid SSE chunks followed by `[DONE]`
- final usage chunk behavior matches the documented `stream_options.include_usage` contract
- the official `openai` Node SDK with `_strict_response_validation: true` parses every response without errors
- SSE conformance tests validate chunk shapes, `finish_reason` lifecycle, and tool call deltas
- response conformance tests validate `content` nullability and `tool_calls` shape
- unsupported fields are rejected clearly
- secrets are never logged
- client disconnects abort upstream work
- request IDs are logged consistently
- supported tool schemas roundtrip correctly
- no dead code in production `src/` tree
- stable features pass unit, conformance, integration, and security tests
- zero oxlint errors, zero biome errors, typecheck clean
