# Phase 3D: Compatibility Analysis and Resilience

Analysis document for deferred Phase 3C items. Each section states findings,
decision, and implementation plan.

## 1. `parallel_tool_calls` analysis

### Client survey

| Client | Sends `parallel_tool_calls`? | Value | Notes |
|---|---|---|---|
| Open WebUI | No | — | Handles parallel tool calls in responses but never sends the field |
| Continue | Yes | `false` (most models), `true` (Fireworks) | Explicitly sets it in `modifyChatBody` |
| Aider | No | — | Uses litellm; does not set the field |
| Zed | N/A (capabilities only) | `false` in model sync | Declares capability; actual request depends on Zed internals |

### Pi SDK behavior

- The `openai-completions` provider does NOT set `parallel_tool_calls` in `buildParams()`.
- When absent, OpenAI's default is `true` (parallel tool calls enabled).
- The `openai-codex-responses` provider hardcodes `parallel_tool_calls: true` (irrelevant to chat completions).
- No other provider references the field.
- The field does not exist in `StreamOptions` or `SimpleStreamOptions`.

### Provider passthrough test (verified with real providers)

Real-provider testing revealed a critical issue: non-OpenAI providers **reject** unknown
payload fields, not ignore them:
- **Anthropic**: Returns 400 `"parallel_tool_calls: Extra inputs are not permitted"`
- **Google**: Returns 400 `"Unknown name "parallel_tool_calls": Cannot find field."`

This affected ALL passthrough fields (seed, frequency_penalty, etc.), not just Phase 3D
additions. The fix: switch from a blocklist to an allowlist. Only inject passthrough fields
for APIs that use the OpenAI chat completions wire format:
- `openai-completions`, `openai-responses`, `azure-openai-responses`, `mistral-conversations`

All other APIs skip passthrough entirely. Fields are still accepted by the proxy schema
but have no effect on non-compatible providers.

### Decision

**Accept and forward via `onPayload` passthrough.**

Rationale:
1. Continue (a primary target client) sends `parallel_tool_calls: false` and currently
   gets a 422 rejection — a real compatibility issue.
2. The proxy's SSE streaming code already handles multiple tool calls per response.
3. The `onPayload` passthrough pattern is established and well-tested.
4. Provider-specific format differences are an accepted limitation for all passthrough fields.
5. When absent, the provider default applies (same as today after removing the rejection).

### Implementation

- Remove `"parallel_tool_calls"` from `rejectedFields` in `src/openai/schemas.ts`.
- Add `parallel_tool_calls: z.boolean().optional()` to `chatCompletionRequestSchema`.
- Add `parallel_tool_calls` forwarding in `collectPayloadFields()` in `src/pi/complete.ts`.
- Update the Zed sync to stop hardcoding `parallel_tool_calls: false` in capabilities
  (the proxy now supports it).
- Update tests: remove the rejection test case, add acceptance + passthrough tests.
- Update PLAN.md known gaps section.

## 2. Rejected fields audit

### Current rejected fields

| Field | OpenAI status | Client usage | Pi SDK support | Decision |
|---|---|---|---|---|
| `n` | Active | Not sent by surveyed clients | Not supported | **Keep rejected** — proxy returns single choice only |
| `logprobs` | Active | Not sent by surveyed clients | Not supported | **Keep rejected** — no response-side support |
| `top_logprobs` | Active (requires logprobs) | Not sent | Not supported | **Keep rejected** — same as logprobs |
| `logit_bias` | Active | Not sent by surveyed clients | Not supported | **Keep rejected** — no SDK support, niche use |
| `functions` | Deprecated | Aider translates to tools | Not applicable | **Keep rejected** — deprecated, replaced by `tools` |
| `function_call` | Deprecated | Not sent directly | Not applicable | **Keep rejected** — deprecated, replaced by `tool_choice` |
| `parallel_tool_calls` | Active | Continue sends `false` | Not in SDK, passthrough works | **Promote** — see section 1 |

### New OpenAI fields not in schema or rejected list

These fields hit the Zod `.strict()` validation and are rejected as "Unknown parameter(s)"
with a 422. This is functionally equivalent to explicit rejection but with a less helpful
error message.

