# Architecture Plan: Two Repos

## Overview

Two repositories. One monorepo publishes independent packages under `@pi-proxy/*`.
One extension repo aggregates them into a single `pi install`.

### Repo 1: `pi-proxy` (NEW monorepo)

```
github.com/victor-software-house/pi-proxy
```

Like pi-mono. Lockstep-versioned, independently published packages under the
`@pi-proxy` npm org. Anyone can `npm install` individual packages and build
on top.

### Repo 2: `pi-openai-proxy` (EXISTING — becomes thin aggregator)

```
github.com/victor-software-house/pi-openai-proxy
```

Keeps `@victor-software-house/pi-openai-proxy`. Depends on `@pi-proxy/*`
packages. Ships the pi extension that wires everything together. One
`pi install` gets users the full proxy + config panel + model sync.

---

## Repo 1: `pi-proxy` monorepo

### Structure

```text
pi-proxy/
├── packages/
│   ├── server/                     @pi-proxy/server
│   │   ├── src/
│   │   │   ├── config/             Config schema, env loading, normalization
│   │   │   ├── openai/             Schemas, messages, SSE, tools, model-exposure
│   │   │   ├── pi/                 Registry bridge, completeSimple/streamSimple
│   │   │   ├── server/             Hono app, routes, middleware, errors
│   │   │   ├── utils/              isRecord, shared guards
│   │   │   ├── env.d.ts
│   │   │   └── index.ts            CLI entry point (citty)
│   │   ├── test/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── conformance/
│   │   ├── tsdown.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── sync-contracts/             @pi-proxy/sync-contracts
│   │   ├── src/
│   │   │   ├── model-info.ts       ModelInfo type + Zod schema
│   │   │   └── sync-target.ts      SyncTarget interface, SyncResult, SyncOptions
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── sync-engine/                @pi-proxy/sync-engine
│   │   ├── src/
│   │   │   └── sync.ts             Fetch from proxy, map to ModelInfo[], orchestrate
│   │   ├── test/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── target-zed/                 @pi-proxy/target-zed
│       ├── src/
│       │   ├── adapter.ts          SyncTarget impl for Zed
│       │   ├── discovery.ts        Find Zed settings.json (macOS/Linux, stable/preview)
│       │   └── jsonc.ts            JSONC read/modify/write via jsonc-parser
│       ├── test/
│       ├── tsconfig.json
│       └── package.json
│
├── package.json                    Root: private, workspace scripts, lockstep version
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .oxlintrc.json
├── scripts/
│   ├── release.mjs                 Lockstep version bump + npm publish -ws
│   └── sync-versions.js            Verify lockstep
├── PLAN.md
├── ROADMAP.md
└── docs/
```

### Packages

#### `@pi-proxy/server`

The proxy server. The only package with a build step (tsdown). Published with
`dist/`, CLI binary, sub-path exports.

