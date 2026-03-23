import { describe, expect, test } from "bun:test";
import { encodeDone, encodeSSE } from "@proxy/openai/sse.js";

describe("encodeSSE", () => {
	test("encodes a chunk as SSE data frame", () => {
		const chunk = {
			id: "req-1",
			object: "chat.completion.chunk" as const,
			created: 1234567890,
			model: "openai/gpt-4o",
			choices: [
				{
					index: 0,
					delta: { role: "assistant" as const },
					finish_reason: null,
				},
			],
		};

		const result = encodeSSE(chunk);
		expect(result).toStartWith("data: ");
		expect(result).toEndWith("\n\n");

		const parsed = JSON.parse(result.slice(6));
		expect(parsed.id).toBe("req-1");
		expect(parsed.object).toBe("chat.completion.chunk");
		expect(parsed.choices[0].delta.role).toBe("assistant");
	});
});

describe("encodeDone", () => {
	test("returns [DONE] sentinel", () => {
		expect(encodeDone()).toBe("data: [DONE]\n\n");
	});
});
