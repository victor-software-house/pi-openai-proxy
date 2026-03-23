# Roadmap

## Phase 1 -- Stateless LLM Proxy (MVP)

Core value: a local OpenAI-compatible gateway to all providers pi supports.

- [ ] Project scaffolding (Bun, tsdown, Biome, oxlint, Hono)
- [ ] Zod request/response schemas for OpenAI Chat Completions
- [ ] `GET /v1/models` -- list models from `ModelRegistry`
- [ ] `GET /v1/models/:model` -- single model details
- [ ] `POST /v1/chat/completions` (non-streaming) -- `completeSimple()`
- [ ] `POST /v1/chat/completions` (streaming) -- `streamSimple()` + SSE encoding
- [ ] Model resolution: `provider/model-id` -> `Model<Api>`, with shorthand fallback
- [ ] Message conversion: OpenAI messages (system/user/assistant) -> pi-ai `Context`
- [ ] `temperature` and `max_tokens` passthrough
- [ ] Usage tracking in responses (input, output, cache tokens)
- [ ] CLI entry point with `--port` flag
- [ ] Publish to npm as `@victor-software-house/pi-openai-proxy`

## Phase 2 -- Rich Features

- [ ] Tool definitions (`tools` field) with JSON Schema -> TypeBox conversion
- [ ] Tool call messages (assistant `tool_calls` + `tool` role results)
- [ ] `tool_choice` passthrough via `onPayload`
- [ ] Image content in user messages (base64 + URL)
- [ ] `reasoning_effort` -> pi `ThinkingLevel` mapping
- [ ] Thinking/reasoning content in streaming responses
- [ ] `stop`, `response_format`, `seed` passthrough via `onPayload`
- [ ] `top_p`, `frequency_penalty`, `presence_penalty` passthrough via `onPayload`
- [ ] Per-request API key override via `Authorization: Bearer` header
- [ ] Cost calculation in extended usage response
- [ ] Error responses matching OpenAI error format

## Phase 3 -- Agentic Mode

Expose pi's full agent loop behind the completions endpoint.

- [ ] `x-pi-mode: agent` header triggers `AgentSession.prompt()` instead of `streamSimple()`
- [ ] Agent tool execution events streamed as content annotations
- [ ] Session persistence via `SessionManager`
- [ ] `x-pi-session-id` header for session continuity
- [ ] Compaction and context management
- [ ] `x-pi-cwd` header for project-scoped sessions
- [ ] Pi extension loading for agentic sessions

## Phase 4 -- Testing and Hardening

- [ ] Unit tests: message conversion, model resolution, SSE encoding
- [ ] Integration tests: full HTTP round-trip with mock pi-ai responses
- [ ] Compatibility tests with common clients (curl, Aider, Continue, Open WebUI)
- [ ] Error handling: provider failures, auth errors, malformed requests
- [ ] Rate limiting and request validation
- [ ] Graceful shutdown and connection cleanup
