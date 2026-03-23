import { describe, expect, test } from "bun:test";
import type { AssistantMessage, AssistantMessageEvent } from "@mariozechner/pi-ai";
import { encodeDone, encodeSSE, streamToSSE } from "@proxy/openai/sse.js";

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

function makeErrorMessage(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5.4-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

async function* yieldEvents(
	events: AssistantMessageEvent[],
): AsyncGenerator<AssistantMessageEvent> {
	for (const e of events) yield e;
}

describe("streamToSSE", () => {
	test("emits error frame instead of stop for upstream error events", async () => {
		const errorMsg = makeErrorMessage("No API key for provider: openai");
		const events: AssistantMessageEvent[] = [{ type: "error", reason: "error", error: errorMsg }];

		const frames: string[] = [];
		for await (const frame of streamToSSE(
			yieldEvents(events),
			"req-1",
			"openai/gpt-5.4-mini",
			false,
		)) {
			frames.push(frame);
		}

		// Should have error data frame + [DONE]
		expect(frames).toHaveLength(2);
		expect(frames[0]).toStartWith("data: ");
		expect(frames[1]).toBe("data: [DONE]\n\n");

		// Error frame should contain the error message
		const errorData = JSON.parse(frames[0]?.slice(6) ?? "");
		expect(errorData.error.message).toBe("No API key for provider: openai");
		expect(errorData.error.type).toBe("server_error");
	});

	test("emits normal stop for successful done events", async () => {
		const doneMsg = makeErrorMessage("");
		doneMsg.stopReason = "stop";
		const events: AssistantMessageEvent[] = [
			{ type: "start", partial: doneMsg },
			{ type: "done", reason: "stop", message: doneMsg },
		];

		const frames: string[] = [];
		for await (const frame of streamToSSE(yieldEvents(events), "req-1", "test/model", false)) {
			frames.push(frame);
		}

		// start chunk + finish chunk + [DONE]
		expect(frames).toHaveLength(3);
		const finishFrame = JSON.parse(frames[1]?.slice(6) ?? "");
		expect(finishFrame.choices[0].finish_reason).toBe("stop");
	});
});
