# Roadmap

This file is the short phase summary. See `PLAN.md` for the detailed implementation contract and `TODO.md` for the actionable checklist.

## Phase 0 — Contract lock [DONE]

Freeze the API and security decisions before implementation starts.

- [x] Finalize model ID strategy and encoded route handling
- [x] Finalize auth override strategy
- [x] Finalize supported request field matrix
- [x] Finalize SSE chunk contract
- [x] Finalize error contract
- [x] Finalize image-fetch security policy
- [x] Mark agentic mode experimental

## Phase 1 — Stable core proxy [DONE]

Deliver the minimum production-capable proxy.

- [x] Scaffold the project and core modules
- [x] Integrate `AuthStorage` and `ModelRegistry`
- [x] Implement `GET /v1/models`
- [x] Implement `GET /v1/models/{model}`
- [x] Implement non-streaming `POST /v1/chat/completions`
- [x] Implement streaming `POST /v1/chat/completions`
- [x] Implement request IDs, structured logs, and disconnect cancellation
- [x] Implement OpenAI-style errors
- [x] Add unit and integration tests for the stable contract
- [x] Align strict tooling with pi-acp (oxlintrc, biome, lefthook, commitlint, Zod v4)

## Phase 2 — Tools and richer compatibility [DONE]

Add the supported compatibility surface deliberately.

