/**
 * Shared model-exposure engine.
 *
 * Computes the exposed model set and public IDs from config + available models.
 * Used by models endpoints, model detail lookup, and chat request model resolution.
 *
 * Public ID modes:
 *   - "collision-prefixed": prefix only providers in conflict groups
 *   - "universal": raw model IDs only; duplicates are a config error
 *   - "always-prefixed": always prefix with <public-prefix>/<model-id>
 *
 * Exposure modes:
 *   - "all": expose every available model
 *   - "scoped": expose models from selected providers only
 *   - "custom": expose an explicit allowlist of canonical IDs
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelExposureMode, PublicModelIdMode } from "@proxy/config/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExposedModel {
	/** The public ID exposed on the HTTP API. */
	readonly publicId: string;
	/** The canonical internal ID: "provider/model-id". */
	readonly canonicalId: string;
	/** The underlying pi model. */
	readonly model: Model<Api>;
	/** The provider key. */
	readonly provider: string;
}

export interface ModelExposureConfig {
	readonly publicModelIdMode: PublicModelIdMode;
	readonly modelExposureMode: ModelExposureMode;
	readonly scopedProviders: readonly string[];
	readonly customModels: readonly string[];
	readonly providerPrefixes: Readonly<Record<string, string>>;
}

export interface ModelExposureResult {
	readonly ok: true;
	/** All exposed models with public IDs. */
	readonly models: readonly ExposedModel[];
	/** Public ID -> ExposedModel for O(1) lookup. */
	readonly byPublicId: ReadonlyMap<string, ExposedModel>;
	/** Canonical ID -> ExposedModel for backward-compat fallback. */
	readonly byCanonicalId: ReadonlyMap<string, ExposedModel>;
}

export interface ModelExposureError {
	readonly ok: false;
	readonly message: string;
}

export type ModelExposureOutcome = ModelExposureResult | ModelExposureError;

// ---------------------------------------------------------------------------
// Exposure filtering
// ---------------------------------------------------------------------------

function filterExposedModels(
	available: readonly Model<Api>[],
	allRegistered: readonly Model<Api>[],
	config: ModelExposureConfig,
): Model<Api>[] {
	switch (config.modelExposureMode) {
		case "scoped":
			// Default: expose pi's available (auth-configured) models
			return [...available];

		case "all":
			// Expose all registered models regardless of auth status
			return [...allRegistered];

		case "custom": {
			const allowed = new Set(config.customModels);
			return available.filter((m) => allowed.has(`${m.provider}/${m.id}`));
		}
	}
}

// ---------------------------------------------------------------------------
// Public ID generation
// ---------------------------------------------------------------------------

/**
 * Get the public prefix label for a provider.
 * Uses the configured override if present, otherwise the provider key itself.
 */
function getPublicPrefix(provider: string, prefixes: Readonly<Record<string, string>>): string {
	const override = prefixes[provider];
	return override !== undefined && override.length > 0 ? override : provider;
}

/**
 * Find connected conflict groups: sets of providers that share at least one raw model ID.
 *
 * If provider A and B share a model ID, and B and C share a different model ID,
 * then {A, B, C} form one connected conflict group.
 */
function findConflictGroups(models: readonly Model<Api>[]): Set<string>[] {
	// Map each raw model ID to the set of providers that offer it
	const modelToProviders = new Map<string, Set<string>>();
	for (const m of models) {
		const existing = modelToProviders.get(m.id);
		if (existing !== undefined) {
			existing.add(m.provider);
		} else {
			modelToProviders.set(m.id, new Set([m.provider]));
		}
	}

	// Union-Find for providers
	const parent = new Map<string, string>();

	function find(x: string): string {
		let root = x;
		while (parent.get(root) !== root) {
			const p = parent.get(root);
			if (p === undefined) break;
			root = p;
		}
		// Path compression
		let current = x;
		while (current !== root) {
			const next = parent.get(current);
			if (next === undefined) break;
			parent.set(current, root);
			current = next;
		}
		return root;
	}

	function union(a: string, b: string): void {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) {
			parent.set(ra, rb);
		}
	}

	// Initialize each provider as its own root
	for (const m of models) {
		if (!parent.has(m.provider)) {
			parent.set(m.provider, m.provider);
		}
	}

	// Union providers that share any model ID
	for (const providers of modelToProviders.values()) {
		if (providers.size <= 1) continue;
		const arr = [...providers];
		const first = arr[0];
		if (first === undefined) continue;
		for (let i = 1; i < arr.length; i++) {
			const other = arr[i];
			if (other !== undefined) {
				union(first, other);
			}
		}
	}

	// Collect groups by root
	const groupsByRoot = new Map<string, Set<string>>();
	for (const provider of parent.keys()) {
		const root = find(provider);
		const existing = groupsByRoot.get(root);
		if (existing !== undefined) {
			existing.add(provider);
		} else {
			groupsByRoot.set(root, new Set([provider]));
		}
	}

	// Return only groups with more than one provider (actual conflicts)
	return [...groupsByRoot.values()].filter((g) => g.size > 1);
}

