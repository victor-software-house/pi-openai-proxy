/**
 * Hono route handlers for the OpenAI-compatible proxy endpoints.
 *
 * Stable endpoints:
 * - GET  /v1/models
 * - GET  /v1/models/:model  (supports URL-encoded IDs with slashes)
 * - POST /v1/chat/completions
 */

import { convertMessages } from "@proxy/openai/messages";
import { buildModelList, toOpenAIModel } from "@proxy/openai/models";
import { buildChatCompletion } from "@proxy/openai/responses";
import { streamToSSE } from "@proxy/openai/sse";
import { convertTools } from "@proxy/openai/tools";
import { validateChatRequest } from "@proxy/openai/validate";
import { piComplete, piStream } from "@proxy/pi/complete";
import { getAllModels } from "@proxy/pi/registry";
import { resolveModel } from "@proxy/pi/resolve-model";
import {
	invalidRequest,
	mapUpstreamError,
	modelNotFound,
	unsupportedParameter,
} from "@proxy/server/errors";
import { logError } from "@proxy/server/logging";
import type { ProxyEnv } from "@proxy/server/types";
import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";

export function createRoutes(): Hono<ProxyEnv> {
	const routes = new Hono<ProxyEnv>();

	// --- GET /v1/models ---
	routes.get("/v1/models", (c) => {
		const models = getAllModels();
		return c.json(buildModelList(models));
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

		const resolution = resolveModel(modelId);
		if (!resolution.ok) {
			if (resolution.status === 400) {
				return c.json(invalidRequest(resolution.message, "model"), 400);
			}
			return c.json(modelNotFound(modelId), 404);
		}

		return c.json(toOpenAIModel(resolution.model));
	});

	// --- POST /v1/chat/completions ---
	routes.post("/v1/chat/completions", async (c) => {
		const requestId = c.get("requestId");
		const abortController = c.get("abortController");

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

		// Resolve model
		const resolution = resolveModel(request.model);
		if (!resolution.ok) {
			if (resolution.status === 400) {
				return c.json(invalidRequest(resolution.message, "model"), 400);
			}
			return c.json(modelNotFound(request.model), 404);
		}

		const model = resolution.model;
		const canonicalModelId = `${model.provider}/${model.id}`;

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
					const eventStream = await piStream(model, context, request, abortController.signal);

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
			const message = await piComplete(model, context, request, abortController.signal);

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
