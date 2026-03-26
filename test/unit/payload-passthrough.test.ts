/**
 * Unit tests for onPayload passthrough logic in pi/complete.ts.
 *
 * Tests tool_choice forwarding and tool strict flag patching.
 */

import { describe, expect, test } from "bun:test";
import type { ChatCompletionRequest, OpenAIFunctionTool } from "@proxy/openai/schemas";
import {
	applyToolStrictFlags,
	collectPayloadFields,
	collectToolStrictFlags,
} from "@proxy/pi/complete";
import { isRecord } from "@proxy/utils/guards";

/**
 * Narrow a value to Record<string, unknown> with a runtime check.
 * Throws if the value is not an object — test will fail with a clear message.
 */
function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`Expected ${label} to be a record, got ${typeof value}`);
	}
	return value;
}

// --- Helpers ---

/** Minimal valid request for collectPayloadFields tests. */
function minimalRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
	return {
		model: "openai/gpt-4o",
		messages: [{ role: "user", content: "Hello" }],
		...overrides,
	};
}

/** Build an OpenAI function tool definition with optional strict flag. */
function makeTool(name: string, strict?: boolean | null): OpenAIFunctionTool {
	return {
		type: "function",
		function: {
			name,
			description: `Tool ${name}`,
			parameters: { type: "object", properties: {} },
			...(strict !== undefined ? { strict } : {}),
		},
	};
}

// --- collectPayloadFields: tool_choice ---

describe("collectPayloadFields: tool_choice", () => {
	test("includes tool_choice string value in payload fields", () => {
		const fields = collectPayloadFields(
			minimalRequest({ tool_choice: "required" }),
			"openai-completions",
		);
		expect(fields).toBeDefined();
		expect(fields?.["tool_choice"]).toBe("required");
	});

	test("includes tool_choice 'auto' in payload fields", () => {
		const fields = collectPayloadFields(
			minimalRequest({ tool_choice: "auto" }),
			"openai-completions",
		);
		expect(fields).toBeDefined();
		expect(fields?.["tool_choice"]).toBe("auto");
	});

	test("includes tool_choice 'none' in payload fields", () => {
		const fields = collectPayloadFields(
			minimalRequest({ tool_choice: "none" }),
			"openai-completions",
		);
		expect(fields).toBeDefined();
		expect(fields?.["tool_choice"]).toBe("none");
	});

	test("includes named tool_choice in payload fields", () => {
		const namedChoice = {
			type: "function" as const,
			function: { name: "get_weather" },
		};
		const fields = collectPayloadFields(
			minimalRequest({ tool_choice: namedChoice }),
			"openai-completions",
		);
		expect(fields).toBeDefined();
		expect(fields?.["tool_choice"]).toEqual(namedChoice);
	});

	test("omits tool_choice when not provided", () => {
		const fields = collectPayloadFields(minimalRequest(), "openai-completions");
		expect(fields).toBeUndefined();
	});

	test("skips passthrough for non-compatible APIs", () => {
		const nonCompatibleApis = [
			"openai-codex-responses",
			"anthropic-messages",
			"google-generative-ai",
			"google-gemini-cli",
			"google-vertex",
			"bedrock-converse-stream",
		];
		for (const api of nonCompatibleApis) {
			const fields = collectPayloadFields(
				minimalRequest({ tool_choice: "required", top_p: 0.9, seed: 42 }),
				api,
			);
			expect(fields).toBeUndefined();
		}
	});

	test("allows passthrough for OpenAI-compatible APIs", () => {
		const compatibleApis = [
			"openai-completions",
			"openai-responses",
			"azure-openai-responses",
			"mistral-conversations",
		];
		for (const api of compatibleApis) {
			const fields = collectPayloadFields(minimalRequest({ tool_choice: "auto" }), api);
			expect(fields).toBeDefined();
			expect(fields?.["tool_choice"]).toBe("auto");
		}
	});

	test("tool_choice coexists with other passthrough fields", () => {
		const fields = collectPayloadFields(
			minimalRequest({
				tool_choice: "auto",
				top_p: 0.9,
				seed: 42,
			}),
			"openai-completions",
		);
		expect(fields).toBeDefined();
		expect(fields?.["tool_choice"]).toBe("auto");
		expect(fields?.["top_p"]).toBe(0.9);
		expect(fields?.["seed"]).toBe(42);
	});
});

