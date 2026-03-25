# Zed + Pi IDE Integration Discovery

Discovery date: 2026-03-25

## Goal

Run Pi in Zed's built-in terminal with bidirectional editor context — selected text, current file, diagnostics, open editors — injected into Pi sessions. Same model as Claude Code running inside VS Code's terminal.

## Architecture overview

Two sides needed:
A cleaner view of the integration:

```text
┌────────────────────────── Zed ──────────────────────────┐
│ ┌──────────────────────────────┐                        │
│ │ Zed extension                │                        │
│ │ (Rust + WASM + companion)    │                        │
│ │ • selection tracking         │                        │
│ │ • open editors / files       │                        │
│ │ • diagnostics                │                        │
│ └───────────────┬──────────────┘                        │
└─────────────────┼───────────────────────────────────────┘
                  │ Claude Code WebSocket
                  │ or simple file-based IPC
                  ▼
┌──────────────── Pi in Zed terminal ─────────────────────┐
│ ┌──────────────────────────────┐                        │
│ │ Pi extension                 │                        │
│ │ • reads IDE context          │                        │
│ │ • injects context before     │                        │
│ │   `before_agent_start`       │                        │
│ │ • can expose IDE-backed      │                        │
│ │   tools to Pi                │                        │
│ └──────────────────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```


## Existing Pi packages

### `@lukebarton/pi-de-claude` (v0.1.1)

- npm: `npm:@lukebarton/pi-de-claude`
- Repo: https://github.com/lukebarton/pi-de-claude
- Install: `pi install npm:@lukebarton/pi-de-claude`
- Uses `/ide` command to connect
- Connects to any IDE running a Claude Code plugin via the WebSocket protocol
- Supports: VS Code, Neovim (claudecode.nvim), JetBrains
- Features: highlighted code visible to Pi, Pi triggers IDE diffs, open files
- Gap: needs a Zed-side Claude Code protocol server (does not exist today)
- Author notes: may break if Anthropic changes the protocol

### `@pborck/pi-de` (v0.1.6)

- npm: `npm:@pborck/pi-de`
- Repo: https://github.com/pierre-borckmans/pide
- Install: `pi install npm:@pborck/pi-de`
- File-based approach: IDE writes `~/.pi/ide-selection.json`, Pi watches it
- Uses `/ide` command + `Ctrl+;` keybinding to reference selection
- Has plugins for: VS Code, Cursor, VSCodium, Neovim, JetBrains family
- No WebSocket, no auth, no port conflicts, works across multiple Pi instances
- Gap: no Zed plugin, but the protocol is trivial (write a JSON file on selection change)
- Simpler but no bidirectional features (no diffs, no openFile from Pi)

### `vscode-pi-companion` (v0.2.0)

- npm: `vscode-pi-companion`
- Repo: https://github.com/ravshansbox/vscode-pi-companion
- VS Code only, not relevant for Zed

### `pi-acp` (v0.0.23)

- npm: `pi-acp`
- Repo: https://github.com/svkozak/pi-acp
- ACP adapter — runs Pi inside Zed's Agent Panel (not the terminal)
- Different model from what we want: replaces the terminal workflow entirely
- Mentioned for completeness; not the target integration

## Recommended path: `@lukebarton/pi-de-claude` + Zed Claude Code protocol extension

This gives the full experience: selections, diffs, file opening, diagnostics.

### What exists on the Zed side

#### Archived: `isomoes/claude-code-zed`

- Repo: https://github.com/isomoes/claude-code-zed (archived Aug 2025)
- Architecture: Rust WASM extension + native companion server
- Two components:
  1. **Zed Extension** (`claude-code-zed`): Rust compiled to WASM, handles editor selection tracking, file reference handling, LSP lifecycle
  2. **Claude Code Server** (`claude-code-server`): native Rust app, WebSocket server on localhost, lock file management, JSON-RPC protocol, bridges Zed extension and CLI agent
- Communication flow: Zed Extension <-> LSP <-> Native Server <-> WebSocket <-> CLI Agent
- Was working but author moved to VS Code and archived it
- A fork by `jiahaoxiang2000` was mentioned in GitHub discussions as having basic functionality

#### Zed native capabilities (not sufficient alone)

- Zed has MCP Server support in extensions, but MCP servers feed into Zed's own AI agent, not external terminal agents
- Zed's Agent Panel has `/selection`, `/file`, `/terminal`, `/diagnostics` slash commands — internal only
- Zed's Task System exposes `ZED_*` env vars (`ZED_FILE`, `ZED_SELECTED_TEXT`, `ZED_ROW`, etc.) but only for task commands, not continuous streaming
- Zed's built-in terminal does not expose editor context to running processes
- Active discussion: https://github.com/zed-industries/zed/discussions/25498

## The Claude Code IDE Protocol

Authoritative spec: https://github.com/coder/claudecode.nvim/blob/main/PROTOCOL.md

### Discovery mechanism

1. IDE extension starts a WebSocket server on random localhost port (10000-65535)
2. Writes lock file to `~/.claude/ide/[port].lock`:
   ```json
   {
     "pid": 12345,
     "workspaceFolders": ["/path/to/project"],
     "ideName": "Zed",
     "transport": "ws",
     "authToken": "550e8400-e29b-41d4-a716-446655440000"
   }
   ```
3. Sets env vars in terminal: `CLAUDE_CODE_SSE_PORT=<port>`, `ENABLE_IDE_INTEGRATION=true`
4. CLI agent reads lock files, authenticates via `x-claude-code-ide-authorization` header

### Protocol messages (JSON-RPC 2.0 over WebSocket)

**IDE -> Agent (notifications):**

