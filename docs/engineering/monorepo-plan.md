# Monorepo Restructuring Plan

Restructure pi-openai-proxy from a single package into a pnpm monorepo,
following pi-maestro's patterns where applicable.

## Key difference from pi-maestro

pi-maestro is private, ships `.ts` source, and is installed only via `git:`.
No build step needed.

pi-openai-proxy has **two distribution channels**:

1. **npm** — published `@victor-software-house/pi-openai-proxy` with built
   `dist/`, a CLI binary, and sub-path exports (`./config`, `./exposure`).
   Consumers import built `.mjs` files.
2. **git** — `pi install git:github.com/...` clones and runs `npm install` +
   `prepare` (which builds `dist/`). Extension loaded via jiti.

This means the proxy package needs a build step (tsdown). Internal workspace
packages used only by the extension can ship `.ts` source (jiti-loaded, like
pi-maestro). The sync packages fall into this second category.

## Target structure

```text
pi-openai-proxy/
├── packages/
│   ├── proxy/                          # The npm-published proxy
│   │   ├── src/
│   │   │   ├── config/                 # Config schema, env loading
│   │   │   ├── openai/                 # Schemas, messages, SSE, tools, etc.
│   │   │   ├── pi/                     # Registry, complete/stream bridge
│   │   │   ├── server/                 # Hono app, routes, middleware
│   │   │   ├── utils/                  # Shared guards
│   │   │   ├── env.d.ts
│   │   │   └── index.ts                # CLI entry point
│   │   ├── test/
│   │   ├── tsdown.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json                # @pi-proxy/server (public npm)
│   │
│   ├── sync/
│   │   ├── contracts/                  # SyncTarget, ModelInfo (pure types)
│   │   │   ├── src/
│   │   │   ├── tsconfig.json
│   │   │   └── package.json            # @pi-proxy/sync-contracts
│   │   │
│   │   ├── engine/                     # Fetch, diff, orchestrate
│   │   │   ├── src/
│   │   │   ├── tsconfig.json
│   │   │   └── package.json            # @pi-proxy/sync-engine
│   │   │
│   │   └── target-zed/                 # Zed settings.json adapter
│   │       ├── src/
│   │       ├── tsconfig.json
│   │       └── package.json            # @pi-proxy/target-zed
│   │
│   └── pi-extension/                   # Pi extension (wires proxy + sync)
│       ├── src/
│       │   └── extension.ts
│       ├── tsconfig.json
│       └── package.json                # @pi-proxy/pi-extension
│
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .oxlintrc.json
├── lefthook.yml
├── package.json                        # Root (private, workspace scripts)
├── PLAN.md
├── ROADMAP.md
└── docs/
```

## Package details

### `@pi-proxy/server` (packages/proxy)

The standalone proxy. Published to npm. Built with tsdown.

```json
{
  "name": "@pi-proxy/server",
  "version": "5.0.0",
  "type": "module",
  "bin": { "pi-proxy": "dist/index.mjs" },
  "exports": {
    ".":          { "import": "./dist/index.mjs",    "types": "./dist/index.d.mts" },
    "./config":   { "import": "./dist/config.mjs",   "types": "./dist/config.d.mts" },
    "./exposure": { "import": "./dist/exposure.mjs",  "types": "./dist/exposure.d.mts" }
  },
  "dependencies": {
    "@sinclair/typebox": "catalog:",
    "citty": "catalog:",
    "hono": "catalog:",
    "zod": "catalog:"
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*"
  }
}
```

Moves pi-ai and pi-coding-agent from `dependencies` to `peerDependencies`
(like pi-maestro). The proxy runs inside pi's process (when used as extension)
or standalone (CLI), where the consumer provides these.

Contains everything currently in `src/`. No structural changes to server code.

### `@pi-proxy/sync-contracts` (packages/sync/contracts)

Pure types and Zod schemas. No runtime dependencies beyond zod.

```json
{
  "name": "@pi-proxy/sync-contracts",
  "private": true,
  "type": "module",
  "exports": {
    "./model-info": "./src/model-info.ts",
    "./sync-target": "./src/sync-target.ts"
  },
  "dependencies": { "zod": "catalog:" }
}
```

Ships `.ts` source — only consumed by workspace siblings, loaded via jiti.

### `@pi-proxy/sync-engine` (packages/sync/engine)

Fetches models from a running proxy (including `x_pi` metadata), maps to
`ModelInfo[]`, diffs against current target state, calls `target.apply()`.

```json
{
  "name": "@pi-proxy/sync-engine",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/sync.ts" },
  "dependencies": {
    "@pi-proxy/sync-contracts": "workspace:*",
    "zod": "catalog:"
  }
}
```

### `@pi-proxy/target-zed` (packages/sync/target-zed)

