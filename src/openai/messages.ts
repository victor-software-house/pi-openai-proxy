/**
 * OpenAI messages -> pi Context conversion.
 *
 * Phase 0 contract:
 * - `system` messages -> accumulated system prompt
 * - `developer` messages -> merged into effective system prompt in message order
 * - `user` text -> pi UserMessage
 * - `assistant` text -> pi AssistantMessage history
 * - `tool` -> pi ToolResultMessage
 * - Reject unsupported content parts clearly
 */

import type {
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	TextContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "@mariozechner/pi-ai";
import type { OpenAIMessage } from "@proxy/openai/schemas";
import * as z from "zod";

const toolArgsSchema = z.record(z.string().trim(), z.unknown());

export interface ConversionSuccess {
	readonly ok: true;
	readonly context: Context;
}

export interface ConversionError {
	readonly ok: false;
	readonly message: string;
	readonly param: string;
}

export type ConversionResult = ConversionSuccess | ConversionError;

/**
 * Convert OpenAI messages array into a pi Context.
 *
 * System and developer messages are merged into `systemPrompt`.
 * Conversation messages are mapped into pi message types.
 */
export function convertMessages(messages: OpenAIMessage[]): ConversionResult {
	const systemParts: string[] = [];
	const piMessages: Message[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg === undefined) continue;

		if (msg.role === "system") {
			systemParts.push(msg.content);
		} else if (msg.role === "developer") {
			systemParts.push(msg.content);
		} else if (msg.role === "user") {
			const userMsg = convertUserMessage(msg.content, i);
			if (!userMsg.ok) return userMsg;
			piMessages.push(userMsg.message);
		} else if (msg.role === "assistant") {
			const assistantMsg = convertAssistantMessage(msg.content ?? null, msg.tool_calls);
			piMessages.push(assistantMsg);
		} else if (msg.role === "tool") {
			const toolMsg = convertToolMessage(msg.content, msg.tool_call_id);
			piMessages.push(toolMsg);
		}
	}

	const context: Context = {
		messages: piMessages,
	};

	if (systemParts.length > 0) {
		context.systemPrompt = systemParts.join("\n\n");
	}

	return { ok: true, context };
}

// --- Internal converters ---

type UserConversionResult = { readonly ok: true; readonly message: UserMessage } | ConversionError;

type UserContent = string | { type: string; text?: string; image_url?: { url: string } }[];

function convertUserMessage(content: UserContent, index: number): UserConversionResult {
	if (typeof content === "string") {
		return {
			ok: true,
			message: {
				role: "user",
				content,
				timestamp: Date.now(),
			},
		};
	}

	// Multi-part content
	const parts: (TextContent | ImageContent)[] = [];

	for (let j = 0; j < content.length; j++) {
		const part = content[j];
		if (part === undefined) continue;

		if (part.type === "text") {
			parts.push({ type: "text", text: part.text ?? "" });
		} else if (part.type === "image_url") {
			const url = part.image_url?.url ?? "";
			// Phase 1: only base64 data URIs are supported
			if (url.startsWith("data:")) {
				const parsed = parseDataUri(url);
				if (parsed === null) {
					return {
						ok: false,
						message: `Invalid base64 image data URI at messages[${String(index)}].content[${String(j)}]`,
						param: `messages[${String(index)}].content[${String(j)}].image_url.url`,
					};
				}
				parts.push({
					type: "image",
					data: parsed.data,
					mimeType: parsed.mimeType,
				});
			} else {
				// Remote URLs disabled in Phase 1
				return {
					ok: false,
					message:
						"Remote image URLs are not supported in this version. Use base64 data URIs instead.",
					param: `messages[${String(index)}].content[${String(j)}].image_url.url`,
				};
			}
		} else {
			return {
				ok: false,
				message: `Unsupported content part type: '${part.type}'`,
				param: `messages[${String(index)}].content[${String(j)}].type`,
			};
		}
	}

	return {
		ok: true,
		message: {
			role: "user",
			content: parts,
			timestamp: Date.now(),
		},
	};
}

interface OpenAIToolCallInput {
	readonly id: string;
	readonly type: "function";
	readonly function: { readonly name: string; readonly arguments: string };
}

function convertAssistantMessage(
	textContent: string | null,
	toolCalls: OpenAIToolCallInput[] | undefined,
): AssistantMessage {
	const content: (TextContent | ToolCall)[] = [];

	if (textContent !== null && textContent.length > 0) {
		content.push({ type: "text", text: textContent });
	}

	if (toolCalls !== undefined) {
		for (const tc of toolCalls) {
			let args: Record<string, unknown> = {};
			try {
				const parsed = toolArgsSchema.safeParse(JSON.parse(tc.function.arguments));
				if (parsed.success) {
					args = parsed.data;
				}
			} catch {
				// Best-effort: keep empty args if parsing fails
			}
			content.push({
				type: "toolCall",
				id: tc.id,
				name: tc.function.name,
				arguments: args,
			});
		}
	}

	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "proxy",
		model: "history",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function convertToolMessage(content: string, toolCallId: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "",
		content: [{ type: "text", text: content }],
		isError: false,
		timestamp: Date.now(),
	};
}

// --- Helpers ---

function parseDataUri(uri: string): { data: string; mimeType: string } | null {
	// data:[<mediatype>][;base64],<data>
	const match = /^data:([^;]+);base64,(.+)$/.exec(uri);
	if (match === null) return null;
	const mimeType = match[1];
	const data = match[2];
	if (mimeType === undefined || data === undefined) return null;
	return { data, mimeType };
}
