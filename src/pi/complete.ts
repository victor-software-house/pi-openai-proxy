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
 * APIs that use the OpenAI chat completions wire format and accept standard
 * passthrough fields (stop, seed, top_p, tool_choice, etc.) in the payload.
 */
const OPENAI_COMPATIBLE_APIS = new Set([
	"openai-completions",
	"openai-responses",
	"azure-openai-responses",
	"mistral-conversations",
]);

const ANTHROPIC_APIS = new Set(["anthropic-messages"]);

const GOOGLE_APIS = new Set(["google-generative-ai", "google-gemini-cli", "google-vertex"]);

// ---------------------------------------------------------------------------
// OpenAI-compatible payload fields
// ---------------------------------------------------------------------------

/**
 * Collect OpenAI-format fields for OpenAI-compatible APIs.
 * Fields are injected as flat top-level properties on the payload.
 *
 * @internal Exported for unit testing only.
 */
export function collectOpenAIPayloadFields(
	request: ChatCompletionRequest,
): Record<string, unknown> | undefined {
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
	if (request.parallel_tool_calls !== undefined) {
		fields["parallel_tool_calls"] = request.parallel_tool_calls;
		hasFields = true;
	}
	if (request.metadata !== undefined) {
		fields["metadata"] = request.metadata;
		hasFields = true;
	}
	if (request.prediction !== undefined) {
		fields["prediction"] = request.prediction;
		hasFields = true;
	}

	return hasFields ? fields : undefined;
}

// ---------------------------------------------------------------------------
// Anthropic payload translation
// ---------------------------------------------------------------------------

/**
 * Translate OpenAI tool_choice to Anthropic tool_choice format.
 *
 * OpenAI "auto" -> { type: "auto" }
 * OpenAI "none" -> { type: "none" } (Anthropic skips tool calling)
 * OpenAI "required" -> { type: "any" } (force tool use)
 * OpenAI { type: "function", function: { name } } -> { type: "tool", name }
 *
 * @internal Exported for unit testing only.
 */
export function translateToolChoiceForAnthropic(
	toolChoice: ChatCompletionRequest["tool_choice"],
): Record<string, unknown> | undefined {
	if (toolChoice === undefined) {
		return undefined;
	}
	if (toolChoice === "auto") {
		return { type: "auto" };
	}
	if (toolChoice === "none") {
		return { type: "none" };
	}
	if (toolChoice === "required") {
		return { type: "any" };
	}
	// Named function choice: { type: "function", function: { name } }
	return { type: "tool", name: toolChoice.function.name };
}

/**
 * Collect Anthropic-format fields translated from the OpenAI request.
 *
 * Supported translations:
 * - top_p -> top_p (same name, natively supported)
 * - stop -> stop_sequences (different field name)
 * - tool_choice -> Anthropic tool_choice format (object with type)
 * - parallel_tool_calls: false -> disable_parallel_tool_use on tool_choice
 * - user -> metadata.user_id
 *
 * Not supported (silently skipped — these concepts don't exist in Anthropic):
 * - seed, frequency_penalty, presence_penalty, response_format, prediction, metadata (arbitrary keys)
 *
 * @internal Exported for unit testing only.
 */
export function collectAnthropicPayloadFields(
	request: ChatCompletionRequest,
): Record<string, unknown> | undefined {
	const fields: Record<string, unknown> = {};
	let hasFields = false;

	if (request.top_p !== undefined) {
		fields["top_p"] = request.top_p;
		hasFields = true;
	}

	if (request.stop !== undefined) {
		const sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
		fields["stop_sequences"] = sequences;
		hasFields = true;
	}

	// Build tool_choice with optional disable_parallel_tool_use
	const toolChoice = translateToolChoiceForAnthropic(request.tool_choice);
	const disableParallel = request.parallel_tool_calls === false;

	if (toolChoice !== undefined) {
		if (disableParallel) {
			toolChoice["disable_parallel_tool_use"] = true;
		}
		fields["tool_choice"] = toolChoice;
		hasFields = true;
	} else if (disableParallel) {
		// No explicit tool_choice but parallel disabled: set auto with flag
		fields["tool_choice"] = { type: "auto", disable_parallel_tool_use: true };
		hasFields = true;
	}

	// Map user to metadata.user_id (Anthropic only accepts user_id in metadata)
	if (request.user !== undefined) {
		fields["metadata"] = { user_id: request.user };
		hasFields = true;
	}

	return hasFields ? fields : undefined;
}

// ---------------------------------------------------------------------------
// Google payload translation
// ---------------------------------------------------------------------------

/**
 * Translate OpenAI tool_choice to Google FunctionCallingConfigMode string.
 *
 * OpenAI "auto" -> "AUTO"
 * OpenAI "none" -> "NONE"
 * OpenAI "required" -> "ANY"
 * Named function choice -> "ANY" (Google doesn't support per-function forcing
 * in the same way, but ANY forces tool use)
 */
