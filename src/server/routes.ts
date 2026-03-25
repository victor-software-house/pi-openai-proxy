/**
 * Hono route handlers for the OpenAI-compatible proxy endpoints.
 *
 * Stable endpoints:
 * - GET  /v1/models
 * - GET  /v1/models/:model  (supports URL-encoded IDs with slashes)
 * - POST /v1/chat/completions
 */

import type { ServerConfig } from "@proxy/config/env";
import { convertMessages } from "@proxy/openai/messages";
import {
	computeModelExposure,
	type ModelExposureConfig,
	type ModelExposureResult,
	resolveExposedModel,
} from "@proxy/openai/model-exposure";
import { buildModelList, toOpenAIModel } from "@proxy/openai/models";
import { buildChatCompletion } from "@proxy/openai/responses";
import { streamToSSE } from "@proxy/openai/sse";
import { convertTools } from "@proxy/openai/tools";
import { validateChatRequest } from "@proxy/openai/validate";
import { piComplete, piStream } from "@proxy/pi/complete";
import { getAllModels, getAvailableModels, getRegistry } from "@proxy/pi/registry";
import {
	authenticationError,
	invalidRequest,
	mapUpstreamError,
	modelNotFound,
	unsupportedParameter,
} from "@proxy/server/errors";
import { logError } from "@proxy/server/logging";
import type { ProxyEnv } from "@proxy/server/types";
import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";

/**
 * Build a ModelExposureConfig from the server config.
 */
function buildExposureConfig(config: ServerConfig): ModelExposureConfig {
	return {
		publicModelIdMode: config.publicModelIdMode,
		modelExposureMode: config.modelExposureMode,
		scopedProviders: config.scopedProviders,
		customModels: config.customModels,
		providerPrefixes: config.providerPrefixes,
	};
}

/**
 * Compute or refresh the model exposure from the current registry and config.
 * Returns the exposure result or throws on config errors.
 */
function getExposure(config: ServerConfig): ModelExposureResult {
	const available = getAvailableModels();
	const allRegistered = getAllModels();
	const exposureConfig = buildExposureConfig(config);
	const outcome = computeModelExposure(available, allRegistered, exposureConfig);
	if (!outcome.ok) {
		// Config validation error -- surface as 500 to callers
		throw new Error(`Model exposure configuration error: ${outcome.message}`);
	}
	return outcome;
}

