# OpenAI-Compatible Client Discovery

Research into libraries, frameworks, and tools that can plug into an OpenAI-compatible endpoint with interactive feature toggle and validation capabilities.

**Date**: 2026-03-26
**Context**: Selecting tools for proxy smoke testing and interactive validation of all supported features (Phase 3 straggler in TODO.md).

## Evaluation criteria

- Connects to any OpenAI-compatible base URL (not locked to OpenAI or Ollama)
- Exposes per-request parameters: temperature, top_p, max_tokens, stop, seed, frequency_penalty, presence_penalty
- Supports tool/function calling (enable/disable, tool_choice)
- Supports streaming toggle (stream on/off)
- Supports reasoning_effort / extended thinking
- Supports response_format (text, json_object, json_schema)
- Interactive: can toggle features at will without editing config files
- Low setup overhead (no Docker-only, no cloud deploy required)

## Candidates

### Tier 1: Full-featured interactive UIs

These are self-hosted chat interfaces that connect to OpenAI-compatible endpoints and expose model parameters in the UI.

#### Open WebUI (129k stars)

- **Repo**: [open-webui/open-webui](https://github.com/open-webui/open-webui)
- **Type**: Web UI (Python backend, Svelte frontend)
- **OpenAI-compat**: Native. Set base URL + API key in settings.
- **UI parameter panel** (`AdvancedParams.svelte`):
  - temperature, top_p, top_k, max_tokens
  - frequency_penalty, presence_penalty
  - seed, stop sequences
  - reasoning_effort, reasoning_tags
  - mirostat, mirostat_eta, mirostat_tau (Ollama-specific)
  - repeat_last_n, repeat_penalty (Ollama-specific)
- **Tools**: Pipelines system for custom tools; `tool_choice` passthrough to API
- **Streaming**: Default on, configurable
- **Reasoning**: reasoning_effort slider in advanced params
- **Install**: Docker (`docker run -p 3000:8080 ghcr.io/open-webui/open-webui`) or pip (`pip install open-webui`)
- **Strengths**: Most complete parameter coverage in a single UI. Huge community. Active development.
- **Weaknesses**: Heavy — pulls in Ollama integration, RAG, user auth, SQLite. Overkill for pure API testing. Docker preferred for full setup.

#### LibreChat (35k stars)

- **Repo**: [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)
- **Type**: Web UI (Node.js backend, React frontend)
- **OpenAI-compat**: Native. Custom endpoints via `librechat.yaml` with `baseURL` config.
- **UI parameters**: temperature, top_p, top_k, max_tokens, frequency_penalty, presence_penalty
- **Tools**: Agents system + MCP tools integration. Custom fields via `addParams` config.
- **Streaming**: Yes
- **Reasoning**: Via `addParams` config for custom endpoints (not a native UI toggle yet — [discussion #9466](https://github.com/danny-avila/LibreChat/discussions/9466))
- **Install**: Docker Compose (requires MongoDB, Meilisearch)
- **Strengths**: Multi-provider support (OpenAI, Anthropic, Google, Azure). Responses API support. Agent handoffs.
- **Weaknesses**: Heavier Docker Compose stack. Custom endpoint parameter toggles require YAML config, not purely interactive. Reasoning toggle for custom endpoints still in progress.

#### LobeChat (74k stars)

- **Repo**: [lobehub/lobe-chat](https://github.com/lobehub/lobe-chat)
- **Type**: Web UI (Next.js)
- **OpenAI-compat**: Native. Custom provider with base URL.
- **UI parameters**: temperature, top_p, max_tokens, frequency_penalty, presence_penalty
- **Tools**: Plugin system with marketplace
- **Streaming**: Yes
- **Reasoning**: Model-dependent, no explicit toggle
- **Install**: Docker or Vercel deploy
- **Strengths**: Polished UI. Plugin ecosystem. Multi-agent collaboration.
- **Weaknesses**: Agent-focused UX — less suited for raw API parameter testing. No stop/seed/reasoning_effort toggles in UI.

#### NextChat (88k stars)

- **Repo**: [ChatGPTNextWeb/NextChat](https://github.com/ChatGPTNextWeb/NextChat)
- **Type**: Web UI (Next.js)
- **OpenAI-compat**: Native. Custom base URL in settings.
- **UI parameters**: temperature, top_p, max_tokens, presence_penalty, frequency_penalty
- **Tools**: No tool calling UI
- **Streaming**: Yes
- **Install**: Docker or Vercel deploy
- **Strengths**: Very lightweight. Fast to deploy.
- **Weaknesses**: No tool calling support. No stop/seed/reasoning toggles. Too limited for feature validation.

#### Chatbox (39k stars)

- **Repo**: [Bin-Huang/chatbox](https://github.com/Bin-Huang/chatbox)
- **Type**: Desktop app (Electron)
- **OpenAI-compat**: Native. Custom API host in settings.
- **UI parameters**: temperature, top_p, max_tokens
- **Tools**: No tool calling UI
- **Streaming**: Yes
- **Install**: Desktop installer (macOS, Windows, Linux)
- **Strengths**: Zero server setup. Clean desktop UI.
- **Weaknesses**: Limited parameter exposure. No tools, no stop/seed/reasoning. Not suitable for comprehensive validation.

### Tier 2: CLI tools

Terminal-based clients that connect to OpenAI-compatible endpoints with configurable parameters.

#### aichat (9.6k stars)

- **Repo**: [sigoden/aichat](https://github.com/sigoden/aichat)
- **Type**: CLI (Rust)
- **OpenAI-compat**: Yes. `type: openai-compatible` with custom `api_base` in config.
- **Configurable params**:
  - temperature (config + `AICHAT_TEMPERATURE` env var)
  - top_p (config + `AICHAT_TOP_P` env var)
  - max_tokens (in request body)
  - stream toggle (`-S`/`--no-stream` flag, config, `AICHAT_STREAM` env var)
  - function_calling toggle (config + `AICHAT_FUNCTION_CALLING` env var)
  - Tool selection via `use_tools` and `mapping_tools` config
- **Not exposed**: stop, seed, reasoning_effort, response_format, frequency_penalty, presence_penalty
- **Install**: `cargo install aichat` or brew
- **Strengths**: Lightweight. Fast. Shell integration (pipe stdin). RAG support. MCP tools. Function calling toggle.
- **Weaknesses**: Parameters set via config file + env vars, not truly interactive per-request. Missing stop/seed/reasoning/penalties.

#### mods (4.5k stars)

- **Repo**: [charmbracelet/mods](https://github.com/charmbracelet/mods)
- **Type**: CLI (Go)
- **OpenAI-compat**: Yes. Custom base URL per API config.
- **Configurable params**: `--temp`, `--topp`, `--max-tokens`
- **Tools**: MCP tools via `--mcp-list-tools`
- **Streaming**: Default on
- **Install**: `brew install mods` or `go install`
- **Strengths**: Pipe-oriented. Charm ecosystem (bubbletea TUI). MCP support.
- **Weaknesses**: Pipe-oriented, not interactive chat. Limited parameter flags. No stop/seed/reasoning/penalties.

### Tier 3: Testing and evaluation frameworks

Purpose-built tools for systematic API testing and comparison.

#### promptfoo (18.6k stars)

- **Repo**: [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)
- **Type**: CLI + Web UI (Node.js)
- **OpenAI-compat**: Yes. `apiBaseUrl` + `apiKey` in provider config.
- **Per-test-case parameters**:
  - temperature, top_p, max_tokens/max_completion_tokens
  - stop sequences
  - tools, tool_choice, function_call
  - response_format (json_object, json_schema)
  - reasoning effort
  - seed
  - Any custom parameter via provider config passthrough
- **Feature toggles**: Each test case in YAML can override any parameter independently.
- **Interactive UI**: `promptfoo eval setup` (browser-based config), `promptfoo view` (results viewer with side-by-side comparison)
- **Install**: `npx promptfoo@latest` or `npm install -g promptfoo`
- **Strengths**: Designed for exactly this use case. Declarative YAML configs. Per-test parameter overrides. Assertion system (check finish_reason, content patterns, tool calls). CI/CD integration. Used by OpenAI and Anthropic.
- **Weaknesses**: Not a chat interface — test cases are predefined, not conversational. Learning curve for YAML config. The web UI is for results viewing, not live chat.

### Tier 4: Lightweight playgrounds

Minimal tools specifically for exploring OpenAI-compatible APIs.

#### openai_api_playground (24 stars)

- **Repo**: [cyber-tao/openai_api_playground](https://github.com/cyber-tao/openai_api_playground)
- **Type**: Streamlit web app (Python)
- **OpenAI-compat**: Yes. Set any API server URL + key in the UI.
- **Features**:
  - List all models on the server
  - Select model and set parameters interactively
  - Stream / non-stream mode toggle
  - Connection latency test
  - Token generation speed benchmark with concurrency
  - View session state
- **Not supported**: Tools/function calling, multimodal
- **Install**: `pip install streamlit && streamlit run app.py`
- **Strengths**: Lightest weight option. Point at any URL. Toggle stream mode. Set all basic params.
- **Weaknesses**: No tool calling. No reasoning. Only 24 stars — limited maintenance. No assertions or automated testing.

#### open-llm-playground (22 stars)

- **Repo**: [stephenw310/open-llm-playground](https://github.com/stephenw310/open-llm-playground)
- **Type**: Next.js web app
- **OpenAI-compat**: Yes. Configurable models.
- **Features**: OpenAI Playground clone UI with inline message editing
- **Install**: `npm run dev`
- **Strengths**: Familiar OpenAI Playground UX.
- **Weaknesses**: Very limited feature set. 22 stars. No tools, no streaming toggle, no advanced params.

#### Langfuse Playground

- **URL**: [langfuse.com/docs/prompt-management/features/playground](https://langfuse.com/docs/prompt-management/features/playground)
- **Type**: Cloud or self-hosted (prompt management platform)
- **Features**: Side-by-side prompt comparison, tool calling with JSON schema mock responses, model selection, prompt variables
- **Strengths**: Tool calling with mock responses. Structured output testing. Part of observability platform.
- **Weaknesses**: Requires Langfuse setup. Primarily a prompt management tool, not an API endpoint tester.

### Other notable tools (evaluated and excluded)

| Tool | Stars | Reason excluded |
|---|---|---|
| Jan | 41k | Focused on local models (Ollama/GGUF). OpenAI-compat is secondary. |
| text-generation-webui | 46k | Focused on local model inference. OpenAI-compat API is an extension, not the primary interface. Gradio UI with parameter knobs but oriented toward local model loading. |
| AnythingLLM | 57k | Workspace/RAG focused. Not an API parameter testing tool. |
| big-AGI | 6.9k | Full-featured but focused on agent capabilities, not parameter-level testing. |
| oterm | 2.3k | Ollama-only TUI. Not OpenAI-compatible. |
| Spring AI Playground | ~1k | Java/Spring ecosystem. MCP + RAG tools. Heavy setup for non-Java users. |

## Feature coverage matrix

Which proxy features each tool can validate interactively:

| Feature | Open WebUI | LibreChat | promptfoo | aichat | openai_api_playground |
|---|---|---|---|---|---|
| Custom base URL | yes | yes | yes | yes | yes |
| temperature | yes | yes | yes | yes | yes |
| top_p | yes | yes | yes | yes | yes |
| max_tokens | yes | yes | yes | yes | yes |
| stop sequences | yes | yaml config | yes | no | no |
| seed | yes | yaml config | yes | no | no |
| frequency_penalty | yes | yes | yes | no | no |
| presence_penalty | yes | yes | yes | no | no |
| streaming toggle | yes | yes | yes | yes (flag) | yes |
| tools / function calling | pipelines | agents + MCP | yaml config | config toggle | no |
| tool_choice | passthrough | addParams | yaml config | no | no |
| reasoning_effort | yes | addParams | yaml config | no | no |
| response_format | no | no | yaml config | no | no |
| parallel_tool_calls | passthrough | unknown | yaml config | no | no |
| model selection | yes | yes | yaml config | yes | yes (list) |

## Recommendations

### For automated regression testing: promptfoo

Best fit for "validate all features systematically." Define a YAML test suite with one test case per feature, each toggling parameters independently. Run as CI gate or locally. Web UI for results inspection.

```yaml
# Example promptfoo config for proxy validation
providers:
  - id: openai:chat:anthropic/claude-sonnet-4-6
    config:
      apiBaseUrl: http://127.0.0.1:4141/v1

tests:
  - description: "basic text"
    vars: { prompt: "What is 2+2?" }
    assert:
      - type: contains
        value: "4"

  - description: "tool calling"
    vars: { prompt: "Calculate 15*23" }
    options:
      tools: [{ type: function, function: { name: calc, ... } }]
    assert:
      - type: is-json

  - description: "stop sequences"
    vars: { prompt: "Count 1 to 20" }
    options:
      stop: ["8"]
    assert:
      - type: not-contains
        value: "9"
```

### For interactive manual validation: Open WebUI

Most complete parameter panel. Covers temperature, top_p, max_tokens, penalties, seed, stop, reasoning_effort out of the box. Tools via Pipelines. Point the OpenAI connection to `http://127.0.0.1:4141/v1`.

### For quick CLI smoke tests: aichat

Lightweight. Toggle streaming and function_calling per-model. Configure custom endpoint with one YAML block. Good for "does it respond at all" checks.

### For minimal overhead parameter poking: openai_api_playground

Streamlit app. Zero Docker. Set URL, pick model from dropdown, tweak sliders, toggle stream, send. Lacks tools/reasoning but validates the basics in seconds.

## Decision

Pending. Options are not mutually exclusive — promptfoo for automated regression, Open WebUI or the Streamlit playground for interactive exploration.