Implements `SyncTarget` for Zed's JSONC `settings.json`.

```json
{
  "name": "@pi-proxy/target-zed",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/adapter.ts" },
  "dependencies": {
    "@pi-proxy/sync-contracts": "workspace:*",
    "jsonc-parser": "^3.3.1"
  }
}
```

### `@pi-proxy/pi-extension` (packages/pi-extension)

The Pi extension. Wires proxy config, sync engine, and targets. Registers
`/proxy` command family.

```json
{
  "name": "@pi-proxy/pi-extension",
  "private": true,
  "type": "module",
  "pi": { "extensions": ["./src/extension.ts"] },
  "exports": { ".": "./src/extension.ts" },
  "files": ["src"],
  "dependencies": {
    "@pi-proxy/server": "workspace:*",
    "@pi-proxy/sync-engine": "workspace:*",
    "@pi-proxy/target-zed": "workspace:*"
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*"
  }
}
```

The extension imports config from `@pi-proxy/server/config` (workspace
resolution — no self-reference issue). Ships `.ts` source like pi-maestro.

## Root configuration

### pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
  - "packages/*/*"

catalog:
  "@mariozechner/pi-ai": "^0.62.0"
  "@mariozechner/pi-coding-agent": "^0.62.0"
  "@mariozechner/pi-tui": "^0.62.0"
  "@sinclair/typebox": "^0.34.0"
  "@types/bun": "^1.3.11"
  "@types/node": "^25.5.0"
  citty: "^0.1.6"
  hono: "^4.12.8"
  jsonc-parser: "^3.3.1"
  openai: "^6.26.0"
  typescript: "^5.9.3"
  vitest: "^4.1.0"
  zod: "^4.3.6"
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.base.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "inputs": ["src/**", "tsconfig.json", "tsdown.config.ts"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "inputs": ["src/**/*.ts", "tsconfig.json"]
    },
    "test": {
      "dependsOn": ["^typecheck"],
      "inputs": ["src/**/*.ts", "test/**/*.ts", "tsconfig.json"]
    },
    "dev": { "cache": false, "persistent": true }
  }
}
```

### tsconfig.base.json

Extracted from current `tsconfig.json`, matching pi-maestro:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "module": "ESNext",
    "target": "ES2023"
  }
}
```

### biome.json + .oxlintrc.json

Stay at root. biome scopes to `packages/`. oxlint runs per-package via turbo.

## Migration steps

1. **Init workspace** — add `pnpm-workspace.yaml`, `turbo.json`,
   `tsconfig.base.json`, root `package.json`
2. **Move proxy** — `src/`, `test/`, `tsdown.config.ts` -> `packages/proxy/`
3. **Move extension** — `extensions/proxy.ts` -> `packages/pi-extension/src/extension.ts`
4. **Fix extension imports** — change from `@victor-software-house/pi-openai-proxy/config`
   to `@pi-proxy/server/config` (workspace resolution, no build needed)
5. **Scaffold sync packages** — contracts, engine, target-zed (can be empty initially)
6. **Update CI** — turbo-based build/test/typecheck pipeline
7. **Update npm publish** — only `@pi-proxy/server` publishes to npm
8. **Update `pi install`** — root `package.json` gets `pi.extensions` pointing
   to `packages/pi-extension/src/extension.ts`

## What changes for consumers

| Channel | Before | After |
|---|---|---|
| npm install | `@victor-software-house/pi-openai-proxy` | `@pi-proxy/server` (new name) |
| pi install git | same repo URL | same repo URL (root `pi.extensions` discovered) |
| pi install npm | `npm:@victor-software-house/pi-openai-proxy` | `npm:@pi-proxy/server` or dedicated extension package |

## Open question: npm package name

Options for the proxy package:
- `@pi-proxy/server` — clean scope, matches monorepo naming
- `pi-openai-proxy` — unscoped, memorable, `npx pi-openai-proxy`
- Keep `@victor-software-house/pi-openai-proxy` — continuity but long

The extension package could be:
- Published separately as `@pi-proxy/pi-extension` if users want npm install
- Or kept private (git install only, like pi-maestro)

## Open question: pi install from monorepo

When `pi install git:github.com/victor-software-house/pi-openai-proxy` clones
the monorepo, pi needs to find the extension. Options:

1. Root `package.json` declares `pi.extensions` pointing to the extension package
2. Root `package.json` uses `pi.packages` to point to `packages/pi-extension`

Need to verify which pattern pi supports for monorepo git installs. Pi-maestro
uses `"pi": { "extensions": ["./src/extension.ts"] }` in the leaf package, and
gets installed by pointing at the leaf package path. But pi-openai-proxy is
installed by pointing at the repo root.