| Field | Risk of client sending it | Passthrough viable? | Decision |
|---|---|---|---|
| `store` | Low (no surveyed client sends it) | Yes, but SDK already sets `store: false` | **Defer** — add to rejected list if a client reports issues |
| `metadata` | Medium (Open WebUI sends it) | Yes via onPayload | **Accept and forward** — Open WebUI sends it; harmless passthrough |
| `prediction` | Low (Continue supports it for specific models) | Yes via onPayload | **Accept and forward** — Continue sends it; harmless passthrough |
| `service_tier` | Low | Yes via onPayload | **Defer** — no surveyed client sends it |
| `modalities` | Low | Partially (audio not supported) | **Defer** — specialized |
| `audio` | Low | No (not supported) | **Defer** — specialized |
| `web_search_options` | Low | No (not supported) | **Defer** — specialized |
| `reasoning` | Low (separate from `reasoning_effort`) | Complex (object vs string) | **Defer** — we already handle `reasoning_effort` |
| `prompt_cache_key` | Low | Pi SDK has `sessionId` | **Defer** |
| `prompt_cache_retention` | Low | Pi SDK has `cacheRetention` | **Defer** |
| `safety_identifier` | Low | No | **Defer** |
| `verbosity` | Low | No | **Defer** |

### Promotion decisions

Two fields are worth promoting now because real clients send them:

1. **`metadata`**: Accept as `z.record(z.string(), z.unknown()).optional()`, forward via
   `onPayload`. Open WebUI sends it with task info. Harmless to upstream providers.

2. **`prediction`**: Accept as a passthrough object, forward via `onPayload`. Continue
   sends it for models that support predicted output. The schema matches OpenAI's
   `{ type: "content", content: string | Array<{ type: "text", text: string }> }`.

### Fields to add to explicit `rejectedFields`

None. The current `.strict()` rejection with "Unknown parameter(s)" is adequate for
fields no surveyed client sends. Adding them to `rejectedFields` would just add
maintenance burden without improving the user experience.

If a future client reports a 422 for a specific field, we can decide per-field whether
to accept+forward or add an explicit rejection with a better error message.

## 3. Proxy-side resilience

### Current architecture

The proxy is stateless and passthrough-oriented:
- No connection pooling (each request creates a fresh upstream connection via pi SDK)
- No request queuing or concurrency limits
- No circuit breaker
- No retry logic (intentional — retries are client responsibility)
- Reactive overload detection via `mapUpstreamError()` (529/overloaded → 503)

### Analysis

For a local proxy (the primary deployment model), resilience features have limited value:

1. **Concurrency limiter**: A local proxy typically serves one client (Zed, Continue, etc.).
   The client already has its own concurrency management. Adding a server-side limiter
   would duplicate client logic and could cause confusing failures.

2. **Circuit breaker**: Useful in multi-tenant services. For a local proxy with one client,
   a circuit breaker would prevent the client from making requests after upstream failures,
   even when the upstream has recovered. The client already handles retries.

3. **Rate limiting**: Same argument — the client controls its own rate.

4. **Structured logging for 429/503**: This has value regardless of deployment model.
   The proxy should log upstream rate limits and overload responses distinctly so users
   can diagnose provider issues.

### Decision

1. **No concurrency limiter, circuit breaker, or rate limiting** — document this as an
   intentional architectural choice. The proxy is a translation layer, not a load balancer.
2. **Add structured logging for upstream 429 and 503 responses** — improve observability.
3. **Document the architecture** in PLAN.md with rationale.

### Implementation

- Add distinct log messages when `mapUpstreamError()` detects rate limit (429) or
  overload (503/529) patterns.
- Add an "Architecture: resilience" section to PLAN.md explaining the stateless passthrough
  design and why proxy-side resilience features are intentionally omitted.

## 4. Implementation plan

### Phase 3D-1: `parallel_tool_calls` promotion (code change)
- Schema: accept the field
- Passthrough: forward via `collectPayloadFields()`
- Zed sync: update capabilities
- Tests: remove rejection test, add acceptance + passthrough tests
- Docs: update PLAN.md known gaps

### Phase 3D-2: `metadata` and `prediction` promotion (code change)
- Schema: accept both fields
- Passthrough: forward via `collectPayloadFields()`
- Tests: add acceptance + passthrough tests

### Phase 3D-3: Upstream overload logging (code change)
- Detect 429/503 patterns in `mapUpstreamError()` and log distinctly
- May already partially exist — audit before adding

### Phase 3D-4: Documentation (docs only)
- PLAN.md: resolve `parallel_tool_calls` known gap
- PLAN.md: add resilience architecture section
- PLAN.md: update supported fields matrix
- TODO.md: mark Phase 3D items complete
- ROADMAP.md: mark Phase 3D complete