function translateToolChoiceForGoogle(
	toolChoice: ChatCompletionRequest["tool_choice"],
): string | undefined {
	if (toolChoice === undefined) {
		return undefined;
	}
	if (toolChoice === "auto") {
		return "AUTO";
	}
	if (toolChoice === "none") {
		return "NONE";
	}
	// "required" or named function -> force tool use
	return "ANY";
}

/**
 * Patch Google's nested payload structure with translated fields.
 *
 * Google's payload shape: { model, contents, config: { generationConfig, toolConfig, ... } }
 * Fields go into config.generationConfig (camelCase) or config.toolConfig.
 *
 * Supported translations:
 * - top_p -> config.generationConfig.topP (camelCase, nested)
 * - stop -> config.generationConfig.stopSequences (array, nested)
 * - seed -> config.generationConfig.seed (nested)
 * - frequency_penalty -> config.generationConfig.frequencyPenalty (nested)
 * - presence_penalty -> config.generationConfig.presencePenalty (nested)
 * - tool_choice -> config.toolConfig.functionCallingConfig.mode (nested)
 *
 * Not supported (silently skipped):
 * - response_format, metadata, prediction, parallel_tool_calls, user
 *
 * @internal Exported for unit testing only.
 */
export function patchGooglePayload(
	payload: Record<string, unknown>,
	request: ChatCompletionRequest,
): boolean {
	let patched = false;

	// Access or create config.generationConfig
	const config = isRecord(payload["config"]) ? payload["config"] : undefined;
	if (config === undefined) {
		return false;
	}

	// Ensure generationConfig exists
	let genConfig = isRecord(config["generationConfig"]) ? config["generationConfig"] : undefined;

	if (request.top_p !== undefined) {
		genConfig ??= {};
		genConfig["topP"] = request.top_p;
		patched = true;
	}
	if (request.stop !== undefined) {
		genConfig ??= {};
		const sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
		genConfig["stopSequences"] = sequences;
		patched = true;
	}
	if (request.seed !== undefined) {
		genConfig ??= {};
		genConfig["seed"] = request.seed;
		patched = true;
	}
	if (request.frequency_penalty !== undefined) {
		genConfig ??= {};
		genConfig["frequencyPenalty"] = request.frequency_penalty;
		patched = true;
	}
	if (request.presence_penalty !== undefined) {
		genConfig ??= {};
		genConfig["presencePenalty"] = request.presence_penalty;
		patched = true;
	}

	if (genConfig !== undefined && patched) {
		config["generationConfig"] = genConfig;
	}

	// Tool choice -> toolConfig.functionCallingConfig.mode
	const mode = translateToolChoiceForGoogle(request.tool_choice);
	if (mode !== undefined) {
		let toolConfig = isRecord(config["toolConfig"]) ? config["toolConfig"] : undefined;
		toolConfig ??= {};
		let funcConfig = isRecord(toolConfig["functionCallingConfig"])
			? toolConfig["functionCallingConfig"]
			: undefined;
		funcConfig ??= {};
		funcConfig["mode"] = mode;
		toolConfig["functionCallingConfig"] = funcConfig;
		config["toolConfig"] = toolConfig;
		patched = true;
	}

	return patched;
}

// ---------------------------------------------------------------------------
// Unified dispatch
// ---------------------------------------------------------------------------

/**
 * Collect API-specific payload fields from an OpenAI request.
 *
 * Dispatches to the appropriate translator based on the target API:
 * - OpenAI-compatible: flat field injection (same names)
 * - Anthropic: translated field names and formats
 * - Google: nested generationConfig patching (handled separately in onPayload)
 * - Others (Bedrock, Codex): no passthrough
 *
 * For Google APIs, returns undefined (patching is done directly in onPayload
 * via patchGooglePayload because the payload structure is nested).
 *
 * @internal Exported for unit testing only.
 */
export function collectPayloadFields(
	request: ChatCompletionRequest,
	api: string,
): Record<string, unknown> | undefined {
	if (OPENAI_COMPATIBLE_APIS.has(api)) {
		return collectOpenAIPayloadFields(request);
	}
	if (ANTHROPIC_APIS.has(api)) {
		return collectAnthropicPayloadFields(request);
	}
	// Google and others: no flat field collection
	// (Google uses patchGooglePayload directly in the onPayload callback)
	return undefined;
}

/**
 * Whether the given API requires Google-style nested payload patching.
 */
function isGoogleApi(api: string): boolean {
	return GOOGLE_APIS.has(api);
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
	const needsGooglePatch = isGoogleApi(model.api);

	if (payloadFields !== undefined || strictFlags !== undefined || needsGooglePatch) {
		opts.onPayload = (payload: unknown) => {
			if (isRecord(payload)) {
				// Flat field injection (OpenAI-compatible and Anthropic)
				if (payloadFields !== undefined) {
					for (const [key, value] of Object.entries(payloadFields)) {
						payload[key] = value;
					}
				}
				// Google nested generationConfig patching
				if (needsGooglePatch) {
					patchGooglePayload(payload, request);
				}
				// Tool strict flag patching (OpenAI-compatible only)
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
