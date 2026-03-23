# pi-openai-proxy

A local OpenAI-compatible HTTP proxy built on [pi](https://github.com/badlogic/pi-mono)'s SDK. Routes requests through pi's multi-provider model registry and credential management, exposing a single `http://localhost:4141/v1/...` endpoint that any OpenAI-compatible client can connect to.

## Why

- **Single gateway** to 20+ LLM providers (Anthropic, OpenAI, Google, Bedrock, Mistral, xAI, Groq, OpenRouter, Vertex, etc.) via one OpenAI-compatible API
- **No duplicate config** -- reuses pi's `~/.pi/agent/auth.json` and `models.json` for credentials and model definitions
- **Self-hosted** -- runs locally, no third-party proxy services
- **Streaming** -- full SSE streaming with token usage and cost tracking
- **Strict validation** -- unsupported parameters are rejected clearly, not silently ignored

## Prerequisites

1. [pi](https://github.com/badlogic/pi-mono) must be installed
2. At least one provider must be configured via `pi /login`
3. [Bun](https://bun.sh) (for development) or [Node.js](https://nodejs.org) >= 20 (for production)

## Installation

```bash
# Install globally
npm install -g @victor-software-house/pi-openai-proxy

# Or run directly with npx
npx @victor-software-house/pi-openai-proxy
```

## Quickstart

```bash
# Start the proxy (defaults to http://127.0.0.1:4141)
pi-openai-proxy
```

### List available models

```bash
curl http://localhost:4141/v1/models | jq '.data[].id'
```

### Chat completion (non-streaming)

```bash
curl http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Chat completion (streaming)

```bash
curl http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Tell me a joke"}],
    "stream": true
  }'
```

### Use with any OpenAI-compatible client

Point any client that supports `OPENAI_API_BASE` (or equivalent) at `http://localhost:4141/v1`:

```bash
# Example: Aider
OPENAI_API_BASE=http://localhost:4141/v1 aider --model anthropic/claude-sonnet-4-20250514

# Example: Continue (in settings.json)
# "apiBase": "http://localhost:4141/v1"

# Example: Open WebUI
# Set "OpenAI API Base URL" to http://localhost:4141/v1
```

### Shorthand model names

If a model ID is unique across providers, you can omit the provider prefix:

```bash
curl http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hi"}]}'
```

Ambiguous shorthand requests fail with a clear error listing the matching canonical IDs.

## Supported Endpoints

| Endpoint | Description |
|---|---|
| `GET /v1/models` | List all available models (only those with configured credentials) |
| `GET /v1/models/{model}` | Model details by canonical ID (supports URL-encoded IDs with `/`) |
| `POST /v1/chat/completions` | Chat completions (streaming and non-streaming) |

## Supported Chat Completions Features

| Feature | Notes |
|---|---|
| `model` | Canonical (`provider/model-id`) or unique shorthand |
| `messages` (text) | `system`, `developer`, `user`, `assistant`, `tool` roles |
| `messages` (base64 images) | Base64 data URI image content parts (`image/png`, `image/jpeg`, `image/gif`, `image/webp`) |
| `stream` | SSE with `text_delta` and `toolcall_delta` mapping |
| `temperature` | Direct passthrough |
| `max_tokens` / `max_completion_tokens` | Normalized to `maxTokens` |
| `stop` | Via passthrough |
| `user` | Via passthrough |
| `stream_options.include_usage` | Final usage chunk in SSE stream |
| `tools` / `tool_choice` | JSON Schema -> TypeBox conversion (supported subset) |
| `tool_calls` in messages | Assistant tool call + tool result roundtrip |
| `reasoning_effort` | Maps to pi's `ThinkingLevel` (`low`, `medium`, `high`) |
| `response_format` | `text` and `json_object` via passthrough |
| `top_p` | Via passthrough |
| `frequency_penalty` | Via passthrough |
| `presence_penalty` | Via passthrough |
| `seed` | Via passthrough |

**Not supported:** `n > 1`, `logprobs`, `logit_bias`, remote image URLs (disabled by default).

## Model Naming

Models use the `provider/model-id` canonical format, matching pi's registry:

```
anthropic/claude-sonnet-4-20250514
openai/gpt-4o
google/gemini-2.5-pro
xai/grok-3
openrouter/anthropic/claude-sonnet-4-20250514
```

## Configuration

The proxy reuses pi's existing configuration:

- **API keys**: `~/.pi/agent/auth.json` (managed by `pi /login`)
- **Custom models**: `~/.pi/agent/models.json`

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PI_PROXY_HOST` | `127.0.0.1` | Bind address |
| `PI_PROXY_PORT` | `4141` | Listen port |
| `PI_PROXY_AUTH_TOKEN` | (disabled) | Bearer token for proxy authentication |
| `PI_PROXY_REMOTE_IMAGES` | `false` | Enable remote image URL fetching |
| `PI_PROXY_MAX_BODY_SIZE` | `52428800` (50 MB) | Maximum request body size in bytes |
| `PI_PROXY_UPSTREAM_TIMEOUT_MS` | `120000` (120s) | Upstream request timeout in milliseconds |

### Per-request API key override

The `X-Pi-Upstream-Api-Key` header overrides the registry-resolved API key for a single request. This keeps `Authorization` available for proxy authentication:

```bash
curl http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Pi-Upstream-Api-Key: sk-your-key-here" \
  -d '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Hi"}]}'
```

### Proxy authentication

Set `PI_PROXY_AUTH_TOKEN` to require a bearer token for all requests:

```bash
PI_PROXY_AUTH_TOKEN=my-secret-token pi-openai-proxy

# Clients must include the token
curl http://localhost:4141/v1/models \
  -H "Authorization: Bearer my-secret-token"
```

## Pi Integration

Install as a pi package to get the `/proxy` command and `--proxy` flag inside pi sessions:

```bash
pi install npm:@victor-software-house/pi-openai-proxy
```

### Start the proxy from inside pi

```
/proxy start     Start the proxy server
/proxy stop      Stop the proxy server
/proxy status    Show proxy status (default)
/proxy           Show proxy status
```

### Auto-start with pi

```bash
pi --proxy
```

The proxy starts automatically on session start and stops when the session ends. A status indicator in the footer shows the proxy URL and model count.

The proxy can also run standalone (see [Installation](#installation) above). The extension detects externally running instances and shows their status without trying to manage them.

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
                              |  +-- completeSimple()     |
                              +--------------------------+
```

### Pi SDK layers used

- **`@mariozechner/pi-ai`** -- `streamSimple()`, `completeSimple()`, `Model`, `Usage`, `AssistantMessageEvent`
- **`@mariozechner/pi-coding-agent`** -- `ModelRegistry`, `AuthStorage`

## Security defaults

- Binds to `127.0.0.1` (localhost only) by default
- Remote image URLs disabled by default
- Request body size limited to 50 MB
- Upstream timeout of 120 seconds
- Secrets are never included in error responses
- Client disconnects abort upstream work immediately

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
