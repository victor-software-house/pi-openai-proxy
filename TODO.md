# TODO

Actionable implementation checklist for `pi-openai-proxy`.

Read `PLAN.md` first. This file should track concrete work items and decisions needed to implement that plan.

## Phase 0 -- Contract lock

### API and routing

- [x] Document the canonical external model ID format: `provider/model-id`
- [x] Document shorthand model resolution rules
- [x] Document the ambiguous shorthand error shape
- [x] Confirm how Hono route matching will support encoded slash-containing model IDs
- [x] Decide whether to expose any non-standard metadata under `x_pi`

### Authentication and headers

- [x] Reserve `Authorization` for proxy authentication compatibility
- [x] Choose the upstream override header name: `X-Pi-Upstream-Api-Key` (reserved, not yet implemented)
- [x] Decide whether proxy auth exists in v1 or stays disabled by default
- [x] Decide whether to accept and return `X-Client-Request-Id` / `X-Request-Id`

### Request compatibility policy

- [x] Freeze the Phase 1 supported request fields
- [x] Freeze the Phase 2 supported request fields (documented in PLAN.md)
- [x] Freeze the explicit rejection list
- [x] Decide whether unknown top-level fields are always rejected with `422`
- [x] Decide how `developer` role content is merged into the effective system prompt

### Streaming contract

- [x] Define the initial chunk shape for streamed responses
- [x] Define tool-call delta chunk sequencing rules
- [x] Define final usage chunk behavior for `stream_options.include_usage`
- [x] Define behavior when the stream aborts before final usage is available
- [x] Decide whether any non-standard reasoning deltas are exposed at all

### Security policy

- [x] Decide whether remote image URLs are enabled in the stable proxy
- [x] If enabled, document SSRF protections and size limits
- [x] Document bind-host defaults
- [x] Document any future remote exposure guidance
- [x] Mark agentic mode experimental and disabled by default

## Phase 1 -- Stable core proxy

### Project setup

- [x] Initialize `package.json`
- [x] Configure `tsconfig.json` for strict TypeScript
- [x] Configure Biome
- [x] Configure oxlint
- [x] Choose the npm build tool and align docs and config
- [x] Add Hono
- [x] Add `@mariozechner/pi-coding-agent`
- [x] Add `@mariozechner/pi-ai`
- [x] Add Zod
- [x] Add test tooling
- [x] Add `src/index.ts`

### Config and bootstrap

- [x] Create env/config loading module
- [x] Add host and port configuration
- [x] Add proxy auth config placeholders if supported
- [x] Add feature flags for experimental capabilities

### Core pi integration

- [x] Create `AuthStorage` integration
- [x] Create `ModelRegistry` integration
- [x] Surface model-registry load errors clearly at startup and in logs
- [x] Implement model lookup by canonical ID
- [x] Implement shorthand lookup with ambiguity detection
- [x] Implement per-request upstream key override without using `Authorization`

### Models endpoints

- [x] Implement `GET /v1/models`
- [x] Return `{ object: "list", data: [...] }`
- [x] Return items shaped like `{ id, object: "model", created, owned_by }`
- [x] Decide and document what `created` means for pi-backed models
- [x] Implement `GET /v1/models/{model}` with encoded ID support
- [x] Return OpenAI-style `404` when a model is not found

### Request parsing and validation

- [x] Create Zod schemas for the Phase 1 request contract
- [x] Validate request body shape before model resolution
- [x] Reject unsupported fields with clear `422` errors
- [x] Normalize `max_tokens` and `max_completion_tokens`
- [x] Validate `X-Client-Request-Id` if present

### Message conversion

- [x] Convert `system` messages into the effective system prompt
- [x] Convert `developer` messages into the effective system prompt
- [x] Convert `user` text messages into pi user messages
- [x] Convert `assistant` text history into pi assistant messages
- [x] Convert `tool` messages into pi tool result messages
- [x] Reject unsupported content parts clearly

### Non-streaming completions

- [x] Route non-streaming requests to `completeSimple()`
- [x] Build OpenAI-style non-streaming response objects
- [x] Map finish reasons conservatively
- [x] Map usage fields from pi `Usage`
- [x] Handle upstream failures through normalized error responses

