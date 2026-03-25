# Monorepo Restructuring Plan

Restructure pi-openai-proxy into a pnpm monorepo where
`@victor-software-house/pi-openai-proxy` remains the single installable
package — a thin aggregator that re-exports and wires internal workspace
modules.

## Distribution model

### Key constraints

1. **npm sub-path exports are NOT separate packages.** You cannot
   `npm install @scope/pkg/subpath`. Sub-paths like `./config` are entry
   points within a single package. Separate publishable packages need
   separate names.

2. **Pi install must be a single command.** Users run
   `pi install git:github.com/victor-software-house/pi-openai-proxy` or
   `pi install npm:@victor-software-house/pi-openai-proxy`. No follow-up
   installs.

3. **Pi finds extensions via root `package.json`.** For git installs, pi
   reads `pi.extensions` from the cloned repo root. The root can point into
   workspace packages: `"pi": { "extensions": ["./packages/pi-extension/src"] }`.

### Answer: aggregator package at the root

`@victor-software-house/pi-openai-proxy` stays the published npm package name.
It becomes a thin aggregator that depends on internal workspace packages.
Internal packages are private and never published separately.

For npm distribution, internal packages are included via `bundledDependencies`.
For git distribution, pnpm workspace resolution handles it.

This matches how pi-mono works: one monorepo, multiple packages, each published
separately under `@mariozechner/*`. The difference here is that only ONE
package is published (the aggregator) and the rest are bundled inside it.

## Target structure

```text
pi-openai-proxy/
├── packages/
│   ├── proxy/                          # Standalone proxy server + CLI
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
│   │   └── package.json                # @pi-proxy/server (private)
│   │
│   ├── sync/
│   │   ├── contracts/                  # SyncTarget, ModelInfo (pure types)
│   │   │   ├── src/
│   │   │   ├── tsconfig.json
│   │   │   └── package.json            # @pi-proxy/sync-contracts (private)
│   │   │
│   │   ├── engine/                     # Fetch, diff, orchestrate
│   │   │   ├── src/
│   │   │   ├── tsconfig.json
│   │   │   └── package.json            # @pi-proxy/sync-engine (private)
│   │   │
│   │   └── target-zed/                 # Zed settings.json adapter
│   │       ├── src/
│   │       ├── tsconfig.json
│   │       └── package.json            # @pi-proxy/target-zed (private)
│   │
│   └── pi-extension/                   # Pi extension (wires everything)
│       ├── src/
│       │   └── extension.ts            # Thin aggregator: imports from siblings
│       ├── tsconfig.json
│       └── package.json                # @pi-proxy/pi-extension (private)
│
├── package.json                        # @victor-software-house/pi-openai-proxy
│                                       #   (PUBLIC — the only published package)
│                                       #   pi.extensions -> pi-extension
│                                       #   bin -> proxy CLI
│                                       #   sub-path exports -> proxy config/exposure
│                                       #   bundledDependencies -> all @pi-proxy/*
│
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .oxlintrc.json
├── lefthook.yml
├── PLAN.md
├── ROADMAP.md
└── docs/
```

## The aggregator: root package.json

```json
{
  "name": "@victor-software-house/pi-openai-proxy",
  "version": "5.0.0",
  "type": "module",
  "description": "OpenAI-compatible HTTP proxy for pi's multi-provider model registry",
  "pi": {
    "extensions": ["./packages/pi-extension/src"]
  },
  "bin": {
    "pi-openai-proxy": "./packages/proxy/dist/index.mjs"
  },
  "exports": {
    "./config": {
      "import": "./packages/proxy/dist/config.mjs",
      "types": "./packages/proxy/dist/config.d.mts"
    },
    "./exposure": {
      "import": "./packages/proxy/dist/exposure.mjs",
      "types": "./packages/proxy/dist/exposure.d.mts"
    }
  },
  "files": [
    "packages/*/dist",
    "packages/*/src",
    "packages/*/package.json",
    "packages/*/*/dist",
    "packages/*/*/src",
    "packages/*/*/package.json"
  ],
  "dependencies": {
    "@pi-proxy/server": "workspace:*",
    "@pi-proxy/sync-contracts": "workspace:*",
    "@pi-proxy/sync-engine": "workspace:*",
    "@pi-proxy/target-zed": "workspace:*",
    "@pi-proxy/pi-extension": "workspace:*"
  },
  "bundledDependencies": [
    "@pi-proxy/server",
    "@pi-proxy/sync-contracts",
    "@pi-proxy/sync-engine",
    "@pi-proxy/target-zed",
    "@pi-proxy/pi-extension"
  ],
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*"
  },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "lint": "biome check packages/",
    "prepare": "turbo run build"
  }
}
```

