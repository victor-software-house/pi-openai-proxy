/**
 * Wire-level SSE conformance tests.
 *
 * Validates that streamToSSE() output matches the OpenAI ChatCompletionChunk
 * contract the official SDK expects. Uses mock pi events, no credentials needed.
 */

import { describe, expect, test } from "bun:test";
import type { AssistantMessage, AssistantMessageEvent, ToolCall, Usage } from "@mariozechner/pi-ai";
import type { SSEChunk } from "@proxy/openai/sse";
import { encodeDone, streamToSSE } from "@proxy/openai/sse";
import { isRecord } from "@proxy/utils/guards";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runtime type guard for SSEChunk shape.
 * Validates the required fields that streamToSSE always emits.
 */
function isSSEChunk(value: unknown): value is SSEChunk {
	if (!isRecord(value)) return false;
	return (
		typeof value["id"] === "string" &&
		value["object"] === "chat.completion.chunk" &&
		typeof value["created"] === "number" &&
		typeof value["model"] === "string" &&
		Array.isArray(value["choices"])
	);
}

/** Sentinel value for the terminal [DONE] frame. */
const DONE_SENTINEL = "[DONE]" as const;

type ParsedFrame = SSEChunk | typeof DONE_SENTINEL | null;

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

/**
 * Parse SSE data frames into typed chunks.
 * Returns SSEChunk for valid JSON, "[DONE]" for the terminal frame,
 * or null for non-data frames.
 */
function parseChunks(frames: string[]): ParsedFrame[] {
	return frames.map((f): ParsedFrame => {
		if (!f.startsWith("data: ")) return null;
		const json = f.slice(6).trim();
		if (json === "[DONE]") return DONE_SENTINEL;
		const parsed: unknown = JSON.parse(json);
		if (!isSSEChunk(parsed)) return null;
		return parsed;
	});
}

/** Filter parsed frames to only valid SSEChunk objects. */
function chunkFrames(frames: ParsedFrame[]): SSEChunk[] {
	return frames.filter((c): c is SSEChunk => c !== DONE_SENTINEL && c !== null);
}