// --- parallel_tool_calls ---

describe("collectPayloadFields: parallel_tool_calls", () => {
	test("includes parallel_tool_calls: false in payload fields", () => {
		const fields = collectPayloadFields(
			minimalRequest({ parallel_tool_calls: false }),
			"openai-completions",
		);
		expect(fields).toBeDefined();
		expect(fields?.["parallel_tool_calls"]).toBe(false);
	});

	test("includes parallel_tool_calls: true in payload fields", () => {
		const fields = collectPayloadFields(
			minimalRequest({ parallel_tool_calls: true }),
			"openai-completions",
		);
		expect(fields).toBeDefined();
		expect(fields?.["parallel_tool_calls"]).toBe(true);
	});

	test("omits parallel_tool_calls when not provided", () => {
		const fields = collectPayloadFields(minimalRequest(), "openai-completions");
		expect(fields).toBeUndefined();
	});

	test("skips parallel_tool_calls for non-compatible APIs", () => {
		const fields = collectPayloadFields(
			minimalRequest({ parallel_tool_calls: false }),
			"anthropic-messages",
		);
		expect(fields).toBeUndefined();
	});
});

// --- metadata ---

describe("collectPayloadFields: metadata", () => {
	test("includes metadata in payload fields", () => {
		const metadata = { task: "autocomplete", chat_id: "abc-123" };
		const fields = collectPayloadFields(minimalRequest({ metadata }), "openai-completions");
		expect(fields).toBeDefined();
		expect(fields?.["metadata"]).toEqual(metadata);
	});

	test("omits metadata when not provided", () => {
		const fields = collectPayloadFields(minimalRequest(), "openai-completions");
		expect(fields).toBeUndefined();
	});

	test("skips metadata for non-compatible APIs", () => {
		const fields = collectPayloadFields(
			minimalRequest({ metadata: { task: "test" } }),
			"google-generative-ai",
		);
		expect(fields).toBeUndefined();
	});
});

// --- prediction ---

describe("collectPayloadFields: prediction", () => {
	test("includes prediction with string content in payload fields", () => {
		const prediction = { type: "content" as const, content: "predicted output" };
		const fields = collectPayloadFields(minimalRequest({ prediction }), "openai-completions");
		expect(fields).toBeDefined();
		expect(fields?.["prediction"]).toEqual(prediction);
	});

	test("includes prediction with array content in payload fields", () => {
		const prediction = {
			type: "content" as const,
			content: [{ type: "text" as const, text: "predicted" }],
		};
		const fields = collectPayloadFields(minimalRequest({ prediction }), "openai-completions");
		expect(fields).toBeDefined();
		expect(fields?.["prediction"]).toEqual(prediction);
	});

	test("omits prediction when not provided", () => {
		const fields = collectPayloadFields(minimalRequest(), "openai-completions");
		expect(fields).toBeUndefined();
	});

	test("skips prediction for non-compatible APIs", () => {
		const fields = collectPayloadFields(
			minimalRequest({ prediction: { type: "content", content: "test" } }),
			"bedrock-converse-stream",
		);
		expect(fields).toBeUndefined();
	});
});

// --- collectToolStrictFlags ---

