/**
 * Pi completion integration: non-streaming and streaming.
 *
 * Bridges validated OpenAI requests to pi's completeSimple() and streamSimple().
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	ThinkingLevel,
} from "@mariozechner/pi-ai";
import { completeSimple, streamSimple } from "@mariozechner/pi-ai";
import type { ChatCompletionRequest, OpenAIFunctionTool } from "@proxy/openai/schemas";
import { getRegistry } from "@proxy/pi/registry";
import { isRecord } from "@proxy/utils/guards";

/**
 * Map OpenAI reasoning_effort to pi ThinkingLevel.
 *
 * OpenAI: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
 * Pi: "minimal" | "low" | "medium" | "high" | "xhigh"
 *
 * "none" maps to "minimal" (pi has no "none" level).
 */
const REASONING_EFFORT_MAP: Record<string, ThinkingLevel> = {
	none: "minimal",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
};

/**
 * APIs where onPayload passthrough fields are not supported.
 * These APIs use non-standard request formats that reject standard OpenAI fields.
 */
const SKIP_PAYLOAD_PASSTHROUGH_APIS = new Set(["openai-codex-responses"]);

/**
 * Collect fields that need to be injected via onPayload.
 * Skips passthrough for APIs that use non-standard request formats.
 *
 * @internal Exported for unit testing only.
 */
export function collectPayloadFields(
	request: ChatCompletionRequest,
	api: string,
): Record<string, unknown> | undefined {
	if (SKIP_PAYLOAD_PASSTHROUGH_APIS.has(api)) {
		return undefined;
	}

	const fields: Record<string, unknown> = {};
	let hasFields = false;

	if (request.stop !== undefined) {
		fields["stop"] = request.stop;
		hasFields = true;
	}
	if (request.user !== undefined) {
		fields["user"] = request.user;
		hasFields = true;
	}
	if (request.top_p !== undefined) {
		fields["top_p"] = request.top_p;
		hasFields = true;
	}
	if (request.frequency_penalty !== undefined) {
		fields["frequency_penalty"] = request.frequency_penalty;
		hasFields = true;
	}
	if (request.presence_penalty !== undefined) {
		fields["presence_penalty"] = request.presence_penalty;
		hasFields = true;
	}
	if (request.seed !== undefined) {
		fields["seed"] = request.seed;
		hasFields = true;
	}
	if (request.response_format !== undefined) {
		fields["response_format"] = request.response_format;
		hasFields = true;
	}
	if (request.tool_choice !== undefined) {
		fields["tool_choice"] = request.tool_choice;
		hasFields = true;
	}

	return hasFields ? fields : undefined;
}

/**
 * Collect tool strict flags from the original OpenAI request.
 *
 * The pi SDK's `Tool` interface has no `strict` field, so the SDK always sets
 * `strict: false` when building the upstream payload. This function extracts
 * the per-tool strict flags from the original request so they can be restored
 * via `onPayload` after the SDK builds the payload.
 *
 * Returns a map of tool index -> true for tools that requested strict mode,
 * or undefined if no tools use strict mode.
 *
 * @internal Exported for unit testing only.
 */
export function collectToolStrictFlags(
	tools: OpenAIFunctionTool[] | undefined,
): ReadonlyMap<number, true> | undefined {
	if (tools === undefined || tools.length === 0) {
		return undefined;
	}

	let flags: Map<number, true> | undefined;

	for (let i = 0; i < tools.length; i++) {
		const tool = tools[i];
		if (tool?.function.strict === true) {
			flags ??= new Map();
			flags.set(i, true);
		}
	}

	return flags;
}

/**
 * Apply strict flags to tool definitions in the upstream payload.
 *
 * The pi SDK always sets `strict: false` on tool definitions. This function
 * patches the payload's `tools` array to restore the client's requested
 * `strict: true` flags on the matching tool definitions.
 *
 * @internal Exported for unit testing only.
 */
