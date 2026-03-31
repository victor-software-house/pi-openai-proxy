# Native /spec Workflow

This project uses the native pi spec workflow inspired by GitHub spec-kit.

## Core commands

- /spec init
- /spec constitution <principles>
- /spec specify <feature description>
- /spec clarify [focus]
- /spec checklist [domain]
- /spec plan <technical context>
- /spec tasks [context]
- /spec analyze [focus]
- /spec implement [focus]
- /spec status
- /spec next

## Runtime notes

- The pi extension handles feature numbering, branch naming, path resolution, and file scaffolding in TypeScript.
- Workflow templates live in .specify/templates/commands/ and can be customized per project.
- File templates live in .specify/templates/.
- The native replacement for agent-specific context files is .specify/memory/pi-agent.md.
- Feature artifacts live in specs/###-feature-name/.