describe("collectToolStrictFlags", () => {
	test("returns undefined when tools is undefined", () => {
		expect(collectToolStrictFlags(undefined)).toBeUndefined();
	});

	test("returns undefined when tools array is empty", () => {
		expect(collectToolStrictFlags([])).toBeUndefined();
	});

	test("returns undefined when no tools have strict: true", () => {
		const tools = [makeTool("a"), makeTool("b", false), makeTool("c", null)];
		expect(collectToolStrictFlags(tools)).toBeUndefined();
	});

	test("collects strict: true flags by index", () => {
		const tools = [makeTool("a", true), makeTool("b", false), makeTool("c", true)];
		const flags = collectToolStrictFlags(tools);
		expect(flags).toBeDefined();
		expect(flags?.size).toBe(2);
		expect(flags?.get(0)).toBe(true);
		expect(flags?.has(1)).toBe(false);
		expect(flags?.get(2)).toBe(true);
	});

	test("single tool with strict: true", () => {
		const tools = [makeTool("only", true)];
		const flags = collectToolStrictFlags(tools);
		expect(flags).toBeDefined();
		expect(flags?.size).toBe(1);
		expect(flags?.get(0)).toBe(true);
	});

	test("strict: null is not treated as strict: true", () => {
		const tools = [makeTool("a", null)];
		expect(collectToolStrictFlags(tools)).toBeUndefined();
	});

	test("absent strict is not treated as strict: true", () => {
		const tools = [makeTool("a")];
		expect(collectToolStrictFlags(tools)).toBeUndefined();
	});
});

// --- applyToolStrictFlags ---

describe("applyToolStrictFlags", () => {
	test("patches strict: true on matching tool indexes", () => {
		const payload: Record<string, unknown> = {
			tools: [
				{ type: "function", function: { name: "a", strict: false } },
				{ type: "function", function: { name: "b", strict: false } },
				{ type: "function", function: { name: "c", strict: false } },
			],
		};
		const flags = new Map<number, true>([
			[0, true],
			[2, true],
		]);

		applyToolStrictFlags(payload, flags);

		expect(Array.isArray(payload["tools"])).toBe(true);
		const tools = payload["tools"];
		expect(Array.isArray(tools)).toBe(true);
		if (!Array.isArray(tools)) return;
		const fn0 = expectRecord(expectRecord(tools[0], "tool[0]")["function"], "tool[0].function");
		const fn1 = expectRecord(expectRecord(tools[1], "tool[1]")["function"], "tool[1].function");
		const fn2 = expectRecord(expectRecord(tools[2], "tool[2]")["function"], "tool[2].function");
		expect(fn0["strict"]).toBe(true);
		expect(fn1["strict"]).toBe(false);
		expect(fn2["strict"]).toBe(true);
	});

	test("does nothing when payload has no tools array", () => {
		const payload: Record<string, unknown> = { model: "test" };
		const flags = new Map<number, true>([[0, true]]);

		// Should not throw
		applyToolStrictFlags(payload, flags);
		expect(payload["tools"]).toBeUndefined();
	});

	test("does nothing when tools is not an array", () => {
		const payload: Record<string, unknown> = { tools: "not-an-array" };
		const flags = new Map<number, true>([[0, true]]);

		applyToolStrictFlags(payload, flags);
		expect(payload["tools"]).toBe("not-an-array");
	});

	test("handles index beyond tools array length gracefully", () => {
		const payload: Record<string, unknown> = {
			tools: [{ type: "function", function: { name: "a", strict: false } }],
		};
		const flags = new Map<number, true>([
			[0, true],
			[5, true], // beyond array length
		]);

		applyToolStrictFlags(payload, flags);

		expect(Array.isArray(payload["tools"])).toBe(true);
		const tools = payload["tools"];
		if (!Array.isArray(tools)) return;
		const fn0 = expectRecord(expectRecord(tools[0], "tool[0]")["function"], "tool[0].function");
		expect(fn0["strict"]).toBe(true);
		// Index 5 is undefined, no crash
	});

	test("handles tool without function object gracefully", () => {
		const payload: Record<string, unknown> = {
			tools: [{ type: "function" }], // missing function object
		};
		const flags = new Map<number, true>([[0, true]]);

		// Should not throw
		applyToolStrictFlags(payload, flags);
	});
});