- [x] Support OpenAI function tools subset (JSON Schema -> TypeBox)
- [x] Support assistant `tool_calls` and `tool` role messages
- [x] Support `stream_options.include_usage`
- [x] Support base64 image inputs (remote URLs rejected by default)
- [x] Support `reasoning_effort` (mapped to pi ThinkingLevel)
- [x] Add passthrough parameters: `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `response_format`
- [x] Add JSON Schema conversion and tool acceptance/rejection tests
- [ ] Remote image URL support (deferred — requires SSRF protections)

## Phase 3 — Hardening and packaging [DONE]

Prepare the stable proxy for release.

- [x] Add request size limits (50 MB default, configurable)
- [x] Add upstream timeout defaults (120s, configurable)
- [x] Add graceful shutdown (SIGTERM/SIGINT with 10s drain)
- [x] Add per-request upstream API key override (`X-Pi-Upstream-Api-Key`)
- [x] Add image MIME type and payload size validation
- [x] Add CI gates (GitHub Actions: typecheck, lint, test, build, package)
- [x] Package for npm release (`@victor-software-house/pi-openai-proxy`)
- [ ] Run compatibility smoke tests with target clients (Open WebUI, Continue, Aider)

## Phase 3A — Model exposure and identifier controls [DONE]

Standardize model exposure and make public IDs configurable.

- [x] Remove `x_pi` from the standard models endpoints
- [x] Add configurable public ID modes: `collision-prefixed`, `universal`, `always-prefixed`
- [x] Add configurable exposure modes: `all`, `scoped`, `custom`
- [x] Add provider prefix overrides and explicit validation
- [x] Use a shared exposure/resolution layer for models listing, detail lookup, and chat requests
- [x] Refresh compatibility support for `reasoning_effort` and `response_format.json_schema`
- [x] Refactor the `/proxy` extension around a controller-backed config flow
- [x] Add `/proxy verify` and selector UIs for scoped providers and custom models
- [x] Prefer `max_completion_tokens` over deprecated `max_tokens` in docs and validation messaging

## Phase 3B — SDK conformance and robustness testing [DONE]

Validate response shapes against the official OpenAI Node SDK to catch field-level bugs that break real clients.

- [x] Remove dead code (`resolve-model.ts`)
- [x] Add `openai` as explicit devDependency
- [x] Wire-level SSE conformance tests (chunk shape, `finish_reason` lifecycle, tool deltas, usage chunk, `[DONE]`)
- [x] Non-streaming response conformance tests (`ChatCompletion` shape, `content` nullability, `tool_calls`)
- [x] SDK round-trip conformance tests using `openai` client with `_strict_response_validation: true`
- [x] Security tests (image URL blocking, oversized payloads)
- [x] Code audit identified gaps in tool_choice forwarding, strict mode, and PLAN.md drift — tracked in Phase 3C

## Phase 3C — Known gaps and silent drops [DONE]

Address issues found by code audit that violate the project's policy of rejecting unsupported parameters clearly.

- [x] Fix `tool_choice` silent drop: forward via `onPayload` passthrough
- [x] Fix `strict` on function tools: forward via `onPayload` payload patching
- [x] Update PLAN.md known gaps section (tool_choice resolved, strict resolved, parallel_tool_calls analyzed)
- [x] `anyOf` documentation was already correct (TODO item was stale)

## Phase 3D — Compatibility analysis and resilience [DONE]

Research-backed decisions on deferred compatibility and resilience items. Analysis: `docs/engineering/phase-3d-analysis.md`.

- [x] Promote `parallel_tool_calls` to `onPayload` passthrough (Continue was getting 422)
- [x] Promote `metadata` (Open WebUI sends it) and `prediction` (Continue sends it) to passthrough
- [x] Audit all `rejectedFields`: keep `n`, `logprobs`, `top_logprobs`, `logit_bias`, `functions`, `function_call`
- [x] Document resilience architecture as intentional (no concurrency limiter, no circuit breaker, no retry)
- [x] Add structured `upstream_overload` warn-level logging for 429 and 503 responses
- [ ] Run compatibility smoke tests with target clients (Open WebUI, Continue, Aider)

## Phase 4 — Monorepo and proper CLI

Split into two packages in a pnpm/turborepo monorepo (reference: pi-maestro structure).

### Package split

```text
packages/
├── proxy/           pi-proxy -- standalone CLI + HTTP server + config schema
└── pi-extension/    @pi-openai-proxy/pi-extension -- pi package (depends on pi-proxy)
```

- `pi-proxy` is the primary deliverable: proper CLI binary with args, help, shell completions
- Config schema (types, defaults, normalization, JSON I/O) lives in `pi-proxy` and is exported via `pi-proxy/config`
- `@pi-openai-proxy/pi-extension` imports config from `pi-proxy/config`, spawns `pi-proxy` binary
- People who only want the proxy install `pi-proxy`. Pi users install the extension.

### CLI (`pi-proxy`)

Proper CLI with a framework (citty or cleye) — the current binary has no argument parsing.

```bash
pi-proxy                          Start the proxy server (foreground)
pi-proxy --port 8080              Override port
pi-proxy --host 0.0.0.0           Override bind address
pi-proxy --auth-token <token>     Enable proxy auth
pi-proxy --config                 Show effective config (JSON file + env overrides)
pi-proxy --help                   Full help with all options
pi-proxy --version                Version
pi-proxy completions              Generate shell completions (bash/zsh/fish)
```

CLI args > env vars > JSON config file (`~/.pi/agent/proxy-config.json`) > defaults.

### Config SSOT

- [ ] Config schema defined once in `pi-proxy` (types, defaults, normalize, JSON I/O)
- [ ] Server reads JSON config as defaults, env vars override, CLI args override both
- [ ] Extension imports schema from `pi-proxy/config` — no duplication
- [ ] JSON config file is the shared persistence layer written by both CLI and extension

### Workspace setup

- [ ] Bun workspace (bun workspaces, not pnpm)
- [ ] Turborepo for task orchestration
- [ ] Shared tsconfig.base.json, biome.json, oxlintrc at root
- [ ] Per-package build, test, typecheck tasks
- [ ] CI workflow updated for monorepo

## Phase 5 — Experimental agentic mode

Ship agentic behavior only after the stable proxy is solid.

- [ ] Design a separate experimental contract
- [ ] Bridge `AgentSession` events to SSE
- [ ] Add session persistence and resume
- [ ] Enforce strict cwd and extension policy
- [ ] Decide whether to use a separate endpoint
