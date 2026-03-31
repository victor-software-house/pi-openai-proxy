# Next: Phase 3E — SDK Feature Adoption

Adopt pi-ai SDK capabilities added since v0.61.0 that improve UX, correctness, or functionality for proxy clients.

**Baseline**: pi-openai-proxy v0.63.1, pi-mono HEAD at v0.62.0 (unreleased changes above that). All 315 tests pass, typecheck clean.

**Source commits**: analysis of pi-mono changes since v0.61.0 affecting `packages/ai/src/`.

---

## P1: Use upstream `responseId`

**Pi-mono commit**: `dd53eb56` — expose provider response IDs on assistant messages

**What changed**: `AssistantMessage.responseId` is now populated by all providers (Anthropic, Google, OpenAI, Mistral, Bedrock). Available on both `completeSimple()` results and streaming `partial` messages.

**Current behavior**: The proxy fabricates `piproxy-*` request IDs and uses them as the OpenAI `id` field in responses and SSE chunks. These have no relation to the upstream provider's response identifier.

**Target behavior**:
- Non-streaming: use `message.responseId` as the response `id` when available; fall back to `requestId`
- Streaming: capture `responseId` from the first `partial` in the event stream; use as the chunk `id` for all SSE frames; fall back to `requestId`
- Keep `requestId` in logs and `X-Request-Id` response header (unchanged)

**Why it matters**: Real OpenAI clients expect stable `chatcmpl-*` style IDs. Upstream IDs let clients correlate proxy responses with provider dashboards and logs.

**Files to change**:
- `src/openai/responses.ts` — `buildChatCompletion()`: prefer `message.responseId`
- `src/openai/sse.ts` — `streamToSSE()`: extract `responseId` from first `partial`, use for chunk IDs
- Tests: update SSE conformance and non-streaming conformance expectations

**Effort**: Low

---

## P2: Use native `metadata` path for `user`

**Pi-mono commit**: `1e88c5e4` — add generic `metadata` field to `StreamOptions`

**What changed**: `StreamOptions.metadata` accepts `Record<string, unknown>`. Anthropic's provider extracts `user_id` from it for abuse tracking and rate limiting. Other providers ignore unrecognized keys.

**Current behavior**: The proxy manually maps `request.user` to Anthropic's `metadata.user_id` inside `collectAnthropicPayloadFields()` via `onPayload` passthrough. For OpenAI-compatible APIs, `user` is injected as a flat payload field.

**Target behavior**:
- Set `opts.metadata = { user_id: request.user }` in `buildStreamOptions()` when `request.user` is defined
- Remove the manual `user` -> `metadata.user_id` translation from `collectAnthropicPayloadFields()`
- Keep the flat `user` field injection for OpenAI-compatible APIs (those expect it as a top-level field)

**Why it matters**: Reduces manual provider-specific patching. Future providers that support `metadata` will get `user_id` forwarding automatically.

**Files to change**:
- `src/pi/complete.ts` — `buildStreamOptions()`: set `opts.metadata`
- `src/pi/complete.ts` — `collectAnthropicPayloadFields()`: remove `user` -> `metadata.user_id` mapping
- Tests: verify Anthropic payload no longer carries manual `metadata` injection

**Effort**: Low

---

## P3: Expose `cacheRetention`

**Pi-mono commit**: `abfd04b5` — add `cacheRetention` stream option

**What changed**: `StreamOptions.cacheRetention` accepts `"short" | "long"` (type: `CacheRetention`). Providers map this to their supported prompt-caching behavior. Relevant for Anthropic (prompt caching can significantly reduce costs) and Bedrock.

**Current behavior**: Not exposed. All requests use the pi-ai default (`"short"`).

**Target behavior**:
- Accept `X-Pi-Cache-Retention` request header with values `short` or `long`
- Set `opts.cacheRetention` in `buildStreamOptions()` when the header is present
- Reject invalid values with 422

**Why it matters**: Gives clients control over prompt caching behavior. Long retention is useful for multi-turn conversations where the same context is sent repeatedly.

**Files to change**:
- `src/server/routes.ts` — extract header, pass to completion options
- `src/pi/complete.ts` — `CompletionOptions` and `buildStreamOptions()`: accept and forward `cacheRetention`
- `src/openai/validate.ts` or middleware — validate header value
- PLAN.md — document the new header

**Effort**: Low

---

## P4: Expose `sessionId`

**Pi-mono feature**: `StreamOptions.sessionId` — session identifier for providers with session-based caching or routing

