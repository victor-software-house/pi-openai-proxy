import { describe, expect, test } from "bun:test";
import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai";
import { buildChatCompletion, mapFinishReason, mapUsage } from "../../src/openai/responses.js";

describe("mapFinishReason", () => {
	const cases: [StopReason, string][] = [
		["stop", "stop"],
		["length", "length"],
		["toolUse", "tool_calls"],
		["error", "stop"],
		["aborted", "stop"],
	];

	for (const [piReason, expected] of cases) {
		test(`maps '${piReason}' -> '${expected}'`, () => {
			expect(mapFinishReason(piReason)).toBe(expected);
		});
	}
});

describe("mapUsage", () => {
	test("maps pi usage to OpenAI usage", () => {
		const piUsage = {
			input: 100,
			output: 50,
			cacheRead: 10,
			cacheWrite: 5,
			totalTokens: 165,
			cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.0033 },
		};
		const result = mapUsage(piUsage);
		expect(result.prompt_tokens).toBe(100);
		expect(result.completion_tokens).toBe(50);
		expect(result.total_tokens).toBe(165);
	});
});

describe("buildChatCompletion", () => {
	test("builds a valid non-streaming response", () => {
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "Hello there!" }],
			api: "openai-completions",
			provider: "openai",
			model: "gpt-4o",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		const result = buildChatCompletion("req-123", "openai/gpt-4o", message);
		expect(result.id).toBe("req-123");
		expect(result.object).toBe("chat.completion");
		expect(result.model).toBe("openai/gpt-4o");
		expect(result.choices).toHaveLength(1);

		const choice = result.choices[0];
		expect(choice?.message.role).toBe("assistant");
		expect(choice?.message.content).toBe("Hello there!");
		expect(choice?.message.tool_calls).toBeUndefined();
		expect(choice?.finish_reason).toBe("stop");

		expect(result.usage.prompt_tokens).toBe(10);
		expect(result.usage.completion_tokens).toBe(5);
		expect(result.usage.total_tokens).toBe(15);
	});

	test("builds response with tool calls", () => {
		const message: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "tc_1",
					name: "get_weather",
					arguments: { city: "SF" },
				},
			],
			api: "openai-completions",
			provider: "openai",
			model: "gpt-4o",
			usage: {
				input: 10,
				output: 20,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 30,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		};

		const result = buildChatCompletion("req-456", "openai/gpt-4o", message);
		expect(result.choices[0]?.finish_reason).toBe("tool_calls");
		expect(result.choices[0]?.message.content).toBeNull();
		expect(result.choices[0]?.message.tool_calls).toHaveLength(1);

		const tc = result.choices[0]?.message.tool_calls?.[0];
		expect(tc?.id).toBe("tc_1");
		expect(tc?.type).toBe("function");
		expect(tc?.function.name).toBe("get_weather");
		expect(tc?.function.arguments).toBe('{"city":"SF"}');
	});
});
