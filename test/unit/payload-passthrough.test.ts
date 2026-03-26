/**
 * Unit tests for onPayload passthrough logic in pi/complete.ts.
 *
 * Tests API-aware field translation:
 * - OpenAI-compatible: flat field injection
 * - Anthropic: translated field names/formats
 * - Google: nested generationConfig patching
 * - Tool strict flag patching
 */

import { describe, expect, test } from "bun:test";
import type { ChatCompletionRequest, OpenAIFunctionTool } from "@proxy/openai/schemas";
import {
	applyToolStrictFlags,
	collectAnthropicPayloadFields,
	collectPayloadFields,
	collectToolStrictFlags,
	patchGooglePayload,
	translateToolChoiceForAnthropic,
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

	test("skips passthrough for unsupported APIs", () => {
		const unsupportedApis = ["bedrock-converse-stream", "some-unknown-api"];
		for (const api of unsupportedApis) {
			const fields = collectPayloadFields(
				minimalRequest({ tool_choice: "required", top_p: 0.9, seed: 42 }),
				api,
			);
			expect(fields).toBeUndefined();
		}
	});

	test("dispatches to Anthropic translator for anthropic-messages", () => {
		const fields = collectPayloadFields(
			minimalRequest({ tool_choice: "required" }),
			"anthropic-messages",
		);
		expect(fields).toBeDefined();
		// Anthropic format: "required" -> { type: "any" }
		expect(fields?.["tool_choice"]).toEqual({ type: "any" });
	});

	test("returns undefined for Google APIs (uses nested patching)", () => {
		const googleApis = ["google-generative-ai", "google-gemini-cli", "google-vertex"];
		for (const api of googleApis) {
			const fields = collectPayloadFields(minimalRequest({ tool_choice: "auto", top_p: 0.9 }), api);
			expect(fields).toBeUndefined();
		}
	});

	test("allows full passthrough for OpenAI-compatible APIs", () => {
		const compatibleApis = [
			"openai-completions",
			"openai-responses",
			"azure-openai-responses",
			"mistral-conversations",
		];
		for (const api of compatibleApis) {
			const fields = collectPayloadFields(
				minimalRequest({ tool_choice: "auto", top_p: 0.9, seed: 42 }),
				api,
			);
			expect(fields).toBeDefined();
			expect(fields?.["tool_choice"]).toBe("auto");
			expect(fields?.["top_p"]).toBe(0.9);
			expect(fields?.["seed"]).toBe(42);
		}
	});

	test("codex-responses only passes tool_choice and parallel_tool_calls", () => {
		const fields = collectPayloadFields(
			minimalRequest({
				tool_choice: "required",
				parallel_tool_calls: false,
				top_p: 0.9,
				seed: 42,
				stop: "END",
				user: "test",
			}),
			"openai-codex-responses",
		);
		expect(fields).toBeDefined();
		expect(fields?.["tool_choice"]).toBe("required");
		expect(fields?.["parallel_tool_calls"]).toBe(false);
		// These should NOT be included for codex
		expect(fields?.["top_p"]).toBeUndefined();
		expect(fields?.["seed"]).toBeUndefined();
		expect(fields?.["stop"]).toBeUndefined();
		expect(fields?.["user"]).toBeUndefined();
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

	test("translates parallel_tool_calls for Anthropic", () => {
		const fields = collectPayloadFields(
			minimalRequest({ parallel_tool_calls: false }),
			"anthropic-messages",
		);
		expect(fields).toBeDefined();
		// Anthropic: parallel_tool_calls: false -> tool_choice.disable_parallel_tool_use: true
		expect(fields?.["tool_choice"]).toEqual({ type: "auto", disable_parallel_tool_use: true });
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

	test("skips arbitrary metadata for Anthropic (only user_id supported)", () => {
		// Anthropic only accepts metadata.user_id, not arbitrary keys
		const fields = collectPayloadFields(
			minimalRequest({ metadata: { task: "test" } }),
			"anthropic-messages",
		);
		// No user field set, so no metadata translation
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

	test("skips prediction for non-OpenAI APIs", () => {
		for (const api of ["bedrock-converse-stream", "anthropic-messages"]) {
			const fields = collectPayloadFields(
				minimalRequest({ prediction: { type: "content", content: "test" } }),
				api,
			);
			// Anthropic returns undefined because prediction isn't a translated field
			// Bedrock returns undefined because it's unsupported
			if (api === "anthropic-messages") {
				// Anthropic will return undefined since only prediction was set (not translated)
				expect(fields).toBeUndefined();
			} else {
				expect(fields).toBeUndefined();
			}
		}
	});
});

// --- Anthropic translation ---

describe("collectAnthropicPayloadFields", () => {
	test("translates top_p (same name, natively supported)", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ top_p: 0.9 }));
		expect(fields).toBeDefined();
		expect(fields?.["top_p"]).toBe(0.9);
	});

	test("translates stop string to stop_sequences array", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ stop: "END" }));
		expect(fields).toBeDefined();
		expect(fields?.["stop_sequences"]).toEqual(["END"]);
	});

	test("translates stop array to stop_sequences", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ stop: ["END", "STOP"] }));
		expect(fields).toBeDefined();
		expect(fields?.["stop_sequences"]).toEqual(["END", "STOP"]);
	});

	test("translates user to metadata.user_id", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ user: "user-123" }));
		expect(fields).toBeDefined();
		expect(fields?.["metadata"]).toEqual({ user_id: "user-123" });
	});

	test("skips seed (not supported by Anthropic)", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ seed: 42 }));
		expect(fields).toBeUndefined();
	});

	test("skips frequency_penalty (not supported by Anthropic)", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ frequency_penalty: 0.5 }));
		expect(fields).toBeUndefined();
	});

	test("skips presence_penalty (not supported by Anthropic)", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ presence_penalty: 0.5 }));
		expect(fields).toBeUndefined();
	});

	test("skips response_format (not supported by Anthropic)", () => {
		const fields = collectAnthropicPayloadFields(
			minimalRequest({ response_format: { type: "json_object" } }),
		);
		expect(fields).toBeUndefined();
	});

	test("skips prediction (not supported by Anthropic)", () => {
		const fields = collectAnthropicPayloadFields(
			minimalRequest({ prediction: { type: "content", content: "test" } }),
		);
		expect(fields).toBeUndefined();
	});

	test("skips arbitrary metadata (Anthropic only accepts user_id)", () => {
		const fields = collectAnthropicPayloadFields(
			minimalRequest({ metadata: { task: "test", chat_id: "abc" } }),
		);
		expect(fields).toBeUndefined();
	});
});

