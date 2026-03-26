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

	// Build a map of tool_call_id -> function name from assistant messages.
	// The OpenAI tool message only has tool_call_id + content, but some providers
	// (Google) require the function name on tool result messages.
	const toolCallNames = new Map<string, string>();
	for (const msg of messages) {
		if (msg !== undefined && msg.role === "assistant" && "tool_calls" in msg) {
			for (const tc of msg.tool_calls ?? []) {
				toolCallNames.set(tc.id, tc.function.name);
			}
		}
	}

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
			const toolName = toolCallNames.get(msg.tool_call_id) ?? "";
			const toolMsg = convertToolMessage(msg.content, msg.tool_call_id, toolName);
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
			// Only base64 data URIs are supported (remote URLs disabled by default)
			if (url.startsWith("data:")) {
				const result = parseAndValidateDataUri(url);
				if (!result.ok) {
					return {
						ok: false,
						message: `${result.message} at messages[${String(index)}].content[${String(j)}]`,
						param: `messages[${String(index)}].content[${String(j)}].image_url.url`,
					};
				}
				parts.push({
					type: "image",
					data: result.parsed.data,
					mimeType: result.parsed.mimeType,
				});
			} else {
				// Remote URLs disabled by default
				return {
					ok: false,
					message: "Remote image URLs are not supported. Use base64 data URIs instead.",
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

function convertToolMessage(
	content: string,
	toolCallId: string,
	toolName: string,
): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: content }],
		isError: false,
		timestamp: Date.now(),
	};
}

// --- Helpers ---

/**
 * Supported image MIME types for base64 data URIs.
 */
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Maximum base64 payload size (20 MB of base64 text, ~15 MB decoded).
 */
const MAX_BASE64_PAYLOAD_SIZE = 20 * 1024 * 1024;

export interface ParsedDataUri {
	readonly data: string;
	readonly mimeType: string;
}

export interface DataUriError {
	readonly ok: false;
	readonly message: string;
}

export interface DataUriSuccess {
	readonly ok: true;
	readonly parsed: ParsedDataUri;
}

type DataUriResult = DataUriSuccess | DataUriError;

function parseAndValidateDataUri(uri: string): DataUriResult {
	// data:[<mediatype>][;base64],<data>
	const match = /^data:([^;]+);base64,(.+)$/.exec(uri);
	if (match === null) {
		return { ok: false, message: "Invalid base64 data URI format" };
	}
	const mimeType = match[1];
	const data = match[2];
	if (mimeType === undefined || data === undefined) {
		return { ok: false, message: "Invalid base64 data URI format" };
	}

	// Validate MIME type
	if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
		return {
			ok: false,
			message: `Unsupported image MIME type '${mimeType}'. Supported: ${[...SUPPORTED_IMAGE_MIME_TYPES].join(", ")}`,
		};
	}

	// Validate payload size
	if (data.length > MAX_BASE64_PAYLOAD_SIZE) {
		return {
			ok: false,
			message: `Image payload exceeds maximum size of ${String(MAX_BASE64_PAYLOAD_SIZE)} bytes`,
		};
	}

	return { ok: true, parsed: { data, mimeType } };
}
