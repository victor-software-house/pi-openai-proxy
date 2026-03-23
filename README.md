# pi-openai-proxy

A local OpenAI-compatible HTTP proxy built on [pi](https://github.com/badlogic/pi-mono)'s SDK. Routes requests through pi's multi-provider model registry and credential management, exposing a single `http://localhost:<port>/v1/...` endpoint that any OpenAI-compatible client can connect to.

## Project docs

- `README.md` -- project overview and API surface
- `ROADMAP.md` -- short phase summary and delivery order
- `PLAN.md` -- detailed implementation contract (internal)

## Why

- **Single gateway** to 20+ LLM providers (Anthropic, OpenAI, Google, Bedrock, Mistral, xAI, Groq, OpenRouter, Vertex, etc.) via one OpenAI-compatible API
- **No duplicate config** -- reuses pi's `~/.pi/agent/auth.json` and `models.json` for credentials and model definitions
- **Self-hosted** -- runs locally, no third-party proxy services
- **Streaming** -- full SSE streaming with token usage and cost tracking
- **Agentic mode** (planned) -- expose pi's full agent loop (tools, sessions, compaction) behind a separate experimental endpoint

## Supported Endpoints

| Endpoint | Status | Description |
|---|---|---|
| `GET /v1/models` | Implemented | List all available models from pi's ModelRegistry |
| `GET /v1/models/{model}` | Implemented | Model details for a canonical model ID (supports URL-encoded IDs with `/`) |
| `POST /v1/chat/completions` | Implemented | Chat completions (streaming and non-streaming) |

## Supported Chat Completions Features

| Feature | Status | Notes |
|---|---|---|
| `model` | Implemented | Resolved via `ModelRegistry.find()`, canonical or shorthand |
| `messages` (text) | Implemented | System, developer, user, assistant, tool messages |
| `messages` (base64 images) | Implemented | Base64 data URI image content parts |
| `messages` (remote images) | Not yet | Disabled by default; planned with SSRF protections |
| `stream` | Implemented | SSE with `text_delta` / `toolcall_delta` mapping |
| `temperature` | Implemented | Direct passthrough to `StreamOptions` |
| `max_tokens` / `max_completion_tokens` | Implemented | Normalized to `StreamOptions.maxTokens` |
| `stop` sequences | Implemented | Via `onPayload` passthrough |
| `user` | Implemented | Via `onPayload` passthrough |
| `stream_options.include_usage` | Implemented | Final usage chunk in SSE stream |
| `tools` / `tool_choice` | Implemented | JSON Schema -> TypeBox conversion (supported subset) |
| `tool_calls` in messages | Implemented | Assistant tool call + tool result roundtrip |
| `reasoning_effort` | Implemented | Maps to pi's `ThinkingLevel` (`low`, `medium`, `high`) |
| `response_format` | Implemented | `text` and `json_object` via `onPayload` passthrough |
| `top_p` | Implemented | Via `onPayload` passthrough |
| `frequency_penalty` | Implemented | Via `onPayload` passthrough |
| `presence_penalty` | Implemented | Via `onPayload` passthrough |
| `seed` | Implemented | Via `onPayload` passthrough |
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
         |  GET /v1/models    |  +-- Tool converter       |
         +------------------>|  +-- SSE encoder          |
         |                    |                          |
         |                    |  Pi SDK                   |
         |  SSE / JSON        |  +-- ModelRegistry        |
         |<------------------+  +-- AuthStorage          |
                              |  +-- streamSimple()       |
                              |  +-- AgentSession (P4)    |
                              +--------------------------+
```

### Pi SDK Layers Used

- **`@mariozechner/pi-ai`** -- `streamSimple()`, `completeSimple()`, `Model`, `Usage`, `AssistantMessageEvent`
- **`@mariozechner/pi-coding-agent`** -- `ModelRegistry`, `AuthStorage`

## Model Naming

Models are addressed as `provider/model-id`, matching pi's registry:

```
anthropic/claude-sonnet-4-20250514
openai/gpt-4o
google/gemini-2.5-pro
xai/grok-3
openrouter/anthropic/claude-sonnet-4-20250514
```

Shorthand (bare model ID) is resolved by scanning all providers for a unique match. Ambiguous shorthand requests fail with a clear error listing the matching canonical IDs.

## Configuration

Uses pi's existing configuration:

- **API keys**: `~/.pi/agent/auth.json` (managed by `pi /login`)
- **Custom models**: `~/.pi/agent/models.json`
- **Per-request override**: planned via `X-Pi-Upstream-Api-Key` header so `Authorization` remains available for proxy authentication

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PI_PROXY_HOST` | `127.0.0.1` | Bind address |
| `PI_PROXY_PORT` | `4141` | Listen port |
| `PI_PROXY_AUTH_TOKEN` | (disabled) | Bearer token for proxy authentication |
| `PI_PROXY_AGENTIC` | `false` | Enable experimental agentic mode |
| `PI_PROXY_REMOTE_IMAGES` | `false` | Enable remote image URL fetching |

## Dev Workflow

```bash
bun install           # Install dependencies
bun run dev           # Run in development
bun run build         # Build for npm (tsdown)
bun run typecheck     # TypeScript strict check
bun run lint          # Biome + oxlint (strict)
bun test              # Run all tests
```

### Tooling

- **Bun** -- runtime, test runner, package manager
- **tsdown** -- npm build (ESM + .d.ts)
- **Biome** -- format + lint
- **oxlint** -- type-aware lint with strict rules (`.oxlintrc.json`)
- **lefthook** -- pre-commit hooks (format, lint, typecheck), pre-push hooks (test)
- **commitlint** -- conventional commits
- **semantic-release** -- automated versioning and npm publish
- **mise** -- tool version management (node, bun)

## License

MIT
