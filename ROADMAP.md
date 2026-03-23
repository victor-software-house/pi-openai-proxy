# Roadmap

This file is the short phase summary. See `PLAN.md` for the detailed implementation contract and `TODO.md` for the actionable checklist.

## Phase 0 -- Contract lock

Freeze the API and security decisions before implementation starts.

- [ ] Finalize model ID strategy and encoded route handling
- [ ] Finalize auth override strategy
- [ ] Finalize supported request field matrix
- [ ] Finalize SSE chunk contract
- [ ] Finalize error contract
- [ ] Finalize image-fetch security policy
- [ ] Mark agentic mode experimental

## Phase 1 -- Stable core proxy

Deliver the minimum production-capable proxy.

- [ ] Scaffold the project and core modules
- [ ] Integrate `AuthStorage` and `ModelRegistry`
- [ ] Implement `GET /v1/models`
- [ ] Implement `GET /v1/models/{model}`
- [ ] Implement non-streaming `POST /v1/chat/completions`
- [ ] Implement streaming `POST /v1/chat/completions`
- [ ] Implement request IDs, structured logs, and disconnect cancellation
- [ ] Implement OpenAI-style errors
- [ ] Add unit and golden tests for the stable contract

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