| Method | Payload | Purpose |
|---|---|---|
| `selection_changed` | `{text, filePath, fileUrl, selection: {start, end, isEmpty}}` | Real-time selection tracking |
| `at_mentioned` | `{filePath, lineStart, lineEnd}` | Explicit context send |

**Agent -> IDE (MCP tool calls):**

12 tools registered by the VS Code extension:

| Tool | Purpose |
|---|---|
| `openFile` | Open file, optionally select a range |
| `openDiff` | Open git diff view (blocking, waits for user accept/reject) |
| `getCurrentSelection` | Get current text selection |
| `getLatestSelection` | Get most recent selection (even if not active) |
| `getOpenEditors` | List open editor tabs |
| `getWorkspaceFolders` | Get workspace folders |
| `getDiagnostics` | Get LSP diagnostics (errors, warnings) |
| `checkDocumentDirty` | Check if file has unsaved changes |
| `saveDocument` | Save a file |
| `close_tab` | Close a tab by name |
| `closeAllDiffTabs` | Close all diff tabs |
| `executeCode` | Execute code in Jupyter kernel |

### Reference implementations

| Implementation | Language | Status | Repo |
|---|---|---|---|
| VS Code (official) | TypeScript | Active, minified | Bundled with Claude Code |
| Neovim | Lua | Active | https://github.com/coder/claudecode.nvim |
| JetBrains (official) | Kotlin | Active | Bundled with Claude Code |
| Zed (archived) | Rust + WASM | Archived Aug 2025 | https://github.com/isomoes/claude-code-zed |

## Pi extension API hooks for context injection

From Pi's extension docs (`docs/extensions.md`):

### `before_agent_start`

Fired after user submits prompt, before agent loop. Can inject a message and modify the system prompt.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    message: {
      customType: "ide-context",
      content: "Current selection: ...",
      display: true,
    },
    systemPrompt: event.systemPrompt + "\n\nEditor context: ...",
  };
});
```

### `session_start`

Good for initializing WebSocket connection to the IDE.

### `registerTool`

Can register tools like `getSelection`, `openFile`, `getDiagnostics` that call through to the IDE WebSocket.

### `context`

Fired before each LLM call. Can modify the message list non-destructively.

## Agent Client Protocol (ACP)

For reference — ACP is the standardized protocol for editor-agent communication, separate from the Claude Code IDE protocol.

- Spec: https://agentclientprotocol.com/overview/introduction
- SDK: `@agentclientprotocol/sdk` (npm)
- Zed has native ACP support for agent servers
- `pi-acp` bridges Pi to Zed via ACP, but runs in the Agent Panel, not the terminal
- Zed also publishes: `@zed-industries/claude-agent-acp`, `@zed-industries/codex-acp`

ACP is a different integration model (agent in editor panel vs agent in terminal). Not the target here, but noted for context.

## Zed's Task System env vars

Available when running Zed tasks (not continuous, but useful for one-shot context grabs):

| Variable | Contents |
|---|---|
| `ZED_FILE` | Absolute path of current file |
| `ZED_RELATIVE_FILE` | Path relative to worktree root |
| `ZED_DIRNAME` | Directory of current file |
| `ZED_FILENAME` | Filename only |
| `ZED_ROW` | Cursor line |
| `ZED_COLUMN` | Cursor column |
| `ZED_SELECTED_TEXT` | Currently selected text |
| `ZED_WORKTREE_ROOT` | Project root |

Source: DeepWiki query against `zed-industries/zed`, `VariableName` enum in `crates/task/src/task.rs`.

## Gap analysis

### What needs to be built

1. **Zed extension implementing the Claude Code WebSocket protocol server**
   - Tracks selections, open files, diagnostics
   - Starts WebSocket server on localhost
   - Writes lock file to `~/.claude/ide/[port].lock`
   - Sets `CLAUDE_CODE_SSE_PORT` + `ENABLE_IDE_INTEGRATION` in terminal env
   - Reference: archived `isomoes/claude-code-zed` (Rust + WASM + native companion)
   - The WASM sandbox in Zed cannot do WebSocket directly, so a native companion process is needed (same approach as the archived extension)

2. **Verify `@lukebarton/pi-de-claude` works with the Zed extension**
   - Once the Zed extension is running the WebSocket server, `pi-de-claude` should connect to it via the standard lock file discovery
   - May need minor patches if `pi-de-claude` has hardcoded expectations about `ideName`

### Alternative simpler path (if full protocol is too much)

Use `@pborck/pi-de` + a minimal Zed extension that writes `~/.pi/ide-selection.json` on selection change. This is one-directional (IDE -> Pi) but covers the primary use case of injecting selected text. The JSON format:

```json
{
  "file": "/absolute/path/to/file.ts",
  "selection": "selected text",
  "startLine": 10,
  "endLine": 15,
  "ide": "zed",
  "timestamp": 1707570000000
}
```

## Sources consulted

- Firecrawl searches saved in `.firecrawl/zed-*.json`, `.firecrawl/claude-*.json`, `.firecrawl/pi-*.json`, `.firecrawl/acp-*.json`
- DeepWiki queries: `zed-industries/zed` (task system, MCP, terminal, agent panel), `badlogic/pi-mono` (extension API, RPC mode, IDE integration), `svkozak/pi-acp` (architecture)
- npm search results for `pi-package` with IDE/editor keywords
- Claude Code IDE Protocol spec: https://github.com/coder/claudecode.nvim/blob/main/PROTOCOL.md (full copy at `/tmp/claudecode-protocol.md`)
- Pi extension docs: `@mariozechner/pi-coding-agent/docs/extensions.md`
- Archived Zed extension: https://github.com/isomoes/claude-code-zed
- Zed discussions: https://github.com/zed-industries/zed/discussions/25498
- ACP SDK: https://www.npmjs.com/package/@agentclientprotocol/sdk
