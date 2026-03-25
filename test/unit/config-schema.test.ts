/**
 * Unit tests for config/schema.ts normalization.
 *
 * Validates that normalizeConfig handles malformed JSON, missing fields,
 * type coercion, and produces valid defaults.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig } from "@proxy/config/schema";

describe("normalizeConfig", () => {
	test("returns defaults for null input", () => {
		const result = normalizeConfig(null);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	test("returns defaults for undefined input", () => {
		const result = normalizeConfig(undefined);
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	test("returns defaults for non-object input", () => {
		expect(normalizeConfig("string")).toEqual(DEFAULT_CONFIG);
		expect(normalizeConfig(42)).toEqual(DEFAULT_CONFIG);
		expect(normalizeConfig(true)).toEqual(DEFAULT_CONFIG);
		expect(normalizeConfig([])).toEqual(DEFAULT_CONFIG);
	});

	test("returns defaults for empty object", () => {
		const result = normalizeConfig({});
		expect(result).toEqual(DEFAULT_CONFIG);
	});

	test("preserves valid host", () => {
		const result = normalizeConfig({ host: "0.0.0.0" });
		expect(result.host).toBe("0.0.0.0");
	});

	test("falls back to default for non-string host", () => {
		const result = normalizeConfig({ host: 123 });
		expect(result.host).toBe(DEFAULT_CONFIG.host);
	});

	test("preserves valid port", () => {
		const result = normalizeConfig({ port: 8080 });
		expect(result.port).toBe(8080);
	});

	test("falls back to default for non-number port", () => {
		const result = normalizeConfig({ port: "not-a-number" });
		expect(result.port).toBe(DEFAULT_CONFIG.port);
	});

	test("clamps negative port to minimum (1)", () => {
		const result = normalizeConfig({ port: -1 });
		expect(result.port).toBe(1);
	});

	test("clamps excessive port to maximum (65535)", () => {
		const result = normalizeConfig({ port: 99999 });
		expect(result.port).toBe(65535);
	});

	test("preserves valid lifetime values", () => {
		expect(normalizeConfig({ lifetime: "detached" }).lifetime).toBe("detached");
		expect(normalizeConfig({ lifetime: "session" }).lifetime).toBe("session");
	});

	test("falls back to default for invalid lifetime", () => {
		const result = normalizeConfig({ lifetime: "unknown" });
		expect(result.lifetime).toBe(DEFAULT_CONFIG.lifetime);
	});

	test("preserves valid authToken", () => {
		const result = normalizeConfig({ authToken: "my-secret" });
		expect(result.authToken).toBe("my-secret");
	});

	test("falls back to empty string for non-string authToken", () => {
		const result = normalizeConfig({ authToken: 123 });
		expect(result.authToken).toBe("");
	});

	test("preserves valid remoteImages boolean", () => {
		expect(normalizeConfig({ remoteImages: true }).remoteImages).toBe(true);
		expect(normalizeConfig({ remoteImages: false }).remoteImages).toBe(false);
	});

	test("falls back to default for non-boolean remoteImages", () => {
		const result = normalizeConfig({ remoteImages: "yes" });
		expect(result.remoteImages).toBe(DEFAULT_CONFIG.remoteImages);
	});

	// --- Model exposure fields ---

	test("preserves valid publicModelIdMode", () => {
		expect(normalizeConfig({ publicModelIdMode: "collision-prefixed" }).publicModelIdMode).toBe(
			"collision-prefixed",
		);
		expect(normalizeConfig({ publicModelIdMode: "universal" }).publicModelIdMode).toBe("universal");
		expect(normalizeConfig({ publicModelIdMode: "always-prefixed" }).publicModelIdMode).toBe(
			"always-prefixed",
		);
	});

	test("falls back to default for invalid publicModelIdMode", () => {
		const result = normalizeConfig({ publicModelIdMode: "invalid" });
		expect(result.publicModelIdMode).toBe(DEFAULT_CONFIG.publicModelIdMode);
	});

	test("preserves valid modelExposureMode", () => {
		expect(normalizeConfig({ modelExposureMode: "all" }).modelExposureMode).toBe("all");
		expect(normalizeConfig({ modelExposureMode: "scoped" }).modelExposureMode).toBe("scoped");
		expect(normalizeConfig({ modelExposureMode: "custom" }).modelExposureMode).toBe("custom");
	});

	test("falls back to default for invalid modelExposureMode", () => {
		const result = normalizeConfig({ modelExposureMode: "invalid" });
		expect(result.modelExposureMode).toBe(DEFAULT_CONFIG.modelExposureMode);
	});

	test("normalizes scopedProviders from array", () => {
		const result = normalizeConfig({ scopedProviders: ["openai", "anthropic"] });
		expect(result.scopedProviders).toEqual(["openai", "anthropic"]);
	});

	test("filters non-string items from scopedProviders", () => {
		const result = normalizeConfig({ scopedProviders: ["openai", 123, null, "anthropic", ""] });
		expect(result.scopedProviders).toEqual(["openai", "anthropic"]);
	});

	test("returns empty array for non-array scopedProviders", () => {
		expect(normalizeConfig({ scopedProviders: "not-array" }).scopedProviders).toEqual([]);
		expect(normalizeConfig({ scopedProviders: 42 }).scopedProviders).toEqual([]);
	});

	test("normalizes customModels from array", () => {
		const result = normalizeConfig({ customModels: ["openai/gpt-4o", "anthropic/claude"] });
		expect(result.customModels).toEqual(["openai/gpt-4o", "anthropic/claude"]);
	});

	test("normalizes providerPrefixes from record", () => {
		const result = normalizeConfig({ providerPrefixes: { openai: "oai", anthropic: "ant" } });
		expect(result.providerPrefixes).toEqual({ openai: "oai", anthropic: "ant" });
	});

	test("filters non-string values from providerPrefixes", () => {
		const result = normalizeConfig({ providerPrefixes: { openai: "oai", bad: 123, also: null } });
		expect(result.providerPrefixes).toEqual({ openai: "oai" });
	});

	test("returns empty record for non-object providerPrefixes", () => {
		expect(normalizeConfig({ providerPrefixes: "not-object" }).providerPrefixes).toEqual({});
	});

	test("preserves all fields from a complete valid config", () => {
		const full = {
			host: "0.0.0.0",
			port: 9090,
			lifetime: "session",
			authToken: "tok",
			remoteImages: true,
			maxBodySizeMb: 100,
			upstreamTimeoutSec: 300,
			publicModelIdMode: "always-prefixed",
			modelExposureMode: "custom",
			scopedProviders: ["openai"],
			customModels: ["openai/gpt-4o"],
			providerPrefixes: { openai: "oai" },
		};
		const result = normalizeConfig(full);
		expect(result.host).toBe("0.0.0.0");
		expect(result.port).toBe(9090);
		expect(result.lifetime).toBe("session");
		expect(result.authToken).toBe("tok");
		expect(result.remoteImages).toBe(true);
		expect(result.maxBodySizeMb).toBe(100);
		expect(result.upstreamTimeoutSec).toBe(300);
		expect(result.publicModelIdMode).toBe("always-prefixed");
		expect(result.modelExposureMode).toBe("custom");
		expect(result.scopedProviders).toEqual(["openai"]);
		expect(result.customModels).toEqual(["openai/gpt-4o"]);
		expect(result.providerPrefixes).toEqual({ openai: "oai" });
	});
});
