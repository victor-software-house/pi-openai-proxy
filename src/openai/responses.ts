/**
 * Build OpenAI-compatible response objects from pi results.
 *
 * Phase 0 contract:
 * - finish_reason: stop -> stop, length -> length, toolUse -> tool_calls
 * - Do not synthesize finish reasons pi cannot distinguish (e.g. content_filter)
 * - Usage maps pi Usage -> OpenAI usage with cache breakdowns under x_pi
 */

import type {
	AssistantMessage,
	StopReason,
	TextContent,
	ToolCall,
	Usage,
} from "@mariozechner/pi-ai";

export interface OpenAIUsage {
	readonly prompt_tokens: number;
	readonly completion_tokens: number;
	readonly total_tokens: number;
}

export interface OpenAIChatCompletion {
	readonly id: string;
	readonly object: "chat.completion";
	readonly created: number;
	readonly model: string;
	readonly choices: OpenAIChatCompletionChoice[];
	readonly usage: OpenAIUsage;
	readonly x_pi?: {
		readonly cost: Usage["cost"];
		readonly cache_read_tokens: number;
		readonly cache_write_tokens: number;
	};
}

export interface OpenAIChatCompletionChoice {
	readonly index: number;
	readonly message: {
		readonly role: "assistant";
		readonly content: string | null;
		readonly tool_calls?: OpenAIToolCall[] | undefined;
	};
	readonly finish_reason: string;
}

export interface OpenAIToolCall {
	readonly id: string;
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}

/**
 * Map pi StopReason to OpenAI finish_reason.
 */
export function mapFinishReason(reason: StopReason): string {
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "toolUse":
			return "tool_calls";
		case "error":
			return "stop";
		case "aborted":
			return "stop";
	}
}

/**
 * Map pi Usage to OpenAI usage.
 */
export function mapUsage(usage: Usage): OpenAIUsage {
	return {
		prompt_tokens: usage.input,
		completion_tokens: usage.output,
		total_tokens: usage.totalTokens,
	};
}

/**
 * Build a complete non-streaming OpenAI response from a pi AssistantMessage.
 */
export function buildChatCompletion(
	requestId: string,
	canonicalModelId: string,
	message: AssistantMessage,
): OpenAIChatCompletion {
	// Extract text content
	const textParts = message.content.filter((c): c is TextContent => c.type === "text");
	const textContent = textParts.length > 0 ? textParts.map((t) => t.text).join("") : null;

	// Extract tool calls
	const toolCallParts = message.content.filter((c): c is ToolCall => c.type === "toolCall");
	const toolCalls: OpenAIToolCall[] = toolCallParts.map((tc) => ({
		id: tc.id,
		type: "function" as const,
		function: {
			name: tc.name,
			arguments: JSON.stringify(tc.arguments),
		},
	}));

	const messageBody: OpenAIChatCompletionChoice["message"] =
		toolCalls.length > 0
			? { role: "assistant", content: textContent, tool_calls: toolCalls }
			: { role: "assistant", content: textContent };

	return {
		id: requestId,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: canonicalModelId,
		choices: [
			{
				index: 0,
				message: messageBody,
				finish_reason: mapFinishReason(message.stopReason),
			},
		],
		usage: mapUsage(message.usage),
		x_pi: {
			cost: message.usage.cost,
			cache_read_tokens: message.usage.cacheRead,
			cache_write_tokens: message.usage.cacheWrite,
		},
	};
}
