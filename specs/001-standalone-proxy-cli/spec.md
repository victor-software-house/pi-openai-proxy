# Feature Specification: Standalone Proxy CLI

**Feature Branch**: `001-standalone-proxy-cli`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "standalone proxy cli"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the proxy directly from the terminal (Priority: P1)

As an operator who wants to use the proxy outside the pi package flow, I want a first-class command-line entry point so I can start the proxy, override key runtime settings for a single run, and understand what the process is doing without editing internal files.

**Why this priority**: A direct CLI is the clearest remaining operator-facing gap in the roadmap. It unlocks standalone usage without changing the stable HTTP contract.

**Independent Test**: Can be fully tested by installing the package, running the CLI with common commands such as start, help, version, and config display, and confirming the proxy starts with the requested runtime settings.

**Acceptance Scenarios**:

1. **Given** the proxy is installed and local credentials are already configured, **When** the operator starts the proxy from the terminal with no overrides, **Then** the proxy starts successfully using safe default settings.
2. **Given** the operator needs a one-off runtime change, **When** they start the proxy with explicit command-line overrides, **Then** the proxy uses those overrides for that run without permanently rewriting shared configuration.
3. **Given** the operator is unsure how to use the command, **When** they request help or version information, **Then** the CLI returns clear, human-readable guidance.

---

### User Story 2 - Share one configuration model across entry points (Priority: P2)

As a maintainer or pi user, I want the standalone CLI and the pi extension to resolve configuration the same way so that changing settings in one supported path produces consistent behavior in the other.

**Why this priority**: Once a standalone CLI exists, inconsistent configuration handling would create support burden and unpredictable runtime behavior.

**Independent Test**: Can be tested independently by configuring the proxy through the shared supported settings surface, then confirming both the standalone CLI and the pi-integrated flow report and use the same effective configuration.

**Acceptance Scenarios**:

1. **Given** a shared persisted configuration exists, **When** the proxy is started through either supported entry point, **Then** both runs resolve the same effective default settings.
2. **Given** a temporary override is supplied at launch time, **When** the proxy starts, **Then** the override takes precedence only for that invocation while the shared stored defaults remain unchanged.

---

### User Story 3 - Validate and inspect effective settings before use (Priority: P3)

As an operator preparing to expose the proxy to local tools, I want to inspect the effective configuration and receive explicit validation errors so I can correct mistakes before requests fail unexpectedly.

**Why this priority**: Safe inspectability reduces misconfiguration risk and aligns with the project's local-first and explicit-validation principles.

**Independent Test**: Can be tested independently by supplying valid and invalid configuration combinations, inspecting the reported effective settings, and confirming invalid states are rejected with actionable errors.

**Acceptance Scenarios**:

1. **Given** the operator wants to confirm how the proxy will run, **When** they request the effective configuration view, **Then** they receive a clear summary of the resolved settings and where overrides are coming from.
2. **Given** the operator supplies an invalid or conflicting configuration, **When** they run a validation or startup command, **Then** the proxy fails early with a clear error that identifies the invalid setting.

## Edge Cases

- What happens when the operator provides conflicting values through multiple supported configuration sources?
- What happens when a persisted configuration file contains unknown, invalid, or deprecated fields?
- How does the system handle a startup command when the requested port is unavailable?
- How does the system behave when required upstream credentials are missing even though the CLI itself is valid?
- What happens when an operator asks for help, version, or configuration output while the persisted configuration is partially invalid?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a standalone command-line entry point for starting the proxy without requiring the pi package workflow.
- **FR-002**: System MUST allow operators to supply one-run startup overrides for the network bind address, listen port, and proxy authentication token.
- **FR-003**: System MUST provide human-readable help output that documents the supported commands, options, and default behavior.
- **FR-004**: System MUST provide a version command that reports the installed proxy version without starting the server.
- **FR-005**: System MUST provide a way to inspect the effective runtime configuration before or without starting the server.
- **FR-006**: System MUST resolve configuration consistently across the supported sources using one documented precedence order.
- **FR-007**: System MUST preserve a shared persisted configuration format so that supported entry points read the same defaults.
- **FR-008**: System MUST ensure temporary launch-time overrides do not silently rewrite the shared persisted configuration.
- **FR-009**: System MUST reject invalid, unknown, or conflicting configuration values with explicit and actionable error messages.
- **FR-010**: System MUST preserve the existing stable HTTP contract and local-first safety defaults when launched through the new CLI.
- **FR-011**: System MUST continue to reserve proxy authentication behavior and upstream credential behavior according to the current project contract.
- **FR-012**: System MUST allow operators to generate or access shell completion guidance for supported shells.
- **FR-013**: System MUST keep the standalone CLI and pi-integrated entry point behavior aligned when they resolve the same persisted configuration and no per-run overrides are supplied.

### Key Entities *(include if feature involves data)*

- **Persisted Proxy Configuration**: The durable operator-managed settings record that defines the proxy's default runtime behavior across supported entry points.
- **Configuration Source**: A single origin of settings, such as persisted defaults, environment-provided values, or one-run launch overrides, used to resolve the effective runtime state.
- **Effective Runtime Configuration**: The fully resolved runtime settings snapshot that the proxy will actually use for a given invocation.
- **CLI Invocation**: A single operator command execution, including its requested command, optional overrides, and validation outcome.

## Assumptions

- The requested feature name is "standalone proxy cli", referring to the highest-value remaining roadmap item for the proxy rather than a request to change the stable HTTP API surface.
- Existing HTTP endpoints, request semantics, model resolution rules, and safety defaults remain unchanged by this feature.
- The feature should improve operator usability first and treat deeper packaging or repository restructuring as supporting work only if needed to deliver the standalone CLI experience.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time operator can start the proxy successfully from the standalone CLI using documented defaults in under 5 minutes without editing internal project files.
- **SC-002**: In manual validation, 100% of tested supported configuration sources resolve to the same effective settings when given equivalent inputs.
- **SC-003**: 100% of tested invalid configuration combinations fail before request serving begins and include an error message that identifies the offending setting.
- **SC-004**: Operators can retrieve help, version, and effective configuration output in a single command invocation without starting the proxy server.
- **SC-005**: Existing clients using the stable HTTP surface can continue to connect successfully after this feature is delivered, with no required changes to the documented API contract.
