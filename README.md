# pi-openai-proxy

A local OpenAI-compatible HTTP proxy built on [pi](https://github.com/badlogic/pi-mono)'s SDK. Routes requests through pi's multi-provider model registry and credential management, exposing a single `http://localhost:<port>/v1/...` endpoint that any OpenAI-compatible client can connect to.

## Why

- **Single gateway** to 20+ LLM providers (Anthropic, OpenAI, Google, Bedrock, Mistral, xAI, Groq, OpenRouter, Vertex, etc.) via one OpenAI-compatible API
- **No duplicate config** -- reuses pi's `~/.pi/agent/auth.json` and `models.json` for credentials and model definitions
- **Self-hosted** -- runs locally, no third-party proxy services
- **Streaming** -- full SSE streaming with token usage and cost tracking
- **Agentic mode** (planned) -- expose pi's full agent loop (tools, sessions, compaction) behind the completions endpoint

## Supported Endpoints

| Endpoint | Status | Description |
|---|---|---|
| `GET /v1/models` | Planned | List all available models from pi's ModelRegistry |
| `GET /v1/models/:model` | Planned | Model details (context window, costs, capabilities) |
| `POST /v1/chat/completions` | Planned | Chat completions (streaming and non-streaming) |

## Supported Chat Completions Features

| Feature | Status | Notes |
|---|---|---|
| `model` | Planned | Resolved via `ModelRegistry.find()` |
| `messages` (text) | Planned | System, user, assistant, tool messages |
| `messages` (images) | Planned | Base64 and URL image content |
| `stream` | Planned | SSE with `text_delta` / `toolcall_delta` mapping |
| `temperature` | Planned | Direct passthrough to `StreamOptions` |
| `max_tokens` / `max_completion_tokens` | Planned | Direct passthrough |
| `tools` / `tool_choice` | Planned | JSON Schema tool definitions |
| `tool_calls` in messages | Planned | Assistant tool call + tool result messages |
| `reasoning_effort` | Planned | Maps to pi's `ThinkingLevel` |
| `usage` in response | Planned | Input, output, cache read/write tokens + cost |
| `stop` sequences | Planned | Via `onPayload` passthrough |
| `response_format` | Planned | Via `onPayload` passthrough |
| `top_p`, penalties | Planned | Via `onPayload` passthrough |
| `n > 1` | Not planned | Pi streams one completion at a time |
| `logprobs` | Not planned | Not in pi-ai's abstraction layer |

## Architecture

```
HTTP Client                       pi-openai-proxy
(curl, Aider, Continue,      +--------------------------+
 LiteLLM, Open WebUI, etc.)  |                          |
         |                    |  Hono HTTP Server         |
         |  POST /v1/chat/   |  +-- Request parser       |
         +--completions------>|  +-- Message converter    |
         |                    |  +-- Model resolver       |
         |  GET /v1/models    |  +-- SSE encoder          |
         +------------------>|                          |
         |                    |  Pi SDK                   |
         |  SSE / JSON        |  +-- ModelRegistry        |
         |<------------------+  +-- AuthStorage          |
                              |  +-- streamSimple()       |
                              |  +-- AgentSession (P3)    |
                              +--------------------------+
```

### Pi SDK Layers Used

- **`@mariozechner/pi-ai`** -- `streamSimple()`, `completeSimple()`, `Model`, `Usage`, `AssistantMessageEvent`
- **`@mariozechner/pi-coding-agent`** -- `ModelRegistry`, `AuthStorage`, `createAgentSession()`, `SessionManager`

## Model Naming

Models are addressed as `provider/model-id`, matching pi's registry:

```
anthropic/claude-sonnet-4-20250514
openai/gpt-4o
google/gemini-2.5-pro
xai/grok-3
openrouter/anthropic/claude-sonnet-4-20250514
```

Shorthand (bare model ID) is resolved by scanning all providers for a unique match.

## Configuration

Uses pi's existing configuration:

- **API keys**: `~/.pi/agent/auth.json` (managed by `pi /login`)
- **Custom models**: `~/.pi/agent/models.json`
- **Per-request override**: `Authorization: Bearer <key>` header (optional, overrides stored credentials for the target provider)

## Dev Workflow

- Install deps: `bun install`
- Run in dev: `bun run dev`
- Build: `bun run build`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Test: `bun test`

## License

MIT
