/**
 * SSE encoder: bridge pi AssistantMessageEvent stream -> OpenAI SSE chunks.
 *
 * Phase 0 contract:
 * - First chunk has delta.role = "assistant"
 * - Text deltas map to delta.content
 * - Tool call deltas map to delta.tool_calls
 * - Stable chunk ID across the full response
 * - Final [DONE] sentinel
 * - If stream_options.include_usage, emit final usage chunk with empty choices
 * - Do not emit non-standard reasoning fields on the stable path
 */

import type { AssistantMessageEvent, Usage } from "@mariozechner/pi-ai";
import { mapFinishReason, mapUsage } from "./responses.js";

export interface SSEChunk {
	readonly id: string;
	readonly object: "chat.completion.chunk";
	readonly created: number;
	readonly model: string;
	readonly choices: SSEChunkChoice[];
	readonly usage?: ReturnType<typeof mapUsage> | null;
}

export interface SSEChunkChoice {
	readonly index: number;
	readonly delta: SSEChunkDelta;
	readonly finish_reason: string | null;
}

export interface SSEChunkDelta {
	readonly role?: "assistant";
	readonly content?: string;
	readonly tool_calls?: SSEToolCallDelta[];
}

export interface SSEToolCallDelta {
	readonly index: number;
	readonly id?: string;
	readonly type?: "function";
	readonly function?: {
		readonly name?: string;
		readonly arguments?: string;
	};
}

/**
 * Encode a single SSE data frame.
 */
export function encodeSSE(chunk: SSEChunk): string {
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Encode the terminal [DONE] frame.
 */
export function encodeDone(): string {
	return "data: [DONE]\n\n";
}

/**
 * Create an async generator that yields SSE text frames from a pi event stream.
 */
export async function* streamToSSE(
	events: AsyncIterable<AssistantMessageEvent>,
	requestId: string,
	model: string,
	includeUsage: boolean,
): AsyncGenerator<string> {
	const created = Math.floor(Date.now() / 1000);
	let sentFirstChunk = false;
	let finishReason: string | null = null;
	let finalUsage: Usage | undefined;

	// Track tool call indexes for stable delta sequencing
	const toolCallIndexes = new Map<number, boolean>();

	for await (const event of events) {
		switch (event.type) {
			case "start": {
				// Emit the first chunk with role
				yield encodeSSE({
					id: requestId,
					object: "chat.completion.chunk",
					created,
					model,
					choices: [
						{
							index: 0,
							delta: { role: "assistant" },
							finish_reason: null,
						},
					],
				});
				sentFirstChunk = true;
				break;
			}

			case "text_delta": {
				if (!sentFirstChunk) {
					yield encodeSSE({
						id: requestId,
						object: "chat.completion.chunk",
						created,
						model,
						choices: [
							{
								index: 0,
								delta: { role: "assistant", content: event.delta },
								finish_reason: null,
							},
						],
					});
					sentFirstChunk = true;
				} else {
					yield encodeSSE({
						id: requestId,
						object: "chat.completion.chunk",
						created,
						model,
						choices: [
							{
								index: 0,
								delta: { content: event.delta },
								finish_reason: null,
							},
						],
					});
				}
				break;
			}

			case "toolcall_start": {
				const ci = event.contentIndex;
				const toolCallContent = event.partial.content[ci];
				if (toolCallContent !== undefined && toolCallContent.type === "toolCall") {
					// Determine the tool call index within the message's tool calls
					const tcIndex = toolCallIndexes.size;
					toolCallIndexes.set(ci, true);

					yield encodeSSE({
						id: requestId,
						object: "chat.completion.chunk",
						created,
						model,
						choices: [
							{
								index: 0,
								delta: {
									tool_calls: [
										{
											index: tcIndex,
											id: toolCallContent.id,
											type: "function",
											function: {
												name: toolCallContent.name,
												arguments: "",
											},
										},
									],
								},
								finish_reason: null,
							},
						],
					});
				}
				break;
			}

			case "toolcall_delta": {
				// Find the tool call index
				let tcIndex = 0;
				let found = false;
				for (const [ci] of toolCallIndexes) {
					if (ci === event.contentIndex) {
						found = true;
						break;
					}
					tcIndex++;
				}
				if (!found) break;

				yield encodeSSE({
					id: requestId,
					object: "chat.completion.chunk",
					created,
					model,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: tcIndex,
										function: {
											arguments: event.delta,
										},
									},
								],
							},
							finish_reason: null,
						},
					],
				});
				break;
			}

			case "done": {
				finishReason = mapFinishReason(event.reason);
				finalUsage = event.message.usage;
				break;
			}

			case "error": {
				finishReason = mapFinishReason(event.reason);
				finalUsage = event.error.usage;
				break;
			}

			// text_start, text_end, thinking_start, thinking_delta, thinking_end, toolcall_end:
			// Not mapped to SSE output in the stable path.
			default:
				break;
		}
	}

	// Emit final chunk with finish_reason
	if (finishReason !== null) {
		yield encodeSSE({
			id: requestId,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [
				{
					index: 0,
					delta: {},
					finish_reason: finishReason,
				},
			],
		});
	}

	// Emit usage chunk if requested
	if (includeUsage && finalUsage !== undefined) {
		yield encodeSSE({
			id: requestId,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [],
			usage: mapUsage(finalUsage),
		});
	}

	// Terminal sentinel
	yield encodeDone();
}
