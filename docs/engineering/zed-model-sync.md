# Zed Model Sync — Design Notes

Research notes for a future extension that syncs pi-openai-proxy's exposed models
into Zed's `settings.json` so users don't manually enumerate them.

## Current state

Zed's `openai_compatible` provider does **not** auto-discover models from the
server. It never calls `GET /v1/models`. Users must manually list every model in
`settings.json` with context window sizes and capability flags.

The proxy already exposes all available models via `GET /v1/models`, but the
response only carries the OpenAI-standard fields (`id`, `object`, `created`,
`owned_by`). Zed needs more metadata per model.

## Zed's model format

```jsonc
// ~/.config/zed/settings.json (macOS with XDG)
// ~/Library/Application Support/Zed/settings.json (macOS default)
// ~/.config/zed/settings.json (Linux)
{
  "language_models": {
    "openai_compatible": {
      "Pi Proxy": {
        "api_url": "http://127.0.0.1:4141/v1",
        "available_models": [
          {
            "name": "anthropic/claude-sonnet-4-20250514",
            "display_name": "Claude Sonnet 4",
            "max_tokens": 200000,
            "max_output_tokens": 64000,
            "capabilities": {
              "tools": true,
              "images": true,
              "parallel_tool_calls": false,
              "prompt_cache_key": false,
              "chat_completions": true
            }
          }
        ]
      }
    }
  }
}
```

### Field mapping: pi Model -> Zed AvailableModel

| Zed field | Source | Notes |
|---|---|---|
| `name` | `ExposedModel.publicId` | The model ID Zed sends in requests |
| `display_name` | `Model.name` | Optional; `name` is used if omitted |
| `max_tokens` | `Model.contextWindow` | Context window size in tokens |
| `max_output_tokens` | `Model.maxTokens` | Max generation tokens |
| `max_completion_tokens` | `Model.maxTokens` | Alternative field; same value |
| `capabilities.tools` | `true` | All proxy-exposed models support tool calling |
| `capabilities.images` | `Model.input.includes("image")` | From pi's input array |
| `capabilities.parallel_tool_calls` | `false` | Not universally supported |
| `capabilities.prompt_cache_key` | `false` | Not applicable |
| `capabilities.chat_completions` | `true` | Always; proxy only speaks chat completions |

## Required proxy changes

### Option A: Extended model endpoint (preferred)

Add an `x_pi` extension to `GET /v1/models` and `GET /v1/models/{model}`:

```json
{
  "id": "anthropic/claude-sonnet-4-20250514",
  "object": "model",
  "created": 1742867000,
  "owned_by": "anthropic",
  "x_pi": {
    "display_name": "Claude Sonnet 4",
    "context_window": 200000,
    "max_output_tokens": 64000,
    "reasoning": true,
    "input_modalities": ["text", "image"]
  }
}
```

Pros: single source of truth, standard endpoint, useful for any integration.
Cons: non-standard extension on a standard endpoint.

### Option B: Dedicated capabilities endpoint

`GET /pi/models` returning an array with full metadata. Keeps the OpenAI
endpoint pure and provides a pi-specific surface for tooling.

### Recommendation

Option A. The `x_pi` namespace is already used in completion responses. Clients
that don't understand it ignore it. The sync tool only needs one HTTP call.

## Sync extension architecture

A separate pi extension (`pi-openai-proxy-zed-sync` or similar) that:

1. Imports the config from `@victor-software-house/pi-openai-proxy/config`
2. Queries `GET /v1/models` (with `x_pi` metadata) from the running proxy
3. Maps each model to Zed's `AvailableModel` format
4. Reads Zed's `settings.json` as JSONC
5. Merges the `language_models.openai_compatible["Pi Proxy"].available_models`
   array — preserving all other settings and comments
6. Writes back atomically

### Command surface

```
/proxy zed-sync     Sync exposed models into Zed settings
/proxy zed-show     Show what would be written without changing anything
```

Or as a separate extension:

```
/zed sync           Sync proxy models to Zed
/zed show           Dry-run preview
```

### JSONC handling

Zed settings is JSONC (comments preserved). Options:

- **jsonc-parser** (npm) — Microsoft's JSONC parser with `modify()` for
  surgical edits that preserve comments and formatting. Used by VS Code
  internals. This is the right tool.
- **json5** — supports comments but reformats on serialize.
- **strip-json-comments** + `JSON.parse` — loses comments on write-back.

Use `jsonc-parser` with `ModificationOptions` to replace only the
`available_models` array at the correct JSON path.

### Settings file discovery

```
macOS:  ~/.config/zed/settings.json
        ~/Library/Application Support/Zed/settings.json
Linux:  $XDG_CONFIG_HOME/zed/settings.json
        ~/.config/zed/settings.json
```

Check both paths, prefer whichever exists. Error if neither found.

### Zed Preview vs Stable

Zed Preview uses a separate config directory (`Zed Preview` on macOS). The sync
should support both or let the user specify.

## Continue.dev / other clients

Continue.dev uses a similar pattern — `config.yaml` with explicit model entries,
`contextLength`, and `capabilities`. The same `x_pi` metadata from the proxy
enables sync for Continue too, via a separate command or extension.

The proxy's extended model metadata is client-agnostic. Each sync target is a
thin adapter that maps `x_pi` fields to the client's format.

## Implementation phases

1. **Add `x_pi` metadata to model endpoints** — in pi-openai-proxy itself
2. **Build Zed sync as `/proxy zed-sync` subcommand** — in the existing extension
3. **Extract to separate extension** — when it grows or gains Continue support
