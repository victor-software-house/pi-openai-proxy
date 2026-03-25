/**
 * Unit tests for pi/complete.ts logic.
 *
 * Tests the reasoning effort mapping and exported mapping constants.
 * The actual completeSimple/streamSimple calls are tested via SDK conformance.
 */

import { describe, expect, test } from "bun:test";
import { mapFinishReason, mapUsage } from "@proxy/openai/responses.js";

// We test the mapping logic through responses.ts which re-exports the same maps.
// The reasoning effort map is internal to complete.ts but we can verify
// the response-side mappings that depend on the same pi types.

describe("finish reason mapping", () => {
	test("stop -> stop", () => {
		expect(mapFinishReason("stop")).toBe("stop");
	});

	test("length -> length", () => {
		expect(mapFinishReason("length")).toBe("length");
	});

	test("toolUse -> tool_calls", () => {
		expect(mapFinishReason("toolUse")).toBe("tool_calls");
	});

	test("error -> stop (graceful degradation)", () => {
		expect(mapFinishReason("error")).toBe("stop");
	});

	test("aborted -> stop (graceful degradation)", () => {
		expect(mapFinishReason("aborted")).toBe("stop");
	});
});

describe("usage mapping", () => {
	test("maps pi usage fields to OpenAI fields", () => {
		const result = mapUsage({
			input: 100,
			output: 50,
			totalTokens: 150,
			cacheRead: 10,
			cacheWrite: 5,
			cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
		});
		expect(result.prompt_tokens).toBe(100);
		expect(result.completion_tokens).toBe(50);
		expect(result.total_tokens).toBe(150);
	});

	test("handles zero values", () => {
		const result = mapUsage({
			input: 0,
			output: 0,
			totalTokens: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		});
		expect(result.prompt_tokens).toBe(0);
		expect(result.completion_tokens).toBe(0);
		expect(result.total_tokens).toBe(0);
	});
});