### Streaming completions

- [x] Route streaming requests to `streamSimple()`
- [x] Build SSE encoder for OpenAI chat-completions chunks
- [x] Emit first chunk with assistant role
- [x] Emit text deltas as `choices[0].delta.content`
- [x] Emit `[DONE]` at stream end
- [x] Cancel upstream work on client disconnect
- [x] Ensure listener and abort-controller cleanup on all paths

### Errors and observability

- [x] Implement normalized OpenAI-style error response helper
- [x] Generate per-request proxy request IDs
- [x] Accept and log `X-Client-Request-Id` if present
- [x] Capture upstream request IDs where available
- [x] Add structured request logging
- [x] Log aborts, disconnects, and upstream timeouts distinctly

### Stable-phase tests

- [x] Unit test model ID parsing
- [x] Unit test shorthand ambiguity handling (via integration test)
- [x] Unit test message-role conversion
- [x] Unit test finish reason mapping
- [x] Unit test usage mapping
- [x] Golden test `GET /v1/models`
- [x] Golden test `GET /v1/models/{model}`
- [ ] Golden test non-streaming text completion (requires API credentials)
- [ ] Golden test streaming text completion (requires API credentials)
- [x] Integration test model-not-found flow
- [x] Integration test upstream-auth-missing flow
- [x] Integration test client-disconnect cancellation (abort controller wired)

## Phase 2 -- Tools and richer compatibility

### Tools

- [x] Define the supported JSON Schema subset for function tools
- [x] Implement JSON Schema -> TypeBox conversion for the supported subset
- [x] Reject unsupported schemas with `422`
- [x] Convert OpenAI `tools` into pi tool definitions
- [x] Convert assistant `tool_calls` history into pi tool-call content
- [x] Convert `tool` role results back into pi tool-result messages
- [x] Support `tool_choice` where compatible (passthrough via schema acceptance)

### Streaming tool calls

- [x] Map `toolcall_start` to OpenAI tool-call delta initialization
- [x] Map `toolcall_delta` to argument streaming
- [x] Preserve stable tool-call IDs and indexes across chunks
- [x] Emit final finish reason `tool_calls` when appropriate

### Usage in streaming

- [x] Support `stream_options.include_usage`
- [x] Emit the final empty-choices usage chunk when requested
- [x] Document that interrupted streams may not include usage

### Additional request fields

- [x] Support `reasoning_effort` (mapped to pi ThinkingLevel)
- [x] Decide which fields are direct passthrough vs allowlisted transformation
- [x] Support `response_format` (text, json_object via onPayload passthrough)
- [x] Support `top_p` (via onPayload passthrough)
- [x] Support `frequency_penalty` (via onPayload passthrough)
- [x] Support `presence_penalty` (via onPayload passthrough)
- [x] Support `seed` (via onPayload passthrough)

### Images

- [x] Support base64 image data in user message parts
- [x] Decide whether remote image URL fetching is enabled
- [x] If enabled, implement SSRF protections, timeout, redirect, and size limits
- [x] Validate image MIME types and payload sizes

### Phase 2 tests

- [x] Unit test supported and rejected tool schemas
- [x] Unit test JSON Schema -> TypeBox conversion
- [x] Integration test tool acceptance and rejection
- [ ] Golden test non-streaming tool-call completion (requires API credentials)
- [ ] Golden test streaming tool-call completion (requires API credentials)
- [ ] Golden test final usage chunk behavior (requires API credentials)
- [ ] Security test blocked localhost image URL
- [ ] Security test blocked private-range image URL
- [ ] Security test oversized image response

## Phase 3 -- Hardening and packaging

### Runtime hardening

- [x] Add request body size limits
- [x] Add upstream timeout defaults
- [x] Add graceful shutdown
- [x] Ensure in-flight streams are handled cleanly on shutdown
- [x] Decide whether any retries are appropriate and where they are forbidden

### Release engineering

- [x] Add CI typecheck
- [x] Add CI lint
- [x] Add CI tests
- [x] Add npm packaging validation
- [x] Verify README examples against the implemented API

### Compatibility testing