function generateCollisionPrefixedIds(
	models: readonly Model<Api>[],
	prefixes: Readonly<Record<string, string>>,
): Map<Model<Api>, string> {
	const conflictGroups = findConflictGroups(models);
	const prefixedProviders = new Set<string>();
	for (const group of conflictGroups) {
		for (const provider of group) {
			prefixedProviders.add(provider);
		}
	}

	const result = new Map<Model<Api>, string>();
	for (const m of models) {
		if (prefixedProviders.has(m.provider)) {
			const prefix = getPublicPrefix(m.provider, prefixes);
			result.set(m, `${prefix}/${m.id}`);
		} else {
			result.set(m, m.id);
		}
	}
	return result;
}

function generateUniversalIds(models: readonly Model<Api>[]): Map<Model<Api>, string> | string {
	// Check for duplicates
	const seen = new Map<string, string>();
	for (const m of models) {
		const existing = seen.get(m.id);
		if (existing !== undefined) {
			return (
				`Universal mode conflict: model ID '${m.id}' is provided by both ` +
				`'${existing}' and '${m.provider}'. Use 'collision-prefixed' or ` +
				`'always-prefixed' mode, or reduce the exposed model set.`
			);
		}
		seen.set(m.id, m.provider);
	}

	const result = new Map<Model<Api>, string>();
	for (const m of models) {
		result.set(m, m.id);
	}
	return result;
}

function generateAlwaysPrefixedIds(
	models: readonly Model<Api>[],
	prefixes: Readonly<Record<string, string>>,
): Map<Model<Api>, string> {
	const result = new Map<Model<Api>, string>();
	for (const m of models) {
		const prefix = getPublicPrefix(m.provider, prefixes);
		result.set(m, `${prefix}/${m.id}`);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePrefixUniqueness(
	models: readonly Model<Api>[],
	prefixes: Readonly<Record<string, string>>,
	mode: PublicModelIdMode,
): string | undefined {
	if (mode === "universal") return undefined;

	// Collect providers that will use prefixes
	const providers = new Set<string>();
	if (mode === "always-prefixed") {
		for (const m of models) {
			providers.add(m.provider);
		}
	} else {
		// collision-prefixed: only conflicting providers get prefixed
		const conflictGroups = findConflictGroups(models);
		for (const group of conflictGroups) {
			for (const provider of group) {
				providers.add(provider);
			}
		}
	}

	// Check that resolved prefix labels are unique
	const labelToProvider = new Map<string, string>();
	for (const provider of providers) {
		const label = getPublicPrefix(provider, prefixes);
		const existing = labelToProvider.get(label);
		if (existing !== undefined) {
			return (
				`Duplicate prefix label '${label}' used by providers ` +
				`'${existing}' and '${provider}'. Configure distinct providerPrefixes.`
			);
		}
		labelToProvider.set(label, provider);
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the full model-exposure result from config and available models.
 *
 * @param available - Models with auth configured (pi's getAvailable())
 * @param allRegistered - All registered models regardless of auth (pi's getAll())
 * @param config - Model exposure configuration
 *
 * Call this at startup and whenever config or the model registry changes.
 */
export function computeModelExposure(
	available: readonly Model<Api>[],
	allRegistered: readonly Model<Api>[],
	config: ModelExposureConfig,
): ModelExposureOutcome {
	// 1. Filter to exposed set
	const exposed = filterExposedModels(available, allRegistered, config);

	// 2. Validate prefix uniqueness (before generating IDs)
	const prefixError = validatePrefixUniqueness(
		exposed,
		config.providerPrefixes,
		config.publicModelIdMode,
	);
	if (prefixError !== undefined) {
		return { ok: false, message: prefixError };
	}

	// 3. Generate public IDs based on mode
	let idMap: Map<Model<Api>, string>;

	switch (config.publicModelIdMode) {
		case "collision-prefixed":
			idMap = generateCollisionPrefixedIds(exposed, config.providerPrefixes);
			break;

		case "universal": {
			const result = generateUniversalIds(exposed);
			if (typeof result === "string") {
				return { ok: false, message: result };
			}
			idMap = result;
			break;
		}

		case "always-prefixed":
			idMap = generateAlwaysPrefixedIds(exposed, config.providerPrefixes);
			break;
	}

	// 4. Build exposed model objects and lookup maps
	const models: ExposedModel[] = [];
	const byPublicId = new Map<string, ExposedModel>();
	const byCanonicalId = new Map<string, ExposedModel>();

	for (const m of exposed) {
		const publicId = idMap.get(m);
		if (publicId === undefined) continue;

		const canonicalId = `${m.provider}/${m.id}`;
		const entry: ExposedModel = {
			publicId,
			canonicalId,
			model: m,
			provider: m.provider,
		};

		models.push(entry);
		byPublicId.set(publicId, entry);
		byCanonicalId.set(canonicalId, entry);
	}

	return { ok: true, models, byPublicId, byCanonicalId };
}

/**
 * Resolve a model ID from an incoming request against the exposure result.
 *
 * Resolution order:
 *   1. Exact public ID match
 *   2. Exact canonical ID match (backward compat, only if model is exposed)
 */
export function resolveExposedModel(
	exposure: ModelExposureResult,
	requestModelId: string,
): ExposedModel | undefined {
	// 1. Try exact public ID
	const byPublic = exposure.byPublicId.get(requestModelId);
	if (byPublic !== undefined) return byPublic;

	// 2. Try canonical ID fallback (only for exposed models)
	return exposure.byCanonicalId.get(requestModelId);
}