describe("translateToolChoiceForAnthropic", () => {
	test("auto -> { type: auto }", () => {
		expect(translateToolChoiceForAnthropic("auto")).toEqual({ type: "auto" });
	});

	test("none -> { type: none }", () => {
		expect(translateToolChoiceForAnthropic("none")).toEqual({ type: "none" });
	});

	test("required -> { type: any }", () => {
		expect(translateToolChoiceForAnthropic("required")).toEqual({ type: "any" });
	});

	test("named function -> { type: tool, name }", () => {
		const choice = { type: "function" as const, function: { name: "get_weather" } };
		expect(translateToolChoiceForAnthropic(choice)).toEqual({
			type: "tool",
			name: "get_weather",
		});
	});

	test("undefined -> undefined", () => {
		expect(translateToolChoiceForAnthropic(undefined)).toBeUndefined();
	});
});

describe("collectAnthropicPayloadFields: tool_choice + parallel", () => {
	test("tool_choice auto with parallel disabled", () => {
		const fields = collectAnthropicPayloadFields(
			minimalRequest({ tool_choice: "auto", parallel_tool_calls: false }),
		);
		expect(fields?.["tool_choice"]).toEqual({ type: "auto", disable_parallel_tool_use: true });
	});

	test("tool_choice required with parallel disabled", () => {
		const fields = collectAnthropicPayloadFields(
			minimalRequest({ tool_choice: "required", parallel_tool_calls: false }),
		);
		expect(fields?.["tool_choice"]).toEqual({ type: "any", disable_parallel_tool_use: true });
	});

	test("parallel disabled without explicit tool_choice defaults to auto", () => {
		const fields = collectAnthropicPayloadFields(minimalRequest({ parallel_tool_calls: false }));
		expect(fields?.["tool_choice"]).toEqual({ type: "auto", disable_parallel_tool_use: true });
	});

	test("parallel true does not add disable flag", () => {
		const fields = collectAnthropicPayloadFields(
			minimalRequest({ tool_choice: "auto", parallel_tool_calls: true }),
		);
		expect(fields?.["tool_choice"]).toEqual({ type: "auto" });
	});

	test("named function with parallel disabled", () => {
		const fields = collectAnthropicPayloadFields(
			minimalRequest({
				tool_choice: { type: "function", function: { name: "calc" } },
				parallel_tool_calls: false,
			}),
		);
		expect(fields?.["tool_choice"]).toEqual({
			type: "tool",
			name: "calc",
			disable_parallel_tool_use: true,
		});
	});
});