- [x] Smoke test with `curl`
- [ ] Smoke test with Open WebUI
- [ ] Smoke test with Continue
- [ ] Smoke test with Aider
- [x] Record known compatibility gaps in docs

## Phase 3A -- Model exposure and identifier controls

### Contract and config

- [ ] Replace the public models-path contract with standard OpenAI model objects only
- [ ] Remove `x_pi` from `/v1/models` and `/v1/models/{model}`
- [ ] Add `publicModelIdMode`: `collision-prefixed` | `universal` | `always-prefixed`
- [ ] Add `modelExposureMode`: `all` | `scoped` | `custom`
- [ ] Add `scopedProviders`, `customModels`, and `providerPrefixes` to shared config
- [ ] Normalize and persist custom model selections as canonical IDs only
- [ ] Validate duplicate prefix labels explicitly
- [ ] Validate invalid `universal` mode collisions explicitly

### Shared model-exposure engine

- [ ] Add a shared module that derives the exposed model set from config + available models
- [ ] Compute public IDs from the active ID mode
- [ ] Build provider conflict groups for `collision-prefixed` mode
- [ ] Prefix all providers in a connected conflict group, not only colliding models
- [ ] Build reverse lookup maps for public ID -> canonical model and canonical ID -> exposed model
- [ ] Ensure hidden models cannot resolve through canonical fallback

### Server integration

- [ ] Route `GET /v1/models` through the shared model-exposure engine
- [ ] Route `GET /v1/models/{model}` through the shared model-exposure engine
- [ ] Route chat request model resolution through the shared model-exposure engine
- [ ] Resolve exact public IDs before canonical fallback
- [ ] Keep canonical fallback only for models that remain exposed
- [ ] Return explicit config errors when the exposure policy is invalid

### Compatibility refresh

- [ ] Expand `reasoning_effort` enum to `none`, `minimal`, `low`, `medium`, `high`, `xhigh`
- [ ] Support `response_format: { type: "json_schema" }`
- [ ] Prefer `max_completion_tokens` over deprecated `max_tokens` in docs and validation messaging
- [ ] Re-evaluate which current OpenAI chat fields remain explicitly rejected vs deferred

### Pi extension UX

- [ ] Refactor `/proxy` extension config handling around a controller pattern
- [ ] Add public ID mode and exposure mode to the main settings panel
- [ ] Add `/proxy verify`
- [ ] Add provider selector UI for `scoped` mode
- [ ] Add searchable model selector UI for `custom` mode
- [ ] Add prefix override editing flow
- [ ] Add effective public-ID preview to `/proxy show` and the settings UI

### Tests and docs

- [ ] Add unit tests for exposure filtering and public ID generation
- [ ] Add unit tests for provider conflict-group behavior
- [ ] Add unit tests for invalid universal mode and duplicate prefix labels
- [ ] Add integration tests for all/scoped/custom exposure modes
- [ ] Add integration tests for public ID resolution and canonical fallback restrictions
- [ ] Update `PLAN.md`, `ROADMAP.md`, and `README.md` to match the new model exposure contract

## Phase 4 -- Experimental agentic mode

### Contract

- [ ] Decide whether experimental agentic mode uses a separate endpoint
- [ ] If not, document the opt-in header and the compatibility tradeoff explicitly
- [ ] Define the SSE event contract for agentic mode
- [ ] Define the session identifier contract

### Session integration

- [ ] Build `AgentSession` lifecycle wrapper
- [ ] Bridge `AgentSession` events to SSE
- [ ] Implement session persistence
- [ ] Implement session resume
- [ ] Clean up subscriptions and resources reliably

### Security

- [ ] Define cwd allowlist policy
- [ ] Prevent arbitrary client-controlled cwd escape
- [ ] Disable extension loading by default
- [ ] Add tool allowlist policy for agentic mode

### Experimental tests

- [ ] Test session creation and resume
- [ ] Test streamed tool execution events
- [ ] Test cwd policy enforcement
- [ ] Test extension policy enforcement

## Documentation follow-through

- [x] Keep `README.md` aligned with the supported endpoint and feature set
- [x] Keep `ROADMAP.md` aligned with `PLAN.md`
- [x] Keep this file focused on concrete action items only