```json
{
  "name": "@pi-proxy/server",
  "version": "0.1.0",
  "type": "module",
  "bin": { "pi-proxy": "dist/index.mjs" },
  "exports": {
    ".":          { "import": "./dist/index.mjs",    "types": "./dist/index.d.mts" },
    "./config":   { "import": "./dist/config.mjs",   "types": "./dist/config.d.mts" },
    "./exposure": { "import": "./dist/exposure.mjs",  "types": "./dist/exposure.d.mts" }
  },
  "files": ["dist"],
  "scripts": {
    "dev": "bun src/index.ts",
    "build": "tsdown",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
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

Contains everything currently in `src/` and `test/`. The `@proxy/*` path alias
stays scoped to this package's tsconfig. No structural changes to server code.

#### `@pi-proxy/sync-contracts`

Pure types. No build step — ships `.ts` source. Zero runtime dependencies
beyond zod.

```json
{
  "name": "@pi-proxy/sync-contracts",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./model-info":  "./src/model-info.ts",
    "./sync-target": "./src/sync-target.ts"
  },
  "files": ["src"],
  "dependencies": { "zod": "catalog:" }
}
```

Third parties depend on this to build custom sync targets (e.g.,
`@someone/pi-proxy-target-cursor`).

#### `@pi-proxy/sync-engine`

Fetch models from a running proxy (reads `x_pi` metadata), map to
`ModelInfo[]`, diff against current target state, call `target.apply()`.
No build step — ships `.ts` source.

```json
{
  "name": "@pi-proxy/sync-engine",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/sync.ts" },
  "files": ["src"],
  "dependencies": {
    "@pi-proxy/sync-contracts": "^0.1.0",
    "zod": "catalog:"
  }
}
```

#### `@pi-proxy/target-zed`

Implements `SyncTarget` for Zed. Reads/writes JSONC `settings.json` via
`jsonc-parser`. No build step — ships `.ts` source.

```json
{
  "name": "@pi-proxy/target-zed",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/adapter.ts" },
  "files": ["src"],
  "dependencies": {
    "@pi-proxy/sync-contracts": "^0.1.0",
    "jsonc-parser": "catalog:"
  }
}
```

### Workspace config

#### pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"

catalog:
  "@mariozechner/pi-ai": "^0.63.1"
  "@mariozechner/pi-coding-agent": "^0.63.1"
  "@mariozechner/pi-tui": "^0.63.1"
  "@sinclair/typebox": "^0.34.0"
  "@types/bun": "^1.3.11"
  "@types/node": "^25.5.0"
  citty: "^0.1.6"
  hono: "^4.12.8"
  jsonc-parser: "^3.3.1"
  openai: "^6.26.0"
  typescript: "^5.9.3"
  zod: "^4.3.6"
```

#### turbo.json

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
    }
  }
}
```

### Versioning and release

Lockstep versioning (like pi-mono). All packages share one version number.

```bash
node scripts/release.mjs patch   # 0.1.0 -> 0.1.1
node scripts/release.mjs minor   # 0.1.1 -> 0.2.0
```

Release script: bump all package.json versions, commit, tag, `pnpm publish -r
--access public`, push.

Inter-package dependencies use caret ranges (`"@pi-proxy/sync-contracts":
"^0.1.0"`), NOT `workspace:*`, so published packages have valid version
references.

### CI

GitHub Actions:

- **On push to main**: typecheck, lint, test (all packages via turbo)
- **On tag `v*`**: build + `pnpm publish -r --access public` with npm
  provenance (OIDC trusted publishing)

---

## Repo 2: `pi-openai-proxy` (aggregator)

### Structure

```text
pi-openai-proxy/
├── extensions/
│   └── proxy.ts                    The pi extension (wiring + UI)
├── package.json                    @victor-software-house/pi-openai-proxy
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

### package.json

```json
{
  "name": "@victor-software-house/pi-openai-proxy",
  "version": "5.0.0",
  "type": "module",
  "description": "Pi extension: OpenAI-compatible proxy with model sync",
  "pi": {
    "extensions": ["./extensions"]
  },
  "keywords": ["pi-package", "openai", "proxy", "llm", "gateway"],
  "bin": {
    "pi-openai-proxy": "./node_modules/@pi-proxy/server/dist/index.mjs"
  },
  "exports": {
    "./config":   { "import": "@pi-proxy/server/config",   "types": "@pi-proxy/server/config" },
    "./exposure": { "import": "@pi-proxy/server/exposure",  "types": "@pi-proxy/server/exposure" }
  },
  "dependencies": {
    "@pi-proxy/server": "^0.1.0",
    "@pi-proxy/sync-engine": "^0.1.0",
    "@pi-proxy/target-zed": "^0.1.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*"
  }
}
```

### Extension code

The extension imports from `@pi-proxy/*` packages (regular npm deps):

```typescript
// extensions/proxy.ts
import {
  configToEnv, DEFAULT_CONFIG, getConfigPath,
  loadConfigFromFile, saveConfigToFile,
  type ModelExposureMode, type PublicModelIdMode,
} from "@pi-proxy/server/config";

import {
  computeModelExposure, type ModelExposureConfig,
} from "@pi-proxy/server/exposure";

// Future:
import { syncModels } from "@pi-proxy/sync-engine";
import { ZedTarget } from "@pi-proxy/target-zed";
```

No self-reference. No build chicken-and-egg. Clean npm dependency graph.

### What users do

```bash
# Full experience — proxy + config panel + sync
pi install npm:@victor-software-house/pi-openai-proxy

# Or via git
pi install git:github.com/victor-software-house/pi-openai-proxy
```

One install. Everything works.

### What third parties can do

```bash
# Use just the proxy server in their own tool
npm install @pi-proxy/server

# Build a custom sync target
npm install @pi-proxy/sync-contracts
# -> implement SyncTarget, publish as @their-org/pi-proxy-target-cursor

# Use the sync engine with their custom target
npm install @pi-proxy/sync-engine @their-org/pi-proxy-target-cursor
```

Nobody needs to install the aggregator extension to use individual packages.

---

## Migration plan

### Phase 1: Create `pi-proxy` monorepo

1. Create repo `github.com/victor-software-house/pi-proxy`
2. Scaffold workspace: `pnpm-workspace.yaml`, `turbo.json`,
   `tsconfig.base.json`, `biome.json`, `.oxlintrc.json`
3. Move `src/`, `test/`, `tsdown.config.ts` into `packages/server/`
4. Update `packages/server/tsconfig.json` to extend `../../tsconfig.base.json`
5. Update `packages/server/package.json` — new name `@pi-proxy/server`,
   `peerDependencies` for pi-ai/pi-coding-agent
6. Verify: `turbo run build && turbo run typecheck && turbo run test`
7. Scaffold empty sync packages (contracts, engine, target-zed) with
   placeholder source and package.json
8. Add CI workflow and release script
9. Publish `@pi-proxy/server@0.1.0` (the rest can be `0.1.0` placeholders)

### Phase 2: Convert `pi-openai-proxy` to aggregator

1. Remove `src/`, `test/`, `tsdown.config.ts` from pi-openai-proxy
2. Update `package.json` — drop direct deps (hono, typebox, citty, zod),
   add `@pi-proxy/server` dependency
3. Update `extensions/proxy.ts` — change imports from
   `@victor-software-house/pi-openai-proxy/config` to
   `@pi-proxy/server/config`
4. Remove local type guards (the extension imports from `@pi-proxy/server`
   directly now — no self-reference, no build needed)
5. Verify: `pi install npm:@victor-software-house/pi-openai-proxy`
6. Bump to v5.0.0 (breaking: different internal structure)

### Phase 3: Implement sync

1. In `pi-proxy` monorepo: implement sync-contracts, sync-engine, target-zed
2. Add `x_pi` metadata to `@pi-proxy/server` model endpoints
3. Publish new versions of all `@pi-proxy/*` packages
4. In `pi-openai-proxy`: add `@pi-proxy/sync-engine` + `@pi-proxy/target-zed`
   deps, wire `/proxy sync` commands in the extension
5. Publish new version of aggregator

---

## Open decisions

### Naming: `packages/server/` path alias

Currently `@proxy/*` maps to `src/*` in the proxy. In the monorepo, this alias
stays scoped to `packages/server/tsconfig.json`. No collision with workspace
package names since those are `@pi-proxy/*`.

### Lockstep vs independent versioning

Pi-mono uses lockstep (all packages share one version). Recommended here too —
simpler release script, no version matrix. If sync-contracts is at 0.3.0, so
is server, engine, target-zed.

### Toolchain: pnpm vs npm workspaces

Pi-mono uses npm workspaces. Pi-maestro uses pnpm. Either works. pnpm has
stricter dependency resolution (no phantom deps) and `catalog:` for shared
versions. Recommend pnpm + turbo.
