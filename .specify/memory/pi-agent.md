# pi-openai-proxy Development Guidelines

Auto-generated from repository context. Last updated: 2026-03-31

## Active Technologies

- Bun
- TypeScript
- Hono
- Zod v4
- TypeBox
- pi SDK (`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`)
- tsdown
- Biome
- oxlint
- lefthook
- commitlint
- semantic-release

## Project Structure

```text
src/
├── config/
├── openai/
├── pi/
├── server/
└── sync/

extensions/

specify/
├── memory/
└── templates/
```

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run lint
bun test
```

## Code Style

- Use `@proxy/*` for `src/*` imports; avoid cross-tree relative imports.
- Use `node:` protocol imports for Node built-ins.
- Use `import * as z from "zod"`.
- Prefer `safeParse()` for boundary validation.
- Avoid `any`, `@ts-ignore`, and unsafe casts.
- Keep strict TypeScript settings intact.

## Current Governance Notes

- Stable HTTP surface: `GET /v1/models`, `GET /v1/models/{model}`, `POST /v1/chat/completions`.
- Reject unsupported parameters clearly; do not silently ignore them.
- Keep `Authorization` reserved for proxy auth compatibility.
- Canonical internal model IDs remain `provider/model-id`.
- Local-first security defaults stay in place unless explicitly amended.
- Update `README.md`, `PLAN.md`, `TODO.md`, and `ROADMAP.md` when behavior or workflow changes.

## Recent Changes

- Phase 3D compatibility and resilience decisions were finalized.
- Model exposure and identifier controls were added to the proxy contract.
- Stable OpenAI-compatible proxy behavior is documented and shipped.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
