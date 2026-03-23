import { describe, expect, test } from "bun:test";
import { parseCanonicalId } from "@proxy/pi/resolve-model.js";

describe("parseCanonicalId", () => {
	test("parses simple provider/model-id", () => {
		const result = parseCanonicalId("openai/gpt-4o");
		expect(result).toEqual({ provider: "openai", modelId: "gpt-4o" });
	});

	test("parses nested slashes (openrouter)", () => {
		const result = parseCanonicalId("openrouter/anthropic/claude-sonnet-4-20250514");
		expect(result).toEqual({
			provider: "openrouter",
			modelId: "anthropic/claude-sonnet-4-20250514",
		});
	});

	test("returns null for shorthand (no slash)", () => {
		const result = parseCanonicalId("gpt-4o");
		expect(result).toBeNull();
	});

	test("handles provider with empty model-id", () => {
		const result = parseCanonicalId("openai/");
		expect(result).toEqual({ provider: "openai", modelId: "" });
	});
});
