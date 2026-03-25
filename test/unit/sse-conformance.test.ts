/**
 * Wire-level SSE conformance tests.
 *
 * Validates that streamToSSE() output matches the OpenAI ChatCompletionChunk
 * contract the official SDK expects. Uses mock pi events, no credentials needed.
 */

import { describe, expect, test } from "bun:test";
import type { AssistantMessage, AssistantMessageEvent, ToolCall, Usage } from "@mariozechner/pi-ai";
import { encodeDone, streamToSSE } from "@proxy/openai/sse.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsage(): Usage {
	return {
		input: 10,
		output: 20,
		totalTokens: 30,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/**
 * Build a mock partial AssistantMessage. Only populates fields used by
 * streamToSSE (content, stopReason, usage).
 */
function makePartial(content: unknown[] = []): AssistantMessage {
	return {
		role: "assistant",
		content,
		stopReason: "stop",
		usage: makeUsage(),
	} as unknown as AssistantMessage;
}

async function* mockEvents(events: AssistantMessageEvent[]): AsyncGenerator<AssistantMessageEvent> {
	for (const e of events) {
		yield e;
	}
}

async function collectFrames(
	events: AssistantMessageEvent[],
	includeUsage = false,
): Promise<string[]> {
	const frames: string[] = [];
	for await (const frame of streamToSSE(mockEvents(events), "req-1", "test-model", includeUsage)) {
		frames.push(frame);
	}
	return frames;
}

// biome-ignore lint/suspicious/noExplicitAny: test helper for untyped SSE chunk assertions
function parseChunks(frames: string[]): any[] {
	return frames.map((f) => {
		if (!f.startsWith("data: ")) return null;
		const json = f.slice(6).trim();
		if (json === "[DONE]") return "[DONE]";
		return JSON.parse(json);
	});
}

// ---------------------------------------------------------------------------
// Text streaming
// ---------------------------------------------------------------------------

describe("SSE text streaming conformance", () => {
	const textEvents: AssistantMessageEvent[] = [
		{ type: "start", partial: makePartial() },
		{ type: "text_start", contentIndex: 0, partial: makePartial([{ type: "text", text: "" }]) },
		{
			type: "text_delta",
			contentIndex: 0,
			delta: "Hello",
			partial: makePartial([{ type: "text", text: "Hello" }]),
		},
		{
			type: "text_delta",
			contentIndex: 0,
			delta: " world",
			partial: makePartial([{ type: "text", text: "Hello world" }]),
		},
		{
			type: "text_end",
			contentIndex: 0,
			content: "Hello world",
			partial: makePartial([{ type: "text", text: "Hello world" }]),
		},
		{
			type: "done",
			reason: "stop",
			message: { ...makePartial([{ type: "text", text: "Hello world" }]), stopReason: "stop" },
		},
	];

	test("each chunk has required fields: id, object, created, model", async () => {
		const frames = await collectFrames(textEvents);
		const chunks = parseChunks(frames);

		for (const chunk of chunks) {
			if (chunk === "[DONE]" || chunk === null) continue;
			if (chunk.error !== undefined) continue;

			expect(chunk.id).toBe("req-1");
			expect(chunk.object).toBe("chat.completion.chunk");
			expect(typeof chunk.created).toBe("number");
			expect(chunk.created).toBeGreaterThan(0);
			expect(chunk.model).toBe("test-model");
		}
	});

	test("first chunk has delta.role = assistant", async () => {
		const frames = await collectFrames(textEvents);
		const first = parseChunks(frames)[0];
		expect(first.choices[0].delta.role).toBe("assistant");
	});

	test("delta.content is a string on text delta chunks", async () => {
		const frames = await collectFrames(textEvents);
		const chunks = parseChunks(frames);

		const contentChunks = chunks.filter(
			(c) => c !== "[DONE]" && c !== null && c.choices?.[0]?.delta?.content !== undefined,
		);

		expect(contentChunks.length).toBeGreaterThan(0);
		for (const chunk of contentChunks) {
			expect(typeof chunk.choices[0].delta.content).toBe("string");
		}
	});

	test("finish_reason is null on intermediate chunks, set on final", async () => {
		const frames = await collectFrames(textEvents);
		const chunks = parseChunks(frames).filter(
			(c) => c !== "[DONE]" && c !== null && Array.isArray(c.choices) && c.choices.length > 0,
		);

		// All but last should be null
		for (let i = 0; i < chunks.length - 1; i++) {
			expect(chunks[i].choices[0].finish_reason).toBeNull();
		}

		// Last chunk with choices should have finish_reason set
		const last = chunks[chunks.length - 1];
		expect(last.choices[0].finish_reason).toBe("stop");
	});

	test("final frame is data: [DONE]", async () => {
		const frames = await collectFrames(textEvents);
		expect(frames[frames.length - 1]).toBe("data: [DONE]\n\n");
	});

	test("chunk id is stable across the full stream", async () => {
		const frames = await collectFrames(textEvents);
		const ids = parseChunks(frames)
			.filter((c) => c !== "[DONE]" && c !== null)
			.map((c) => c.id);

		const unique = new Set(ids);
		expect(unique.size).toBe(1);
		expect([...unique][0]).toBe("req-1");
	});
});

// ---------------------------------------------------------------------------
// Usage chunk
// ---------------------------------------------------------------------------

describe("SSE usage chunk conformance", () => {
	const events: AssistantMessageEvent[] = [
		{ type: "start", partial: makePartial() },
		{
			type: "text_delta",
			contentIndex: 0,
			delta: "Hi",
			partial: makePartial([{ type: "text", text: "Hi" }]),
		},
		{
			type: "done",
			reason: "stop",
			message: { ...makePartial([{ type: "text", text: "Hi" }]), stopReason: "stop" },
		},
	];

	test("usage chunk has empty choices array and populated usage", async () => {
		const frames = await collectFrames(events, true);
		const chunks = parseChunks(frames).filter((c) => c !== "[DONE]" && c !== null);

		const usageChunk = chunks.find((c) => Array.isArray(c.choices) && c.choices.length === 0);

		expect(usageChunk).toBeDefined();
		expect(usageChunk.choices).toEqual([]);
		expect(usageChunk.usage).toBeDefined();
		expect(typeof usageChunk.usage.prompt_tokens).toBe("number");
		expect(typeof usageChunk.usage.completion_tokens).toBe("number");
		expect(typeof usageChunk.usage.total_tokens).toBe("number");
	});

	test("usage chunk is absent when include_usage is false", async () => {
		const frames = await collectFrames(events, false);
		const chunks = parseChunks(frames).filter((c) => c !== "[DONE]" && c !== null);

		const usageChunk = chunks.find((c) => Array.isArray(c.choices) && c.choices.length === 0);
		expect(usageChunk).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Tool call streaming
// ---------------------------------------------------------------------------

describe("SSE tool call streaming conformance", () => {
	const toolCall: ToolCall = {
		type: "toolCall",
		id: "call_abc",
		name: "get_weather",
		arguments: {},
	};
	const toolCallDone: ToolCall = {
		type: "toolCall",
		id: "call_abc",
		name: "get_weather",
		arguments: { city: "NYC" },
	};

	const toolEvents: AssistantMessageEvent[] = [
		{ type: "start", partial: makePartial() },
		{ type: "toolcall_start", contentIndex: 0, partial: makePartial([toolCall]) },
		{
			type: "toolcall_delta",
			contentIndex: 0,
			delta: '{"city":',
			partial: makePartial([toolCall]),
		},
		{
			type: "toolcall_delta",
			contentIndex: 0,
			delta: '"NYC"}',
			partial: makePartial([toolCallDone]),
		},
		{
			type: "toolcall_end",
			contentIndex: 0,
			toolCall: toolCallDone,
			partial: makePartial([toolCallDone]),
		},
		{
			type: "done",
			reason: "toolUse",
			message: { ...makePartial([toolCallDone]), stopReason: "toolUse" },
		},
	];

	test("tool call start chunk has index, id, type, function.name", async () => {
		const frames = await collectFrames(toolEvents);
		const chunks = parseChunks(frames).filter((c) => c !== "[DONE]" && c !== null);

		const tcStartChunk = chunks.find(
			(c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.id !== undefined,
		);

		expect(tcStartChunk).toBeDefined();
		const tc = tcStartChunk.choices[0].delta.tool_calls[0];
		expect(typeof tc.index).toBe("number");
		expect(tc.index).toBe(0);
		expect(tc.id).toBe("call_abc");
		expect(tc.type).toBe("function");
		expect(tc.function.name).toBe("get_weather");
	});

	test("tool call delta chunks have index and function.arguments", async () => {
		const frames = await collectFrames(toolEvents);
		const chunks = parseChunks(frames).filter((c) => c !== "[DONE]" && c !== null);

		const deltaChunks = chunks.filter(
			(c) =>
				c.choices?.[0]?.delta?.tool_calls?.[0] !== undefined &&
				c.choices[0].delta.tool_calls[0].id === undefined,
		);

		expect(deltaChunks.length).toBe(2);
		for (const chunk of deltaChunks) {
			const tc = chunk.choices[0].delta.tool_calls[0];
			expect(typeof tc.index).toBe("number");
			expect(typeof tc.function.arguments).toBe("string");
		}
	});

	test("finish_reason is tool_calls on final chunk", async () => {
		const frames = await collectFrames(toolEvents);
		const chunks = parseChunks(frames).filter(
			(c) => c !== "[DONE]" && c !== null && Array.isArray(c.choices) && c.choices.length > 0,
		);

		const last = chunks[chunks.length - 1];
		expect(last.choices[0].finish_reason).toBe("tool_calls");
	});
});

// ---------------------------------------------------------------------------
// encodeDone
// ---------------------------------------------------------------------------

describe("encodeDone", () => {
	test("produces correct terminal frame", () => {
		expect(encodeDone()).toBe("data: [DONE]\n\n");
	});
});
