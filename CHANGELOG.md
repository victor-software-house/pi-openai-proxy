# [4.2.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.1.0...v4.2.0) (2026-03-25)


### Features

* add /proxy restart command ([66fa02f](https://github.com/victor-software-house/pi-openai-proxy/commit/66fa02f89d336d2d48acaff457ef9e542072235a))

# [4.1.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.0.6...v4.1.0) (2026-03-25)


### Features

* hot-reload exposure config from file on each request ([3409d52](https://github.com/victor-software-house/pi-openai-proxy/commit/3409d5254ca3e3f9e3bbb87caa6d850ff1892836))
* hot-reload model exposure config without proxy restart ([a0e444b](https://github.com/victor-software-house/pi-openai-proxy/commit/a0e444be7f73dfb495521d1f8897d35ca64250d6))

## [4.0.6](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.0.5...v4.0.6) (2026-03-25)


### Bug Fixes

* improve settings panel with dynamic descriptions and clearer labels ([88f8b9f](https://github.com/victor-software-house/pi-openai-proxy/commit/88f8b9f9bfc67d9a1c4929d60ce65a0209fe4a3d))

## [4.0.5](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.0.4...v4.0.5) (2026-03-25)


### Bug Fixes

* make tests deterministic by removing loadConfig() dependency ([1cc1026](https://github.com/victor-software-house/pi-openai-proxy/commit/1cc10264ca83570c515a3fa9cadc80b92bbd015b))
* restore local dist/ as first proxy binary lookup path ([d25b9d0](https://github.com/victor-software-house/pi-openai-proxy/commit/d25b9d01e457a5de645492c37a8085d3d0edc103))

## [4.0.4](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.0.3...v4.0.4) (2026-03-25)


### Bug Fixes

* separate CI tests from SDK conformance tests ([cf6b401](https://github.com/victor-software-house/pi-openai-proxy/commit/cf6b4019e479b71a6808cb89de1036206ada1e0c))

## [4.0.3](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.0.2...v4.0.3) (2026-03-25)


### Bug Fixes

* promote all warn-level lint rules to error ([32988b5](https://github.com/victor-software-house/pi-openai-proxy/commit/32988b58acd08042c5594484c82cdb3b1fb99d01))

## [4.0.2](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.0.1...v4.0.2) (2026-03-25)


### Bug Fixes

* promote noUnusedVariables from warn to error in biome config ([808926e](https://github.com/victor-software-house/pi-openai-proxy/commit/808926e6172abc529b714e369e79b02361a0651c))
* remove unused getUniqueProviders function from extension ([a6710bc](https://github.com/victor-software-house/pi-openai-proxy/commit/a6710bc18a175c9f2f97f9a70f292de50298be73))

## [4.0.1](https://github.com/victor-software-house/pi-openai-proxy/compare/v4.0.0...v4.0.1) (2026-03-25)


### Bug Fixes

* remove unused TINY_PNG constant from security tests ([658d2fd](https://github.com/victor-software-house/pi-openai-proxy/commit/658d2fdba6bfbc8cc3cac30d77a24a3285b69718))

# [4.0.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v3.0.0...v4.0.0) (2026-03-25)


* fix!: redesign model exposure UX and fix settings panel selection reset ([787624c](https://github.com/victor-software-house/pi-openai-proxy/commit/787624c21a80d182a5bbabc58d113cac4b7fcd76))


### BREAKING CHANGES

* default modelExposureMode changed from 'all' to 'scoped'.
The 'scoped' mode now means 'use pi's available (auth-configured) models'
which was the previous 'all' behavior. The 'all' mode now exposes all
registered models regardless of auth status.

Settings panel fixes:
- Fix selection jumping to first item on every value change: use
  SettingsList.updateValue() instead of rebuilding the entire list
- Remove scopedProviders, customModels, providerPrefixes as separate
  top-level settings items
- Single 'Exposure mode' enum: scoped (default), all, custom
- 'Select models' item with submenu for interactive model selection
  when exposure mode is 'custom'

Model-exposure engine:
- computeModelExposure() now accepts both available and allRegistered
  model arrays
- 'scoped' mode uses available (auth-filtered) models
- 'all' mode uses all registered models
- 'custom' mode filters available by canonical ID allowlist

# [3.0.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v2.1.0...v3.0.0) (2026-03-25)


* fix!: redesign model exposure UX and fix settings panel selection reset ([97db649](https://github.com/victor-software-house/pi-openai-proxy/commit/97db64961372206d732e64fbc0fa5b8ece26e90c))


### BREAKING CHANGES

* default modelExposureMode changed from 'all' to 'scoped'.
The 'scoped' mode now means 'use pi's available (auth-configured) models'
which was the previous 'all' behavior. The 'all' mode now exposes all
registered models regardless of auth status.

Settings panel fixes:
- Fix selection jumping to first item on every value change: use
  SettingsList.updateValue() instead of rebuilding the entire list
- Remove scopedProviders, customModels, providerPrefixes as separate
  top-level settings items (confusing toggle UX)
- Single 'Exposure mode' enum: scoped (default), all, custom
- 'Select models' item with submenu that opens an interactive model
  selector checklist when exposure mode is 'custom'
- Model selector supports arrow keys, Space to toggle, Esc to close

Model-exposure engine:
- computeModelExposure() now accepts both available and allRegistered
  model arrays
- 'scoped' mode uses available (auth-filtered) models
- 'all' mode uses all registered models
- 'custom' mode filters available by canonical ID allowlist

Config schema:
- Default modelExposureMode changed to 'scoped'
- scopedProviders field retained for backward compat but unused

# [2.1.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v2.0.0...v2.1.0) (2026-03-24)


### Features

* add /proxy verify, exposure settings panel, and public ID preview ([ac13313](https://github.com/victor-software-house/pi-openai-proxy/commit/ac13313dcad594a3a685e23e05605f1186916751))

# [2.0.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v1.0.0...v2.0.0) (2026-03-24)


* feat!: add model exposure engine with configurable public IDs and filtering ([82f866c](https://github.com/victor-software-house/pi-openai-proxy/commit/82f866c6d8f65fd9fb9bb26298dc9f79df8d952d))


### BREAKING CHANGES

* /v1/models and /v1/models/{model} no longer include x_pi
metadata. Model objects now follow the standard OpenAI shape only.

Model exposure engine (src/openai/model-exposure.ts):
- Three public ID modes: collision-prefixed (default), universal,
  always-prefixed
- Three exposure modes: all (default), scoped, custom
- Connected conflict group detection via Union-Find for
  collision-prefixed mode
- Provider prefix label overrides with uniqueness validation
- Universal mode collision detection with explicit config errors
- Resolution: public ID match -> canonical ID fallback (exposed only)
- Hidden models cannot be reached through canonical fallback

Config schema extended with:
- publicModelIdMode, modelExposureMode, scopedProviders, customModels,
  providerPrefixes
- Type guards for enum validation (no unsafe assertions)
- Normalization for string arrays and string records from JSON

Server integration:
- All three endpoints (GET /v1/models, GET /v1/models/{model},
  POST /v1/chat/completions) route through the shared exposure engine
- Replaces direct registry lookup and shorthand resolution

Compatibility refresh:
- reasoning_effort expanded: none, minimal, low, medium, high, xhigh
- response_format: added json_schema variant alongside text and
  json_object
- Reasoning effort mapping: none -> minimal, xhigh -> xhigh

Tests:
- 29 new unit tests for exposure engine covering all modes, conflict
  groups, prefix validation, resolution, and edge cases
- Updated integration tests for exposure-based resolution
- 4 new validation tests for expanded reasoning_effort and json_schema

# [1.0.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.3.1...v1.0.0) (2026-03-23)


* feat!: restructure as Bun workspace monorepo (Phase 4) ([5f7a690](https://github.com/victor-software-house/pi-openai-proxy/commit/5f7a6904bef4d6dfe2bdb5d5c3e7c507cbd8e06b))


### Bug Fixes

* resolve tsconfig lib/types for monorepo packages ([9770dbc](https://github.com/victor-software-house/pi-openai-proxy/commit/9770dbc5875e1f5557802deb678045bf2d39ef33))
* restore ES2023 lib in proxy tsconfig for editor compatibility ([ad554a7](https://github.com/victor-software-house/pi-openai-proxy/commit/ad554a7bdb8eb2685d35a89091a5630c086bf409))
* update lefthook and CI for monorepo ([4759525](https://github.com/victor-software-house/pi-openai-proxy/commit/4759525670a1ec8b8e862a12e1d9d7e54e5064b2))


### BREAKING CHANGES

* Package split into two packages.

Monorepo structure:
  packages/proxy/         pi-proxy (standalone CLI + HTTP server)
  packages/pi-extension/  @pi-openai-proxy/pi-extension (pi package)

pi-proxy changes:
- Proper CLI with citty (--host, --port, --auth-token, --config, --help)
- Config priority: CLI args > env vars > JSON file > defaults
- Config schema in src/config/schema.ts, exported via pi-proxy/config (SSOT)
- Binary renamed to pi-proxy, shebang #!/usr/bin/env bun
- ServerConfig replaces ProxyConfig in server internals
- @sinclair/typebox added to dependencies

@pi-openai-proxy/pi-extension changes:
- Imports config from pi-proxy/config (zero duplication)
- pi-proxy as workspace dependency, pi core as peerDependencies

Workspace:
- Bun workspaces + turborepo
- Shared tsconfig.base.json, biome at root, oxlint per-package

## [0.3.1](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.3.0...v0.3.1) (2026-03-23)


### Bug Fixes

* type errors in extension, add Phase 4 (config + pi-maestro) to roadmap ([bcaa761](https://github.com/victor-software-house/pi-openai-proxy/commit/bcaa761d67dcb5d4a9c7f3a9dc20c5ad1db58bbb))

# [0.3.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.2.3...v0.3.0) (2026-03-23)


### Features

* configurable proxy lifetime (detached or session-tied) ([036b534](https://github.com/victor-software-house/pi-openai-proxy/commit/036b53413c090eef560212899dfb7bfe99a28bf3))

## [0.2.3](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.2.2...v0.2.3) (2026-03-23)


### Bug Fixes

* remove undiscoverable --proxy flag, keep config panel ([27c2b92](https://github.com/victor-software-house/pi-openai-proxy/commit/27c2b92777e1eb47c9edb0943a00040c4874e0df))

## [0.2.2](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.2.1...v0.2.2) (2026-03-23)


### Bug Fixes

* show auth token on generate, improve /proxy show and docs ([99ebaaf](https://github.com/victor-software-house/pi-openai-proxy/commit/99ebaaf558963d030d514b049f83bd0195bda1a3))

## [0.2.1](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.2.0...v0.2.1) (2026-03-23)


### Bug Fixes

* rebuild SettingsList on change instead of calling nonexistent setItems ([bc140b0](https://github.com/victor-software-house/pi-openai-proxy/commit/bc140b0a37e460dc3dd0e06307289df179d79816))

# [0.2.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.1.1...v0.2.0) (2026-03-23)


### Features

* add /proxy config panel and improve documentation ([0abff00](https://github.com/victor-software-house/pi-openai-proxy/commit/0abff00b265f724ea2b5881b16a9f12005f0ca70))

## [0.1.1](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.1.0...v0.1.1) (2026-03-23)


### Bug Fixes

* use correct notification level 'warning' in proxy extension ([ca1a579](https://github.com/victor-software-house/pi-openai-proxy/commit/ca1a579ddf5fa682d079ad07f63635ddf22c8f5d))

# [0.1.0](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.0.3...v0.1.0) (2026-03-23)


### Features

* add pi extension with /proxy command and --proxy flag ([6ce2bd2](https://github.com/victor-software-house/pi-openai-proxy/commit/6ce2bd2cdeacb06fa76803bd69f030051388d369))

## [0.0.3](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.0.2...v0.0.3) (2026-03-23)


### Bug Fixes

* add pi-package keyword ([693aeea](https://github.com/victor-software-house/pi-openai-proxy/commit/693aeea406fe0048d101946e1a8adca5146fb08e))

## [0.0.2](https://github.com/victor-software-house/pi-openai-proxy/compare/v0.0.1...v0.0.2) (2026-03-23)


### Bug Fixes

* add LICENSE, fix CI test and publish workflow, fix start script path ([0c56796](https://github.com/victor-software-house/pi-openai-proxy/commit/0c56796c6fcdc519c2af0201f29ed9f5f4ad2bd3))
