<!--
Sync Impact Report
Version change: 1.0.0 → 1.0.1
Modified principles:
- None (governance text unchanged; audit corrected downstream workflow alignment)
Added sections:
- None
Removed sections:
- None
Templates requiring updates:
- ✅ .specify/templates/plan-template.md (native `/spec` references aligned)
- ✅ .specify/templates/spec-template.md (reviewed; no changes required)
- ✅ .specify/templates/tasks-template.md (native `/spec tasks` reference aligned)
- ✅ .specify/templates/checklist-template.md (native `/spec checklist` reference aligned)
- ✅ .specify/templates/commands/*.md (native `/spec` and `.specify/memory/pi-agent.md` guidance aligned)
- ✅ .specify/memory/pi-agent.md (reviewed; no changes required)
Follow-up TODOs: none
-->

# pi-openai-proxy Constitution

## Core Principles

### I. Stable OpenAI Contract
The proxy MUST expose only the documented stable HTTP surface: `GET /v1/models`, `GET /v1/models/{model}`, and `POST /v1/chat/completions`.
Responses for supported routes MUST stay close to OpenAI's schema, and unsupported routes or parameters MUST fail with clear OpenAI-style errors rather than being silently ignored. Any pi-specific extension data, if ever exposed, MUST be explicitly namespaced and documented.

Rationale: the proxy exists to be a predictable compatibility layer. Hidden behavior or surprise API drift breaks downstream clients and makes the proxy harder to trust.

### II. Validate at Boundaries
All untrusted input MUST be validated at the edge before use. Request bodies, headers, model identifiers, tool schemas, and environment-driven configuration MUST be checked with explicit runtime validation, and unsupported values MUST be rejected clearly.

Type safety rules are part of the contract: use repository type guards for narrowing, prefer safe parsing, and avoid unsafe casts or ignore directives. Validation failures MUST surface as actionable client errors.

Rationale: the proxy translates between multiple schemas and provider APIs, so boundary validation is the primary defense against accidental incompatibility and latent runtime bugs.

### III. Local-First Safety
The default runtime posture MUST remain local and conservative. The server MUST bind to localhost by default, secrets MUST never be echoed in errors, and upstream work MUST be canceled when the client disconnects. Any feature that increases exposure or expands attack surface, including remote image fetching or experimental agentic behavior, MUST remain off by default and require explicit opt-in.

Rationale: the project is designed for personal or workstation-local use. Safety defaults reduce the chance that a convenience feature becomes a security problem.

### IV. Model and Header Discipline
Canonical model identifiers MUST remain `provider/model-id` internally. Public model IDs, exposure rules, and provider prefix labels MUST be explicit, configurable, and validated. Hidden models MUST NOT become reachable through fallback resolution. The proxy MUST reserve `Authorization` for proxy authentication compatibility, and upstream credential overrides MUST use proxy-specific headers.

Rationale: model identity and auth headers are the two places where ambiguity can leak across trust boundaries. Keeping those rules explicit prevents accidental exposure and preserves client interoperability.

### V. Release Hygiene and Traceability
Behavior changes MUST be reflected in the durable project docs and workflow memory: `README.md`, `PLAN.md`, `TODO.md`, `ROADMAP.md`, `.specify/memory/pi-agent.md`, and relevant templates when their guidance changes. Before shipping code changes, run the smallest relevant verification first, then the required quality gates for the scope of the change.

Commits SHOULD stay small and reviewable, and release/version changes MUST follow semantic versioning.

Rationale: the proxy's public contract is documentation-heavy. If behavior changes without synchronized docs and verification, downstream users and agents will diverge from the real system.

## API Compatibility and Security Boundaries

- Stable support is limited to the documented chat-completions and models routes.
- Unsupported fields and endpoints MUST fail explicitly; silent downgrades are not acceptable.
- Model exposure policy MUST be derived from configured credentials and the active exposure mode, not from ad hoc request-time guessing.
- Experimental capabilities MUST be separated from the stable contract and require explicit opt-in before they can affect user traffic.
- Security-sensitive defaults, including localhost binding and disabled remote image fetching, MUST remain conservative unless the constitution is amended.

## Development Workflow and Quality Gates

- Use Bun, TypeScript, Hono, Zod v4, and TypeBox as the runtime stack for this repository.
- Use the `@proxy/*` import alias for `src/*`, `node:` protocol imports for Node built-ins, and `import * as z from "zod"` for schema work.
- Before completion, run the smallest verification that exercises the change; if types changed, run typecheck; if runtime behavior changed, run lint and tests; if packaging or entrypoints changed, run build.
- Preserve the existing hook-backed workflow and do not weaken lint, type, or test gates unless the user explicitly asks.
- Update durable docs and notes in the same change when a change affects user-visible behavior, architecture, or operator workflow.

## Governance

This constitution supersedes conflicting guidance in other project docs and workflow templates.

Amendments require:

1. a written rationale for the change,
2. a semantic version bump,
3. a synchronized update to dependent docs and memory files,
4. a compliance review against the updated principles before the change is considered complete.

Versioning policy:

- **MAJOR**: incompatible governance changes or removed principles
- **MINOR**: added principles or materially expanded guidance
- **PATCH**: clarifications, wording fixes, or non-semantic refinements

Compliance review expectations:

- Every pull request or review that touches proxy behavior MUST check the change against this constitution.
- Any change to stable routes, auth semantics, model resolution, validation rules, or security defaults MUST explicitly call out the affected principle(s).
- If implementation and docs disagree, the implementation MUST be corrected or the docs amended before release.

**Version**: 1.0.1 | **Ratified**: 2026-03-31 | **Last Amended**: 2026-03-31
