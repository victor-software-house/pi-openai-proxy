/**
 * Unit tests for the model-exposure engine.
 *
 * Tests cover:
 * - Exposure filtering: all, scoped, custom
 * - Public ID generation: collision-prefixed, universal, always-prefixed
 * - Provider conflict groups (connected components)
 * - Prefix uniqueness validation
 * - Universal mode collision detection
 * - Resolution: public ID, canonical fallback, hidden model rejection
 */

import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelExposureConfig } from "@proxy/openai/model-exposure";
import { computeModelExposure, resolveExposedModel } from "@proxy/openai/model-exposure";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeModel(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: `https://${provider}.example.com`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function defaultConfig(overrides: Partial<ModelExposureConfig> = {}): ModelExposureConfig {
	return {
		publicModelIdMode: "collision-prefixed",
		modelExposureMode: "all",
		scopedProviders: [],
		customModels: [],
		providerPrefixes: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Exposure filtering
// ---------------------------------------------------------------------------

describe("exposure filtering", () => {
	const models = [
		makeModel("openai", "gpt-4o"),
		makeModel("openai", "gpt-4o-mini"),
		makeModel("anthropic", "claude-sonnet-4-20250514"),
		makeModel("google", "gemini-2.5-pro"),
	];

	test("all mode exposes every model", () => {
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.models.length).toBe(4);
	});

	test("scoped mode exposes only selected providers", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({ modelExposureMode: "scoped", scopedProviders: ["openai"] }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.models.length).toBe(2);
		expect(result.models.every((m) => m.provider === "openai")).toBe(true);
	});

	test("scoped mode with multiple providers", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({
				modelExposureMode: "scoped",
				scopedProviders: ["openai", "google"],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.models.length).toBe(3);
	});

	test("custom mode exposes only allowlisted canonical IDs", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({
				modelExposureMode: "custom",
				customModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514"],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.models.length).toBe(2);
		const ids = result.models.map((m) => m.canonicalId);
		expect(ids).toContain("openai/gpt-4o");
		expect(ids).toContain("anthropic/claude-sonnet-4-20250514");
	});

	test("custom mode ignores non-existent canonical IDs", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({
				modelExposureMode: "custom",
				customModels: ["openai/gpt-4o", "fake/nonexistent"],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.models.length).toBe(1);
	});

	test("empty available models produces empty exposure", () => {
		const result = computeModelExposure([], defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.models.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Public ID modes -- no collisions
// ---------------------------------------------------------------------------

describe("public ID modes -- no collisions", () => {
	const models = [
		makeModel("openai", "gpt-4o"),
		makeModel("anthropic", "claude-sonnet-4-20250514"),
		makeModel("google", "gemini-2.5-pro"),
	];

	test("collision-prefixed uses raw IDs when no collisions", () => {
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		expect(publicIds).toContain("gpt-4o");
		expect(publicIds).toContain("claude-sonnet-4-20250514");
		expect(publicIds).toContain("gemini-2.5-pro");
	});

	test("universal uses raw IDs when no collisions", () => {
		const result = computeModelExposure(models, defaultConfig({ publicModelIdMode: "universal" }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		expect(publicIds).toContain("gpt-4o");
		expect(publicIds).toContain("claude-sonnet-4-20250514");
	});

	test("always-prefixed uses provider/model-id for all", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({ publicModelIdMode: "always-prefixed" }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		expect(publicIds).toContain("openai/gpt-4o");
		expect(publicIds).toContain("anthropic/claude-sonnet-4-20250514");
		expect(publicIds).toContain("google/gemini-2.5-pro");
	});
});

// ---------------------------------------------------------------------------
// Public ID modes -- with collisions
// ---------------------------------------------------------------------------

describe("public ID modes -- with collisions", () => {
	const models = [
		makeModel("openai", "gpt-4o"),
		makeModel("openai", "gpt-4o-mini"),
		makeModel("codex", "gpt-4o"), // collides with openai
		makeModel("codex", "codex-unique"),
		makeModel("anthropic", "claude-sonnet-4-20250514"),
		makeModel("google", "gemini-2.5-pro"),
	];

	test("collision-prefixed prefixes all models in conflict group", () => {
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		// openai and codex collide on "gpt-4o", so ALL their models get prefixed
		expect(publicIds).toContain("openai/gpt-4o");
		expect(publicIds).toContain("openai/gpt-4o-mini");
		expect(publicIds).toContain("codex/gpt-4o");
		expect(publicIds).toContain("codex/codex-unique");
		// anthropic and google have no collisions, so raw IDs
		expect(publicIds).toContain("claude-sonnet-4-20250514");
		expect(publicIds).toContain("gemini-2.5-pro");
	});

	test("universal mode fails on collision", () => {
		const result = computeModelExposure(models, defaultConfig({ publicModelIdMode: "universal" }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("gpt-4o");
		expect(result.message).toContain("openai");
		expect(result.message).toContain("codex");
	});

	test("always-prefixed works despite collisions", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({ publicModelIdMode: "always-prefixed" }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		expect(publicIds).toContain("openai/gpt-4o");
		expect(publicIds).toContain("codex/gpt-4o");
	});
});

// ---------------------------------------------------------------------------
// Connected conflict groups (transitive closure)
// ---------------------------------------------------------------------------

describe("connected conflict groups", () => {
	test("transitive conflict: A-B collide, B-C collide -> all three prefixed", () => {
		const models = [
			makeModel("provA", "shared-ab"),
			makeModel("provB", "shared-ab"), // A-B collide
			makeModel("provB", "shared-bc"),
			makeModel("provC", "shared-bc"), // B-C collide
			makeModel("provC", "unique-c"),
			makeModel("provD", "unique-d"), // no collision
		];

		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		// A, B, C form one connected group -- all prefixed
		expect(publicIds).toContain("provA/shared-ab");
		expect(publicIds).toContain("provB/shared-ab");
		expect(publicIds).toContain("provB/shared-bc");
		expect(publicIds).toContain("provC/shared-bc");
		expect(publicIds).toContain("provC/unique-c");
		// D has no collisions -- raw ID
		expect(publicIds).toContain("unique-d");
	});
});

// ---------------------------------------------------------------------------
// Provider prefix overrides
// ---------------------------------------------------------------------------

describe("provider prefix overrides", () => {
	const models = [
		makeModel("openai", "gpt-4o"),
		makeModel("codex", "gpt-4o"),
		makeModel("anthropic", "claude-sonnet-4-20250514"),
	];

	test("collision-prefixed uses custom prefix labels", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({ providerPrefixes: { openai: "oai", codex: "cx" } }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		expect(publicIds).toContain("oai/gpt-4o");
		expect(publicIds).toContain("cx/gpt-4o");
		// anthropic not in conflict group, so raw ID
		expect(publicIds).toContain("claude-sonnet-4-20250514");
	});

	test("always-prefixed uses custom prefix labels", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({
				publicModelIdMode: "always-prefixed",
				providerPrefixes: { anthropic: "claude" },
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		expect(publicIds).toContain("openai/gpt-4o"); // no override -> provider key
		expect(publicIds).toContain("claude/claude-sonnet-4-20250514"); // override
	});
});

// ---------------------------------------------------------------------------
// Prefix uniqueness validation
// ---------------------------------------------------------------------------

describe("prefix uniqueness validation", () => {
	test("duplicate prefix labels fail in collision-prefixed mode", () => {
		const models = [makeModel("openai", "gpt-4o"), makeModel("codex", "gpt-4o")];
		const result = computeModelExposure(
			models,
			defaultConfig({ providerPrefixes: { openai: "same", codex: "same" } }),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("same");
		expect(result.message).toContain("Duplicate prefix label");
	});

	test("duplicate prefix labels fail in always-prefixed mode", () => {
		const models = [makeModel("openai", "gpt-4o"), makeModel("anthropic", "claude")];
		const result = computeModelExposure(
			models,
			defaultConfig({
				publicModelIdMode: "always-prefixed",
				providerPrefixes: { openai: "dup", anthropic: "dup" },
			}),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("Duplicate prefix label");
	});

	test("no error when non-conflicting providers share prefix labels in collision-prefixed", () => {
		// If providers don't collide, they don't get prefixed, so no prefix conflict
		const models = [makeModel("openai", "gpt-4o"), makeModel("anthropic", "claude")];
		const result = computeModelExposure(
			models,
			defaultConfig({ providerPrefixes: { openai: "same", anthropic: "same" } }),
		);
		// No collision -> no prefixing -> no prefix uniqueness issue
		expect(result.ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

describe("resolveExposedModel", () => {
	const models = [
		makeModel("openai", "gpt-4o"),
		makeModel("openai", "gpt-4o-mini"),
		makeModel("codex", "gpt-4o"),
		makeModel("anthropic", "claude-sonnet-4-20250514"),
	];

	test("resolves by public ID", () => {
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// openai/codex collide -> prefixed
		const resolved = resolveExposedModel(result, "openai/gpt-4o");
		expect(resolved).toBeDefined();
		expect(resolved?.model.provider).toBe("openai");
		expect(resolved?.model.id).toBe("gpt-4o");
	});

	test("resolves unprefixed public ID for non-conflicting provider", () => {
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const resolved = resolveExposedModel(result, "claude-sonnet-4-20250514");
		expect(resolved).toBeDefined();
		expect(resolved?.model.provider).toBe("anthropic");
	});

	test("resolves by canonical ID fallback for exposed models", () => {
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// canonical ID should still work as fallback
		const resolved = resolveExposedModel(result, "anthropic/claude-sonnet-4-20250514");
		expect(resolved).toBeDefined();
		expect(resolved?.model.provider).toBe("anthropic");
	});

	test("hidden models are not reachable via canonical fallback", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({
				modelExposureMode: "scoped",
				scopedProviders: ["openai"],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// anthropic is hidden -- should not resolve by canonical ID
		const resolved = resolveExposedModel(result, "anthropic/claude-sonnet-4-20250514");
		expect(resolved).toBeUndefined();
	});

	test("hidden models are not reachable via raw ID", () => {
		const result = computeModelExposure(
			models,
			defaultConfig({
				modelExposureMode: "scoped",
				scopedProviders: ["openai"],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const resolved = resolveExposedModel(result, "claude-sonnet-4-20250514");
		expect(resolved).toBeUndefined();
	});

	test("returns undefined for completely unknown model", () => {
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const resolved = resolveExposedModel(result, "nonexistent");
		expect(resolved).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Universal mode validation
// ---------------------------------------------------------------------------

describe("universal mode validation", () => {
	test("rejects duplicate raw model IDs", () => {
		const models = [makeModel("openai", "gpt-4o"), makeModel("codex", "gpt-4o")];
		const result = computeModelExposure(models, defaultConfig({ publicModelIdMode: "universal" }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("Universal mode conflict");
		expect(result.message).toContain("gpt-4o");
	});

	test("succeeds when scoped exposure removes collisions", () => {
		const models = [
			makeModel("openai", "gpt-4o"),
			makeModel("codex", "gpt-4o"),
			makeModel("anthropic", "claude"),
		];
		const result = computeModelExposure(
			models,
			defaultConfig({
				publicModelIdMode: "universal",
				modelExposureMode: "scoped",
				scopedProviders: ["openai", "anthropic"],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const publicIds = result.models.map((m) => m.publicId);
		expect(publicIds).toContain("gpt-4o");
		expect(publicIds).toContain("claude");
		expect(publicIds.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("model with nested slashes in ID (openrouter-style)", () => {
		const models = [makeModel("openrouter", "anthropic/claude-sonnet-4-20250514")];
		const result = computeModelExposure(
			models,
			defaultConfig({ publicModelIdMode: "always-prefixed" }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.models[0]?.publicId).toBe("openrouter/anthropic/claude-sonnet-4-20250514");
		expect(result.models[0]?.canonicalId).toBe("openrouter/anthropic/claude-sonnet-4-20250514");
	});

	test("canonical fallback works for prefixed models", () => {
		const models = [makeModel("openai", "gpt-4o"), makeModel("codex", "gpt-4o")];
		const result = computeModelExposure(models, defaultConfig());
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Public IDs are openai/gpt-4o and codex/gpt-4o
		// Canonical IDs are the same in this case
		const resolved = resolveExposedModel(result, "openai/gpt-4o");
		expect(resolved).toBeDefined();
		expect(resolved?.model.provider).toBe("openai");

		const resolved2 = resolveExposedModel(result, "codex/gpt-4o");
		expect(resolved2).toBeDefined();
		expect(resolved2?.model.provider).toBe("codex");
	});

	test("single model from single provider works in all modes", () => {
		const models = [makeModel("openai", "gpt-4o")];

		for (const mode of ["collision-prefixed", "universal", "always-prefixed"] as const) {
			const result = computeModelExposure(models, defaultConfig({ publicModelIdMode: mode }));
			expect(result.ok).toBe(true);
			if (!result.ok) continue;
			expect(result.models.length).toBe(1);
		}
	});
});