/** Filter to chunks that have at least one choice. */
function chunksWithChoices(frames: ParsedFrame[]): SSEChunk[] {
	return chunkFrames(frames).filter((c) => c.choices.length > 0);
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
		const chunks = chunkFrames(parseChunks(frames));

		for (const chunk of chunks) {
			expect(chunk.id).toBe("req-1");
			expect(chunk.object).toBe("chat.completion.chunk");
			expect(chunk.created).toBeNumber();
			expect(chunk.created).toBeGreaterThan(0);
			expect(chunk.model).toBe("test-model");
		}
	});

	test("first chunk has delta.role = assistant", async () => {
		const frames = await collectFrames(textEvents);
		const chunks = chunkFrames(parseChunks(frames));
		const first = chunks[0];
		expect(first).toBeDefined();
		if (first === undefined) return;
		const choice = first.choices[0];
		expect(choice).toBeDefined();
		if (choice === undefined) return;
		expect(choice.delta.role).toBe("assistant");
	});

	test("delta.content is a string on text delta chunks", async () => {
		const frames = await collectFrames(textEvents);
		const chunks = chunkFrames(parseChunks(frames));

		const contentChunks = chunks.filter((c) => {
			const choice = c.choices[0];
			return choice !== undefined && choice.delta.content !== undefined;
		});

		expect(contentChunks.length).toBeGreaterThan(0);
		for (const chunk of contentChunks) {
			const choice = chunk.choices[0];
			expect(choice).toBeDefined();
			if (choice === undefined) continue;
			expect(choice.delta.content).toBeString();
		}
	});

	test("finish_reason is null on intermediate chunks, set on final", async () => {
		const frames = await collectFrames(textEvents);
		const chunks = chunksWithChoices(parseChunks(frames));

		// All but last should be null
		for (let i = 0; i < chunks.length - 1; i++) {
			const chunk = chunks[i];
			if (chunk === undefined) continue;
			const choice = chunk.choices[0];
			if (choice === undefined) continue;
			expect(choice.finish_reason).toBeNull();
		}

		// Last chunk with choices should have finish_reason set
		const last = chunks[chunks.length - 1];
		expect(last).toBeDefined();
		if (last === undefined) return;
		const lastChoice = last.choices[0];
		expect(lastChoice).toBeDefined();
		if (lastChoice === undefined) return;
		expect(lastChoice.finish_reason).toBe("stop");
	});

	test("final frame is data: [DONE]", async () => {
		const frames = await collectFrames(textEvents);
		expect(frames[frames.length - 1]).toBe("data: [DONE]\n\n");
	});

	test("chunk id is stable across the full stream", async () => {
		const frames = await collectFrames(textEvents);
		const chunks = chunkFrames(parseChunks(frames));
		const ids = chunks.map((c) => c.id);

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
		const chunks = chunkFrames(parseChunks(frames));

		const usageChunk = chunks.find((c) => c.choices.length === 0);

		expect(usageChunk).toBeDefined();
		if (usageChunk === undefined) return;
		expect(usageChunk.choices).toEqual([]);
		expect(usageChunk.usage).toBeDefined();
		if (usageChunk.usage === undefined || usageChunk.usage === null) return;
		expect(usageChunk.usage.prompt_tokens).toBeNumber();
		expect(usageChunk.usage.completion_tokens).toBeNumber();
		expect(usageChunk.usage.total_tokens).toBeNumber();
	});

	test("usage chunk is absent when include_usage is false", async () => {
		const frames = await collectFrames(events, false);
		const chunks = chunkFrames(parseChunks(frames));

		const usageChunk = chunks.find((c) => c.choices.length === 0);
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
		const chunks = chunkFrames(parseChunks(frames));

		const tcStartChunk = chunks.find((c) => {
			const tc = c.choices[0]?.delta.tool_calls?.[0];
			return tc !== undefined && tc.id !== undefined;
		});

		expect(tcStartChunk).toBeDefined();
		if (tcStartChunk === undefined) return;
		const choice = tcStartChunk.choices[0];
		expect(choice).toBeDefined();
		if (choice === undefined) return;
		const tc = choice.delta.tool_calls?.[0];
		expect(tc).toBeDefined();
		if (tc === undefined) return;
		expect(tc.index).toBeNumber();
		expect(tc.index).toBe(0);
		expect(tc.id).toBe("call_abc");
		expect(tc.type).toBe("function");
		expect(tc.function).toBeDefined();
		if (tc.function === undefined) return;
		expect(tc.function.name).toBe("get_weather");
	});

	test("tool call delta chunks have index and function.arguments", async () => {
		const frames = await collectFrames(toolEvents);
		const chunks = chunkFrames(parseChunks(frames));

		const deltaChunks = chunks.filter((c) => {
			const tc = c.choices[0]?.delta.tool_calls?.[0];
			return tc !== undefined && tc.id === undefined;
		});

		expect(deltaChunks.length).toBe(2);
		for (const chunk of deltaChunks) {
			const choice = chunk.choices[0];
			expect(choice).toBeDefined();
			if (choice === undefined) continue;
			const tc = choice.delta.tool_calls?.[0];
			expect(tc).toBeDefined();
			if (tc === undefined) continue;
			expect(tc.index).toBeNumber();
			expect(tc.function).toBeDefined();
			if (tc.function === undefined) continue;
			expect(tc.function.arguments).toBeString();
		}
	});

	test("finish_reason is tool_calls on final chunk", async () => {
		const frames = await collectFrames(toolEvents);
		const chunks = chunksWithChoices(parseChunks(frames));

		const last = chunks[chunks.length - 1];
		expect(last).toBeDefined();
		if (last === undefined) return;
		const lastChoice = last.choices[0];
		expect(lastChoice).toBeDefined();
		if (lastChoice === undefined) return;
		expect(lastChoice.finish_reason).toBe("tool_calls");
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