export function applyToolStrictFlags(
	payload: Record<string, unknown>,
	strictFlags: ReadonlyMap<number, true>,
): void {
	const tools = payload["tools"];
	if (!Array.isArray(tools)) {
		return;
	}
	for (const [index, _flag] of strictFlags) {
		const tool = tools[index] as unknown;
		if (isRecord(tool)) {
			const fn = tool["function"];
			if (isRecord(fn)) {
				fn["strict"] = true;
			}
		}
	}
}

/**
 * Options for building pi stream options, beyond the parsed request itself.
 */
export interface CompletionOptions {
	/** Per-request upstream API key override via X-Pi-Upstream-Api-Key header. */
	readonly upstreamApiKey?: string | undefined;
	/** Abort signal for cancellation. */
	readonly signal?: AbortSignal | undefined;
	/** Upstream timeout in milliseconds. Creates a timeout-aware abort signal. */
	readonly upstreamTimeoutMs?: number | undefined;
}

/**
 * Combine a client disconnect signal with an upstream timeout into a single signal.
 * Returns the combined signal, or undefined if neither is provided.
 */
function buildCombinedSignal(
	clientSignal: AbortSignal | undefined,
	timeoutMs: number | undefined,
): AbortSignal | undefined {
	if (clientSignal === undefined && timeoutMs === undefined) {
		return undefined;
	}
	if (timeoutMs === undefined) {
		return clientSignal;
	}
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	if (clientSignal === undefined) {
		return timeoutSignal;
	}
	return AbortSignal.any([clientSignal, timeoutSignal]);
}

/**
 * Build pi SimpleStreamOptions from an OpenAI request.
 */
async function buildStreamOptions(
	model: Model<Api>,
	request: ChatCompletionRequest,
	options: CompletionOptions,
): Promise<SimpleStreamOptions> {
	const opts: SimpleStreamOptions = {};

	// openai-codex-responses API does not support temperature
	if (request.temperature !== undefined && model.api !== "openai-codex-responses") {
		opts.temperature = request.temperature;
	}

	// Normalize max_tokens / max_completion_tokens
	const maxTokens = request.max_completion_tokens ?? request.max_tokens;
	if (maxTokens !== undefined) {
		opts.maxTokens = maxTokens;
	}

	// Map reasoning_effort to pi ThinkingLevel
	if (request.reasoning_effort !== undefined) {
		const level = REASONING_EFFORT_MAP[request.reasoning_effort];
		if (level !== undefined) {
			opts.reasoning = level;
		}
	}

	// Combine client disconnect signal with upstream timeout
	const combinedSignal = buildCombinedSignal(options.signal, options.upstreamTimeoutMs);
	if (combinedSignal !== undefined) {
		opts.signal = combinedSignal;
	}

	// Per-request upstream key takes precedence over registry-resolved key
	if (options.upstreamApiKey !== undefined) {
		opts.apiKey = options.upstreamApiKey;
	} else {
		const apiKey = await getRegistry().getApiKey(model);
		if (apiKey !== undefined) {
			opts.apiKey = apiKey;
		}
	}

	// Inject passthrough fields and tool strict flags via onPayload
	const payloadFields = collectPayloadFields(request, model.api);
	const strictFlags = collectToolStrictFlags(request.tools);

	if (payloadFields !== undefined || strictFlags !== undefined) {
		opts.onPayload = (payload: unknown) => {
			if (isRecord(payload)) {
				if (payloadFields !== undefined) {
					for (const [key, value] of Object.entries(payloadFields)) {
						payload[key] = value;
					}
				}
				if (strictFlags !== undefined) {
					applyToolStrictFlags(payload, strictFlags);
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
	options: CompletionOptions,
): Promise<AssistantMessage> {
	const opts = await buildStreamOptions(model, request, options);
	return completeSimple(model, context, opts);
}

/**
 * Streaming completion: returns an event stream with abort capability.
 */
export async function piStream(
	model: Model<Api>,
	context: Context,
	request: ChatCompletionRequest,
	options: CompletionOptions,
): Promise<AssistantMessageEventStream> {
	const opts = await buildStreamOptions(model, request, options);
	return streamSimple(model, context, opts);
}
