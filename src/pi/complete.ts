/**
 * Pi completion integration: non-streaming and streaming.
 *
 * Bridges validated OpenAI requests to pi's completeSimple() and streamSimple().
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { completeSimple, streamSimple } from "@mariozechner/pi-ai";
import type { ChatCompletionRequest } from "../openai/schemas.js";
import { getRegistry } from "./registry.js";

/**
 * Build pi SimpleStreamOptions from an OpenAI request.
 */
async function buildStreamOptions(
	model: Model<Api>,
	request: ChatCompletionRequest,
	signal?: AbortSignal,
): Promise<SimpleStreamOptions> {
	const opts: SimpleStreamOptions = {};

	if (request.temperature !== undefined) {
		opts.temperature = request.temperature;
	}

	// Normalize max_tokens / max_completion_tokens
	const maxTokens = request.max_completion_tokens ?? request.max_tokens;
	if (maxTokens !== undefined) {
		opts.maxTokens = maxTokens;
	}

	if (signal !== undefined) {
		opts.signal = signal;
	}

	// Resolve API key through the registry
	const apiKey = await getRegistry().getApiKey(model);
	if (apiKey !== undefined) {
		opts.apiKey = apiKey;
	}

	// Pass `stop` and `user` through onPayload
	if (request.stop !== undefined || request.user !== undefined) {
		opts.onPayload = (payload: unknown) => {
			if (payload !== null && typeof payload === "object") {
				const p = payload as Record<string, unknown>;
				if (request.stop !== undefined) {
					p["stop"] = request.stop;
				}
				if (request.user !== undefined) {
					p["user"] = request.user;
				}
			}
			return payload;
		};
	}

	return opts;
}

/**
 * Non-streaming completion: returns the final AssistantMessage.
 */
export async function piComplete(
	model: Model<Api>,
	context: Context,
	request: ChatCompletionRequest,
	signal?: AbortSignal,
): Promise<AssistantMessage> {
	const opts = await buildStreamOptions(model, request, signal);
	return completeSimple(model, context, opts);
}

/**
 * Streaming completion: returns an async iterable of events.
 */
export async function piStream(
	model: Model<Api>,
	context: Context,
	request: ChatCompletionRequest,
	signal?: AbortSignal,
): Promise<AsyncIterable<AssistantMessageEvent>> {
	const opts = await buildStreamOptions(model, request, signal);
	return streamSimple(model, context, opts);
}
