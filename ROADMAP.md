# Roadmap

This file is the short phase summary. See `PLAN.md` for the detailed implementation contract and `TODO.md` for the actionable checklist.

## Phase 0 -- Contract lock [DONE]

Freeze the API and security decisions before implementation starts.

- [x] Finalize model ID strategy and encoded route handling
- [x] Finalize auth override strategy
- [x] Finalize supported request field matrix
- [x] Finalize SSE chunk contract
- [x] Finalize error contract
- [x] Finalize image-fetch security policy
- [x] Mark agentic mode experimental

## Phase 1 -- Stable core proxy [DONE]

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

## Phase 2 -- Tools and richer compatibility [DONE]

Add the supported compatibility surface deliberately.

- [x] Support OpenAI function tools subset (JSON Schema -> TypeBox)
- [x] Support assistant `tool_calls` and `tool` role messages
- [x] Support `stream_options.include_usage`
- [x] Support base64 image inputs (remote URLs rejected by default)
- [x] Support `reasoning_effort` (mapped to pi ThinkingLevel)
- [x] Add passthrough parameters: `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `response_format`
- [x] Add JSON Schema conversion and tool acceptance/rejection tests
- [ ] Remote image URL support (deferred -- requires SSRF protections)

## Phase 3 -- Hardening and packaging [DONE]

Prepare the stable proxy for release.

- [x] Add request size limits (50 MB default, configurable)
- [x] Add upstream timeout defaults (120s, configurable)
- [x] Add graceful shutdown (SIGTERM/SIGINT with 10s drain)
- [x] Add per-request upstream API key override (`X-Pi-Upstream-Api-Key`)
- [x] Add image MIME type and payload size validation
- [x] Add CI gates (GitHub Actions: typecheck, lint, test, build, package)
- [x] Package for npm release (`@victor-software-house/pi-openai-proxy`)
- [ ] Run compatibility smoke tests with target clients (Open WebUI, Continue, Aider)

## Phase 4 -- Unified config and pi-maestro integration

Single source of truth for config and multi-account support via pi-maestro.

- [ ] Make the server read `~/.pi/agent/proxy-config.json` as defaults (env vars override)
- [ ] Eliminate config divergence between standalone and extension-spawned modes
- [ ] Integrate with pi-maestro for multi-account provider rotation
- [ ] Route proxy requests through pi-maestro's account engine (quota rotation, per-account usage tracking)
- [ ] Expose pi-maestro account status in proxy responses or a `/v1/pi/status` endpoint

## Phase 5 -- Experimental agentic mode

Ship agentic behavior only after the stable proxy is solid.

- [ ] Design a separate experimental contract
- [ ] Bridge `AgentSession` events to SSE
- [ ] Add session persistence and resume
- [ ] Enforce strict cwd and extension policy
- [ ] Decide whether to use a separate endpoint
