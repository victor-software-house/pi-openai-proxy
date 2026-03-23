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

## Phase 2 -- Tools and richer compatibility

Add the supported compatibility surface deliberately.

- [ ] Support OpenAI function tools subset
- [ ] Support assistant `tool_calls` and `tool` role messages
- [ ] Support `stream_options.include_usage`
- [ ] Support image inputs behind explicit security policy
- [ ] Support `reasoning_effort`
- [ ] Add allowlisted passthrough parameters
- [ ] Add tool and image security tests

## Phase 3 -- Hardening and packaging

Prepare the stable proxy for release.

- [ ] Add request size limits and timeout defaults
- [ ] Add graceful shutdown and connection cleanup
- [ ] Run compatibility smoke tests with target clients
- [ ] Add CI gates for typecheck, lint, and tests
- [ ] Package for npm release

## Phase 4 -- Experimental agentic mode

Ship agentic behavior only after the stable proxy is solid.

- [ ] Design a separate experimental contract
- [ ] Bridge `AgentSession` events to SSE
- [ ] Add session persistence and resume
- [ ] Enforce strict cwd and extension policy
- [ ] Decide whether to use a separate endpoint