### How each install channel works

| Channel | What happens |
|---|---|
| `pi install git:github.com/...` | Clone, `npm install` (resolves pnpm workspace), `prepare` builds proxy dist. Pi reads `pi.extensions` from root, loads `packages/pi-extension/src/extension.ts` via jiti. Workspace `@pi-proxy/*` imports resolve to sibling source `.ts` files. |
| `pi install npm:@victor-software-house/pi-openai-proxy` | Downloads tarball. `bundledDependencies` includes all `@pi-proxy/*` packages inside `node_modules/`. Pi reads `pi.extensions` from root, loads extension. Extension imports resolve to bundled packages. |
| `npm install -g @victor-software-house/pi-openai-proxy` | Installs globally. `pi-openai-proxy` CLI binary available via `packages/proxy/dist/index.mjs`. |
| External consumers: `import { ... } from "@victor-software-house/pi-openai-proxy/config"` | Resolves to `packages/proxy/dist/config.mjs` via root `exports`. |

## Internal packages

All private. Never published to npm independently.

### `@pi-proxy/server` (packages/proxy)

The standalone proxy server and CLI. Only package with a build step (tsdown).

```json
{
  "name": "@pi-proxy/server",
  "private": true,
  "type": "module",
  "exports": {
    ".":          { "import": "./dist/index.mjs",    "types": "./dist/index.d.mts" },
    "./config":   { "import": "./dist/config.mjs",   "types": "./dist/config.d.mts" },
    "./exposure": { "import": "./dist/exposure.mjs",  "types": "./dist/exposure.d.mts" }
  },
  "scripts": { "build": "tsdown" },
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

Contains everything currently in `src/`. No structural changes to server code.
The `@proxy/*` import alias stays scoped to this package's tsconfig.

### `@pi-proxy/sync-contracts` (packages/sync/contracts)

Pure types and Zod schemas. No build step — ships `.ts` source.

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

### `@pi-proxy/sync-engine` (packages/sync/engine)

Fetch from proxy, map to `ModelInfo[]`, diff, call `SyncTarget.apply()`.

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
    "jsonc-parser": "catalog:"
  }
}
```

### `@pi-proxy/pi-extension` (packages/pi-extension)

The pi extension. Thin wiring layer — imports from workspace siblings.

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

## Migration steps

1. **Init workspace** — `pnpm-workspace.yaml`, `turbo.json`,
   `tsconfig.base.json`
2. **Move proxy** — `src/`, `test/`, `tsdown.config.ts` -> `packages/proxy/`
3. **Move extension** — `extensions/proxy.ts` ->
   `packages/pi-extension/src/extension.ts`
4. **Fix extension imports** — from
   `@victor-software-house/pi-openai-proxy/config` to
   `@pi-proxy/server/config` (workspace resolution)
5. **Update root package.json** — aggregator with `bundledDependencies`,
   `pi.extensions`, `bin`, `exports` pointing into workspace packages
6. **Scaffold sync packages** — contracts, engine, target-zed (empty
   initially, filled when implementing sync)
7. **Update CI** — turbo-based build/test/typecheck pipeline
8. **Update `prepare`** — `turbo run build` (builds only proxy, the
   only package with a build step)
9. **Test both channels** — `pi install git:...` and `npm pack` +
   `pi install npm:...`

## What does NOT change for consumers

- Package name: `@victor-software-house/pi-openai-proxy`
- Install command: `pi install git:github.com/victor-software-house/pi-openai-proxy`
- Sub-path imports: `@victor-software-house/pi-openai-proxy/config`
- CLI binary: `pi-openai-proxy`
- Extension commands: `/proxy start`, `/proxy stop`, etc.
