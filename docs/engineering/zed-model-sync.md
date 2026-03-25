# Client Model Sync — Design Notes

Design for a modular sync system that pushes pi-openai-proxy's exposed models
into editor/tool configuration files. Follows pi-maestro's monorepo patterns:
contracts for plugin boundaries, per-client adapters, thin extension wiring.

## Problem

Editors like Zed and Continue.dev require manual model enumeration in their
config files. They never call `GET /v1/models`. Users must hand-write every
model with context window sizes and capability flags. When the proxy's model
set changes (new provider authenticated, model exposure config adjusted), the
editor config goes stale.

## Architecture

```text
packages/
├── proxy/                  # Standalone proxy server, CLI, config schema
│   └── (exposes model metadata via x_pi on GET /v1/models)
│
├── sync/
│   ├── contracts/          # SyncTarget interface, ModelInfo, SyncResult
│   ├── engine/             # Fetch models from proxy, diff, orchestrate sync
│   ├── target-zed/         # Zed settings.json adapter
│   └── target-continue/    # Continue config.yaml adapter (future)
│
└── pi-extension/           # Pi extension: /proxy commands + sync wiring
```

### Package responsibilities

| Package | Scope | Depends on |
|---|---|---|
| `@proxy/sync-contracts` | `SyncTarget` interface, `ModelInfo` type, `SyncResult`, `SyncOptions` | nothing (pure types + Zod) |
| `@proxy/sync-engine` | Fetch models from proxy, map to `ModelInfo[]`, diff against current state, call `SyncTarget.apply()` | `sync-contracts` |
| `@proxy/target-zed` | Read/write Zed's JSONC settings, implement `SyncTarget` | `sync-contracts`, `jsonc-parser` |
| `@proxy/target-continue` | Read/write Continue's YAML config, implement `SyncTarget` | `sync-contracts` |
| `pi-extension` | Wire sync targets, register `/proxy zed-sync` etc. | `sync-engine`, all targets, proxy config |

### Comparison with pi-maestro

| pi-maestro | pi-openai-proxy sync |
|---|---|
| `core/contracts` (ProviderAdapter, SecretBackend) | `sync/contracts` (SyncTarget) |
| `core/engine` (AccountManager, selection) | `sync/engine` (fetch, diff, orchestrate) |
| `providers/anthropic`, `providers/gemini` | `sync/target-zed`, `sync/target-continue` |
| `secrets/secret-keychain`, `secret-age` | (n/a — no secret backends needed) |
| `pi-maestro` (extension wiring) | `pi-extension` (extension wiring) |

## Contracts

```typescript
// sync/contracts/src/model-info.ts

/** Provider-agnostic model metadata produced by the sync engine. */
interface ModelInfo {
  /** Public model ID (what the editor sends in API requests). */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /** Provider key (e.g. "anthropic", "openai"). */
  provider: string;
  /** Context window size in tokens. */
  contextWindow: number;
  /** Max output/completion tokens. */
  maxOutputTokens: number;
  /** Whether the model supports image inputs. */
  supportsImages: boolean;
  /** Whether the model supports tool/function calling. */
  supportsTools: boolean;
  /** Whether the model is a reasoning/thinking model. */
  reasoning: boolean;
}
```

```typescript
// sync/contracts/src/sync-target.ts

interface SyncTarget {
  /** Unique target identifier (e.g. "zed", "continue"). */
  readonly id: string;
  /** Human-readable name for UI/notifications. */
  readonly displayName: string;

  /** Detect whether this target is installed/configured on the system. */
  detect(): Promise<DetectResult>;

  /** Read the current model list from the target's config. */
  read(): Promise<ReadResult>;

  /** Write updated models to the target's config. */
  apply(models: readonly ModelInfo[], options: SyncOptions): Promise<SyncResult>;
}

interface DetectResult {
  readonly found: boolean;
  /** Resolved path to the config file, if found. */
  readonly configPath?: string | undefined;
}

interface SyncOptions {
  /** Provider name in the target's config (e.g. "Pi Proxy"). */
  readonly providerName: string;
  /** API URL to write into the target's config. */
  readonly apiUrl: string;
  /** Dry run — return what would change without writing. */
  readonly dryRun: boolean;
}

interface SyncResult {
  readonly ok: boolean;
  /** Number of models added/updated/removed. */
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  /** Human-readable summary. */
  readonly summary: string;
  /** Error message if !ok. */
  readonly error?: string | undefined;
}

interface ReadResult {
  readonly ok: boolean;
  readonly models: readonly ModelInfo[];
  readonly error?: string | undefined;
}
```

## Proxy model metadata

Add `x_pi` to `GET /v1/models` and `GET /v1/models/{model}` responses:

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

This is the only change needed in the proxy package itself. The sync engine
reads this and maps to `ModelInfo[]`.

### Field mapping: pi Model -> x_pi

| `x_pi` field | Source |
|---|---|
| `display_name` | `Model.name` |
| `context_window` | `Model.contextWindow` |
| `max_output_tokens` | `Model.maxTokens` |
| `reasoning` | `Model.reasoning` |
| `input_modalities` | `Model.input` (e.g. `["text", "image"]`) |

## Target: Zed

### Config format

```jsonc
// ~/.config/zed/settings.json (JSONC with comments)
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

### Field mapping: ModelInfo -> Zed AvailableModel

| Zed field | Source |
|---|---|
| `name` | `ModelInfo.id` |
| `display_name` | `ModelInfo.displayName` |
| `max_tokens` | `ModelInfo.contextWindow` |
| `max_output_tokens` | `ModelInfo.maxOutputTokens` |
| `capabilities.tools` | `ModelInfo.supportsTools` |
| `capabilities.images` | `ModelInfo.supportsImages` |
| `capabilities.parallel_tool_calls` | `false` |
| `capabilities.prompt_cache_key` | `false` |
| `capabilities.chat_completions` | `true` |

### JSONC handling

Use `jsonc-parser` (Microsoft's parser with `modify()` for surgical edits that
preserve comments and formatting). Replace only the `available_models` array at
the correct JSON path.

### Settings file discovery

```
macOS:  ~/.config/zed/settings.json
        ~/Library/Application Support/Zed/settings.json
Linux:  $XDG_CONFIG_HOME/zed/settings.json
        ~/.config/zed/settings.json
```

Check both paths, prefer whichever exists. Support Zed Preview via a separate
config directory.

## Target: Continue.dev (future)

Continue uses `~/.continue/config.yaml` (YAML with inline comments):

```yaml
models:
  - name: Claude Sonnet 4
    provider: openai
    model: anthropic/claude-sonnet-4-20250514
    apiBase: http://127.0.0.1:4141/v1
    contextLength: 200000
    capabilities:
      - tool_use
      - image_input
```

Same `ModelInfo` input, different serialization target.

## Extension commands

```
/proxy sync           Sync to all detected targets
/proxy sync zed       Sync to Zed only
/proxy sync --dry-run Preview without writing
/proxy sync --list    Show detected targets and their config paths
```

## Implementation phases

1. **Add `x_pi` metadata to model endpoints** — proxy package only
2. **Scaffold sync monorepo packages** — contracts, engine, target-zed
3. **Implement Zed target** — JSONC read/write with `jsonc-parser`
4. **Wire into extension** — `/proxy sync` commands
5. **Add Continue target** — when demand exists