**Current behavior**: Not exposed.

**Target behavior**:
- Accept `X-Pi-Session-Id` request header
- Set `opts.sessionId` in `buildStreamOptions()` when the header is present
- No validation beyond non-empty string

**Why it matters**: Enables better prompt cache hit rates for multi-turn conversations. Providers that support session-aware routing (Codex, potentially others) can optimize when they know requests belong to the same session.

**Files to change**:
- `src/server/routes.ts` — extract header, pass to completion options
- `src/pi/complete.ts` — `CompletionOptions` and `buildStreamOptions()`: accept and forward `sessionId`
- PLAN.md — document the new header

**Effort**: Low

---

## P5: Configure `maxRetryDelayMs`

**Pi-mono commit**: `030a61d8` — add `maxDelayMs` setting to cap server-requested retry delays

**What changed**: `StreamOptions.maxRetryDelayMs` caps how long pi-ai waits for server-requested `Retry-After` delays. Default is 60s. If exceeded, the request fails immediately with an error containing the requested delay.

**Current behavior**: The proxy has its own upstream timeout (`UPSTREAM_TIMEOUT_MS`, default 120s) but does not configure the retry delay cap. A provider sending `Retry-After: 300` would cause pi-ai to wait 60s (its default cap) before failing.

**Target behavior**:
- Add `UPSTREAM_MAX_RETRY_DELAY_MS` env var (default: 30000)
- Set `opts.maxRetryDelayMs` in `buildStreamOptions()`
- Tighter default than pi-ai's 60s because proxy clients typically manage their own retry logic

**Files to change**:
- `src/config/schema.ts` — add config field
- `src/env.d.ts` — add env var type
- `src/pi/complete.ts` — `CompletionOptions` and `buildStreamOptions()`: accept and forward
- `src/server/routes.ts` — pass config value to completion options

**Effort**: Low

---

## P6: Clean up `onPayload` to use `model` parameter

**Pi-mono commit**: `a3f05423` — `onPayload` signature changed to `(payload, model) => unknown | Promise<unknown>`

**What changed**: The `onPayload` callback now receives the resolved `Model<Api>` as a second parameter and can be async.

**Current behavior**: The proxy pre-computes API-type sets (`OPENAI_FULL_PASSTHROUGH_APIS`, `ANTHROPIC_APIS`, `GOOGLE_APIS`, `CODEX_APIS`) and selects the payload strategy before building the `onPayload` closure. The closure ignores the `model` parameter.

**Target behavior**:
- Use `model.api` inside the `onPayload` callback instead of pre-computing which API set applies
- Remove the external `isGoogleApi()` / API-set checks where the callback can determine this itself
- Keep the current return-value pattern (already correct)

**Why it matters**: Minor code simplification. Reduces the distance between "which API is this?" and "what do we patch?".

**Files to change**:
- `src/pi/complete.ts` — refactor `buildStreamOptions()` onPayload closure

**Effort**: Low

---

## Deferred

### `supportsXhigh` validation for `reasoning_effort`

**Pi-mono commit**: `62064b2b` — `supportsXhigh()` now checks by model ID, not API type

The proxy could validate `reasoning_effort: "xhigh"` against `supportsXhigh()` and return a clear 422 instead of silently downgrading. **Deferred** because most clients send `reasoning_effort` broadly and expect the provider to handle unsupported levels gracefully.

### `BedrockOptions.requestMetadata` for cost allocation

**Pi-mono commit**: `3bcbae49` — Bedrock cost allocation tagging

Niche enterprise feature. No client would send this through a standard OpenAI-compatible interface. **Deferred** until a user requests it.

### Thinking-off improvements

**Pi-mono commits**: `d1613e3f`, `6129971c`, `bab58f82` — explicit thinking-off for Anthropic, Google, Copilot

These are internal to pi-ai provider implementations. The proxy already maps `reasoning_effort: "none"` to `ThinkingLevel.minimal`, and pi-ai now handles the provider-specific disabling correctly. **No proxy change needed** — the proxy benefits automatically.

---

## Execution order

Recommended order based on impact and dependency:

1. **P1** (responseId) — highest UX impact, no dependencies
2. **P2** (metadata) — simplifies existing code, no dependencies
3. **P3** (cacheRetention) — new feature, independent
4. **P4** (sessionId) — new feature, independent
5. **P5** (maxRetryDelayMs) — resilience, independent
6. **P6** (onPayload cleanup) — pure refactor, do last

P3 and P4 share the same pattern (header -> option forwarding) and can be implemented together.
