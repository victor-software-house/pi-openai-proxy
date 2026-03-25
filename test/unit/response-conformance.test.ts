/**
 * Non-streaming response conformance tests.
 *
 * Validates that buildChatCompletion() output matches the OpenAI
 * ChatCompletion contract the official SDK expects.
 */

import { describe, expect, test } from "bun:test";
import type { AssistantMessage, TextContent, ToolCall, Usage } from "@mariozechner/pi-ai";
import { buildChatCompletion } from "@proxy/openai/responses.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsage(overrides: Partial<Usage> = {}): Usage {
	return {
		input: 10,
		output: 20,
		totalTokens: 30,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...overrides,
	};
}

/**
 * Build a mock AssistantMessage. Only populates fields used by
 * buildChatCompletion (content, stopReason, usage).
 */
function makeTextMessage(
	text: string,
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	const content: TextContent = { type: "text", text };
	return {
		role: "assistant",
		content: [content],
		stopReason: "stop",
		usage: makeUsage(),
		...overrides,
	} as unknown as AssistantMessage;
}

function makeToolCallMessage(
	calls: { id: string; name: string; args: Record<string, unknown> }[],
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	const content: ToolCall[] = calls.map((c) => ({
		type: "toolCall",
		id: c.id,
		name: c.name,
		arguments: c.args,
	}));
	return {
		role: "assistant",
		content,
		stopReason: "toolUse",
		usage: makeUsage(),
		...overrides,
	} as unknown as AssistantMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("non-streaming response conformance", () => {
	test("has all required top-level fields", () => {
		const result = buildChatCompletion("req-1", "openai/gpt-4o", makeTextMessage("Hello"));

		expect(result.id).toBe("req-1");
		expect(result.object).toBe("chat.completion");
		expect(result.created).toBeNumber();
		expect(result.created).toBeGreaterThan(0);
		expect(result.model).toBe("openai/gpt-4o");
		expect(result.choices).toBeArray();
		expect(result.choices.length).toBe(1);
		expect(result.usage).toBeDefined();
	});

	test("choices[0].finish_reason is never null", () => {
		const result = buildChatCompletion("req-2", "openai/gpt-4o", makeTextMessage("Hi"));

		const choice = result.choices[0];
		expect(choice).toBeDefined();
		expect(choice?.finish_reason).not.toBeNull();
		expect(choice?.finish_reason).toBe("stop");
	});

	test("finish_reason maps correctly for all stop reasons", () => {
		const mapping: [AssistantMessage["stopReason"], string][] = [
			["stop", "stop"],
			["length", "length"],
			["toolUse", "tool_calls"],
			["error", "stop"],
			["aborted", "stop"],
		];

		for (const [piReason, expected] of mapping) {
			const msg = makeTextMessage("test", { stopReason: piReason });
			const result = buildChatCompletion("req", "m", msg);
			expect(result.choices[0]?.finish_reason).toBe(expected);
		}
	});

	test("choices[0].message.role is assistant", () => {
		const result = buildChatCompletion("req-3", "m", makeTextMessage("Hi"));
		expect(result.choices[0]?.message.role).toBe("assistant");
	});

	test("content is string for text responses", () => {
		const result = buildChatCompletion("req-4", "m", makeTextMessage("Hello world"));
		const content = result.choices[0]?.message.content;
		expect(content).toBeString();
		expect(content).toBe("Hello world");
	});

	test("content is null when no text parts exist", () => {
		const msg = makeToolCallMessage([{ id: "tc-1", name: "get_weather", args: { city: "NYC" } }]);
		const result = buildChatCompletion("req-5", "m", msg);
		const content = result.choices[0]?.message.content;
		// Must be explicitly null, not undefined
		expect(content).toBeNull();
	});

	test("tool_calls shape matches OpenAI contract", () => {
		const msg = makeToolCallMessage([
			{ id: "call_abc", name: "get_weather", args: { city: "NYC" } },
			{ id: "call_def", name: "search", args: { query: "hello" } },
		]);
		const result = buildChatCompletion("req-6", "m", msg);
		const toolCalls = result.choices[0]?.message.tool_calls;

		expect(toolCalls).toBeDefined();
		expect(toolCalls?.length).toBe(2);

		const first = toolCalls?.[0];
		expect(first?.id).toBe("call_abc");
		expect(first?.type).toBe("function");
		expect(first?.function.name).toBeString();
		expect(first?.function.name).toBe("get_weather");
		expect(first?.function.arguments).toBeString();
		// arguments must be a JSON string, not an object
		expect(JSON.parse(first?.function.arguments ?? "")).toEqual({ city: "NYC" });
	});

	test("tool_calls is absent (not empty array) when no tool calls", () => {
		const result = buildChatCompletion("req-7", "m", makeTextMessage("Hi"));
		expect(result.choices[0]?.message.tool_calls).toBeUndefined();
	});

	test("usage fields are all numbers", () => {
		const msg = makeTextMessage("Hi", {
			usage: makeUsage({ input: 15, output: 25, totalTokens: 40 }),
		});
		const result = buildChatCompletion("req-8", "m", msg);

		expect(result.usage.prompt_tokens).toBeNumber();
		expect(result.usage.completion_tokens).toBeNumber();
		expect(result.usage.total_tokens).toBeNumber();
		expect(result.usage.prompt_tokens).toBe(15);
		expect(result.usage.completion_tokens).toBe(25);
		expect(result.usage.total_tokens).toBe(40);
	});

	test("choices[0].index is 0", () => {
		const result = buildChatCompletion("req-9", "m", makeTextMessage("Hi"));
		expect(result.choices[0]?.index).toBe(0);
	});
});