export function createRoutes(config: ServerConfig): Hono<ProxyEnv> {
	const routes = new Hono<ProxyEnv>();

	// --- GET /v1/models ---
	routes.get("/v1/models", (c) => {
		const exposure = getExposure(config);
		return c.json(buildModelList(exposure.models));
	});

	// --- GET /v1/models/:model ---
	// Use a wildcard to capture slash-containing model IDs
	routes.get("/v1/models/*", (c) => {
		const rawPath = c.req.path;
		// Strip the "/v1/models/" prefix to get the full (possibly multi-segment) model ID
		const prefix = "/v1/models/";
		if (!rawPath.startsWith(prefix)) {
			return c.json(modelNotFound(""), 404);
		}
		const modelIdEncoded = rawPath.slice(prefix.length);
		if (modelIdEncoded.length === 0) {
			// This was handled by the exact /v1/models route
			return c.json(modelNotFound(""), 404);
		}
		const modelId = decodeURIComponent(modelIdEncoded);

		const exposure = getExposure(config);
		const resolved = resolveExposedModel(exposure, modelId);
		if (resolved === undefined) {
			return c.json(modelNotFound(modelId), 404);
		}

		return c.json(toOpenAIModel(resolved));
	});

	// --- POST /v1/chat/completions ---
	routes.post("/v1/chat/completions", async (c) => {
		const requestId = c.get("requestId");
		const abortController = c.get("abortController");
		const upstreamApiKey = c.get("upstreamApiKey");

		// Parse body
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json(invalidRequest("Invalid JSON in request body"), 400);
		}

		// Validate
		const validation = validateChatRequest(body);
		if (!validation.ok) {
			if (validation.status === 422) {
				return c.json(unsupportedParameter(validation.param ?? "unknown", validation.message), 422);
			}
			return c.json(invalidRequest(validation.message, validation.param ?? undefined), 400);
		}

		const request = validation.data;

		// Resolve model through the exposure engine
		const exposure = getExposure(config);
		const resolved = resolveExposedModel(exposure, request.model);
		if (resolved === undefined) {
			return c.json(modelNotFound(request.model), 404);
		}

		const model = resolved.model;
		const canonicalModelId = resolved.canonicalId;

		// Convert messages
		const conversion = convertMessages(request.messages);
		if (!conversion.ok) {
			return c.json(invalidRequest(conversion.message, conversion.param), 400);
		}

		const context = conversion.context;

		// Convert tools if provided
		if (request.tools !== undefined && request.tools.length > 0) {
			const toolConversion = convertTools(request.tools);
			if (!toolConversion.ok) {
				return c.json(unsupportedParameter(toolConversion.param, toolConversion.message), 422);
			}
			context.tools = toolConversion.tools;
		}

		// Pre-check API key availability: if no per-request override and no
		// registry key, reject early instead of letting the provider fail silently.
		if (upstreamApiKey === undefined) {
			const registryKey = await getRegistry().getApiKey(model);
			if (registryKey === undefined) {
				return c.json(
					authenticationError(
						`No API key configured for provider '${model.provider}'. ` +
							"Configure credentials via 'pi /login' or pass X-Pi-Upstream-Api-Key header.",
					),
					401,
				);
			}
		}

		const completionOptions = {
			upstreamApiKey,
			signal: abortController.signal,
			upstreamTimeoutMs: config.upstreamTimeoutMs,
		};

		// --- Streaming ---
		if (request.stream === true) {
			const includeUsage =
				request.stream_options !== null &&
				request.stream_options !== undefined &&
				request.stream_options.include_usage === true;

			c.header("content-type", "text/event-stream");
			c.header("cache-control", "no-cache");
			c.header("connection", "keep-alive");

			return honoStream(c, async (stream) => {
				try {
					const eventStream = await piStream(model, context, request, completionOptions);

					for await (const frame of streamToSSE(
						eventStream,
						requestId,
						canonicalModelId,
						includeUsage,
					)) {
						await stream.write(frame);
					}
				} catch (err: unknown) {
					const mapped = mapUpstreamError(err);
					logError(
						{
							requestId,
							method: "POST",
							path: "/v1/chat/completions",
						},
						mapped.body.error.message,
						err instanceof Error ? err.message : undefined,
					);
					// For streams, write an error event and close
					const errorChunk = JSON.stringify({
						error: mapped.body.error,
					});
					await stream.write(`data: ${errorChunk}\n\n`);
					await stream.write("data: [DONE]\n\n");
				}
			});
		}

		// --- Non-streaming ---
		try {
			const message = await piComplete(model, context, request, completionOptions);

			// Detect upstream errors reported via stopReason
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				const errorMessage = message.errorMessage ?? "Upstream provider error";
				const mapped = mapUpstreamError(new Error(errorMessage));
				logError({ requestId, method: "POST", path: "/v1/chat/completions" }, errorMessage);
				return c.json(mapped.body, mapped.status);
			}

			return c.json(buildChatCompletion(requestId, canonicalModelId, message));
		} catch (err: unknown) {
			const mapped = mapUpstreamError(err);
			logError(
				{ requestId, method: "POST", path: "/v1/chat/completions" },
				mapped.body.error.message,
				err instanceof Error ? err.message : undefined,
			);
			return c.json(mapped.body, mapped.status);
		}
	});

	// --- Unsupported endpoints: clear errors ---
	const unsupportedEndpoints = [
		"/v1/completions",
		"/v1/embeddings",
		"/v1/audio/*",
		"/v1/images/*",
		"/v1/assistants",
		"/v1/assistants/*",
		"/v1/threads",
		"/v1/threads/*",
		"/v1/files",
		"/v1/files/*",
		"/v1/batches",
		"/v1/batches/*",
		"/v1/fine_tuning/*",
	];

	for (const path of unsupportedEndpoints) {
		routes.all(path, (c) => {
			return c.json(
				invalidRequest(`Endpoint '${c.req.path}' is not supported by this proxy`, undefined),
				404,
			);
		});
	}

	return routes;
}