// --- Google nested patching ---

describe("patchGooglePayload", () => {
	/** Build a minimal Google-shaped payload. */
	function googlePayload(genConfig: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			model: "gemini-2.5-flash",
			contents: [],
			config: {
				generationConfig: genConfig,
			},
		};
	}

	test("patches topP into generationConfig", () => {
		const payload = googlePayload();
		const patched = patchGooglePayload(payload, minimalRequest({ top_p: 0.9 }));
		expect(patched).toBe(true);
		const config = payload["config"] as Record<string, unknown>;
		const gen = config["generationConfig"] as Record<string, unknown>;
		expect(gen["topP"]).toBe(0.9);
	});

	test("patches stopSequences from string stop", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ stop: "END" }));
		const config = payload["config"] as Record<string, unknown>;
		const gen = config["generationConfig"] as Record<string, unknown>;
		expect(gen["stopSequences"]).toEqual(["END"]);
	});

	test("patches stopSequences from array stop", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ stop: ["END", "STOP"] }));
		const config = payload["config"] as Record<string, unknown>;
		const gen = config["generationConfig"] as Record<string, unknown>;
		expect(gen["stopSequences"]).toEqual(["END", "STOP"]);
	});

	test("patches seed", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ seed: 42 }));
		const config = payload["config"] as Record<string, unknown>;
		const gen = config["generationConfig"] as Record<string, unknown>;
		expect(gen["seed"]).toBe(42);
	});

	test("patches frequencyPenalty", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ frequency_penalty: 0.5 }));
		const config = payload["config"] as Record<string, unknown>;
		const gen = config["generationConfig"] as Record<string, unknown>;
		expect(gen["frequencyPenalty"]).toBe(0.5);
	});

	test("patches presencePenalty", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ presence_penalty: -0.5 }));
		const config = payload["config"] as Record<string, unknown>;
		const gen = config["generationConfig"] as Record<string, unknown>;
		expect(gen["presencePenalty"]).toBe(-0.5);
	});

	test("patches tool_choice to toolConfig mode AUTO", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ tool_choice: "auto" }));
		const config = payload["config"] as Record<string, unknown>;
		const tc = config["toolConfig"] as Record<string, unknown>;
		const fc = tc["functionCallingConfig"] as Record<string, unknown>;
		expect(fc["mode"]).toBe("AUTO");
	});

	test("patches tool_choice none to NONE", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ tool_choice: "none" }));
		const config = payload["config"] as Record<string, unknown>;
		const tc = config["toolConfig"] as Record<string, unknown>;
		const fc = tc["functionCallingConfig"] as Record<string, unknown>;
		expect(fc["mode"]).toBe("NONE");
	});

	test("patches tool_choice required to ANY", () => {
		const payload = googlePayload();
		patchGooglePayload(payload, minimalRequest({ tool_choice: "required" }));
		const config = payload["config"] as Record<string, unknown>;
		const tc = config["toolConfig"] as Record<string, unknown>;
		const fc = tc["functionCallingConfig"] as Record<string, unknown>;
		expect(fc["mode"]).toBe("ANY");
	});

	test("preserves existing generationConfig fields", () => {
		const payload = googlePayload({ temperature: 0.7 });
		patchGooglePayload(payload, minimalRequest({ top_p: 0.9 }));
		const config = payload["config"] as Record<string, unknown>;
		const gen = config["generationConfig"] as Record<string, unknown>;
		expect(gen["temperature"]).toBe(0.7);
		expect(gen["topP"]).toBe(0.9);
	});

	test("returns false when no fields to patch", () => {
		const payload = googlePayload();
		const patched = patchGooglePayload(payload, minimalRequest());
		expect(patched).toBe(false);
	});

	test("returns false when payload has no config", () => {
		const payload: Record<string, unknown> = { model: "test" };
		const patched = patchGooglePayload(payload, minimalRequest({ top_p: 0.9 }));
		expect(patched).toBe(false);
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
