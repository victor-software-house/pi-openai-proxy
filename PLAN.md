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

## Canonical model IDs

The external model ID format is:

- `provider/model-id`

Examples:

- `openai/gpt-4o`
- `anthropic/claude-sonnet-4-20250514`
- `openrouter/anthropic/claude-sonnet-4-20250514`

### Shorthand resolution

Accept bare model IDs only when the match is unique across providers.

If multiple providers expose the same model ID:

- return `400`
- use an OpenAI-style error body
- include the matching canonical IDs in error metadata or message text

### Route handling

`GET /v1/models/{model}` must support URL-encoded full model IDs because canonical IDs can contain `/`.

Examples:

- `/v1/models/openai%2Fgpt-4o`
- `/v1/models/openrouter%2Fanthropic%2Fclaude-sonnet-4-20250514`

Do not rely on a single path-segment router parameter without decoding support.

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

### Supported in the stable proxy (Phase 1)

- `model`
- `messages`
- `stream`
- `temperature`
- `max_tokens`
- `max_completion_tokens`
- `stop`
- `user`
- `stream_options.include_usage`

### Supported in the richer compatibility phase (Phase 2)

- `tools`
- `tool_choice`
- assistant `tool_calls`
- `tool` role messages
- `reasoning_effort`
- `response_format` on an allowlist basis
- `top_p`
- `frequency_penalty`
- `presence_penalty`
- `seed`
- image content parts

### Rejected

- `n > 1`
- `logprobs`
- `top_logprobs`
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

Supported initially:

- text
- image content parts using base64 data URIs

Rejected initially:

- remote image URLs (disabled by default, future Phase 2)
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

Initial supported subset should include:

- `type: object`
- `properties`
- `required`
- primitive property types
- arrays with a supported item schema
- enums where representable cleanly

Deferred until explicitly designed:

- `$ref`
- complex `oneOf` / `allOf` / `anyOf`
- recursive schemas
- unsupported nullable combinations
- schema features that cannot be translated without changing semantics

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
      "id": "openai/gpt-4o",
      "object": "model",
      "created": 0,
      "owned_by": "openai"
    }
  ]
}
```

Compatibility rule:

- keep the stable response close to OpenAI's schema
- if extended pi-specific metadata is exposed, place it under a namespaced field such as `x_pi`

Availability rule:

- distinguish between `configured` and `healthy`
- do not claim a model is healthy just because credentials are configured

### `GET /v1/models/{model}`

Return the standard OpenAI-compatible model object:

- `id`
- `object: "model"`
- `created`
- `owned_by`

Extended metadata, if included, should be namespaced.

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
  index.ts            -- entry point, bootstrap
  env.d.ts            -- typed process.env
  config/
    env.ts            -- ProxyConfig from environment
  server/
    app.ts            -- Hono app assembly
    routes.ts         -- GET /v1/models, POST /v1/chat/completions
    middleware.ts      -- request-id, proxy-auth, disconnect detection
    errors.ts         -- OpenAI-style error helpers
    logging.ts        -- structured JSON logging
    request-id.ts     -- piproxy-{random} generation
    types.ts          -- Hono ProxyEnv type
  openai/
    schemas.ts        -- Zod v4 request schemas
    validate.ts       -- request validation with rejected-field checks
    messages.ts       -- OpenAI messages -> pi Context
    models.ts         -- pi Model -> OpenAI model object
    responses.ts      -- pi AssistantMessage -> OpenAI response
    sse.ts            -- pi events -> SSE chunks
  pi/
    registry.ts       -- AuthStorage + ModelRegistry init
    resolve-model.ts  -- canonical/shorthand model resolution
    complete.ts       -- completeSimple/streamSimple bridge
  security/           -- (Phase 2+)
    image-fetch.ts
    proxy-auth.ts
    path-policy.ts
  agentic/            -- (Phase 4)
    bridge.ts
    session-store.ts
```

## Delivery phases

### Phase 0 -- Contract lock [DONE]

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

### Phase 1 -- Stable core proxy [DONE]

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

### Phase 2 -- Tools and richer compatibility [DONE]

Build:

- OpenAI function tools subset (JSON Schema -> TypeBox for supported subset)
- tool-call message roundtrip (assistant tool_calls + tool role results)
- `stream_options.include_usage` (final usage chunk in SSE)
- base64 image inputs (remote URLs rejected by default)
- `reasoning_effort` (mapped to pi ThinkingLevel)
- passthrough parameters: `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `response_format`

Deliverable:

- `src/openai/json-schema-to-typebox.ts` -- JSON Schema -> TypeBox conversion
- `src/openai/tools.ts` -- OpenAI function tools -> pi Tool definitions
- updated `src/openai/schemas.ts` -- Phase 2 fields added to request schema
- updated `src/pi/complete.ts` -- reasoning_effort + passthrough parameters
- unit tests for JSON Schema conversion and tool acceptance/rejection
- integration tests for tool validation

Release gate:

- tool schema tests pass
- tool streaming already wired in Phase 1 SSE module
- remote image security deferred (disabled by default)

### Phase 3 -- Hardening and packaging

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

### Phase 4 -- Experimental agentic mode

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

- model ID parsing and ambiguity
- role and content mapping
- finish reason mapping
- usage mapping
- error mapping
- tool schema conversion

### Integration tests

- `GET /v1/models` shape
- `GET /v1/models/{model}` with encoded IDs
- chat completions validation and rejection
- model-not-found flow
- proxy auth enforcement
- unsupported endpoint rejection

### Golden tests (require API credentials)

- non-streaming text completion
- non-streaming tool-call completion
- streaming text completion
- streaming tool-call completion
- final usage chunk behavior

### Security tests

- blocked localhost image URL
- blocked private-range image URL
- oversized image response
- invalid override headers
- rejected cwd outside policy

### Compatibility smoke tests

Target at least:

- `curl`
- Open WebUI
- Continue
- Aider

## Acceptance criteria

The implementation is production-ready for the stable proxy only if all of the following are true:

- `GET /v1/models` returns an OpenAI-compatible list shape
- `GET /v1/models/{model}` supports encoded slash-containing IDs
- non-streaming chat completions return OpenAI-compatible payloads
- streaming returns valid SSE chunks followed by `[DONE]`
- final usage chunk behavior matches the documented `stream_options.include_usage` contract
- unsupported fields are rejected clearly
- secrets are never logged
- client disconnects abort upstream work
- request IDs are logged consistently
- supported tool schemas roundtrip correctly
- stable features pass unit, integration, and compatibility smoke tests
- zero oxlint errors, zero biome errors, typecheck clean
