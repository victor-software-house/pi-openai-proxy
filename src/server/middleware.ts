/**
 * Hono middleware: request ID injection, proxy auth, body size limits, structured logging.
 */

import type { ServerConfig } from "@proxy/config/env";
import { authenticationError, invalidRequest } from "@proxy/server/errors";
import { logDisconnect, logRequest, logResponse } from "@proxy/server/logging";
import { generateRequestId } from "@proxy/server/request-id";
import type { ProxyEnv } from "@proxy/server/types";
import type { MiddlewareHandler } from "hono";

const DEFAULT_CORS_ALLOW_HEADERS = [
	"authorization",
	"content-type",
	"x-client-request-id",
	"x-pi-upstream-api-key",
].join(", ");

const CORS_EXPOSE_HEADERS = ["x-request-id", "x-client-request-id"].join(", ");

/**
 * CORS middleware for OpenAI-compatible browser clients.
 * Handles preflight before proxy auth so Authorization-bearing clients can connect.
 */
export function corsMiddleware(): MiddlewareHandler<ProxyEnv> {
	return async (c, next) => {
		const origin = c.req.header("origin");
		const requestedHeaders = c.req.header("access-control-request-headers");
		const privateNetwork = c.req.header("access-control-request-private-network");

		c.header("access-control-allow-origin", origin ?? "*");
		c.header("access-control-allow-methods", "GET, POST, OPTIONS");
		c.header("access-control-allow-headers", requestedHeaders ?? DEFAULT_CORS_ALLOW_HEADERS);
		c.header("access-control-expose-headers", CORS_EXPOSE_HEADERS);
		c.header("access-control-allow-credentials", "true");
		c.header("access-control-max-age", "86400");
		c.header("vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");

		if (privateNetwork === "true") {
			c.header("access-control-allow-private-network", "true");
		}

		if (c.req.method === "OPTIONS") {
			return c.body(null, 204);
		}

		await next();
		return undefined;
	};
}

/**
 * Inject request ID, upstream API key, and logging context into every request.
 */
export function requestIdMiddleware(): MiddlewareHandler<ProxyEnv> {
	return async (c, next) => {
		const requestId = generateRequestId();
		const clientRequestId = c.req.header("x-client-request-id");
		const upstreamApiKey = c.req.header("x-pi-upstream-api-key");
		const start = performance.now();

		c.set("requestId", requestId);
		c.set("clientRequestId", clientRequestId);
		c.set("upstreamApiKey", upstreamApiKey);

		logRequest({
			requestId,
			clientRequestId,
			method: c.req.method,
			path: c.req.path,
		});

		// Set response headers
		c.header("x-request-id", requestId);
		if (clientRequestId !== undefined) {
			c.header("x-client-request-id", clientRequestId);
		}

		await next();

		const duration = performance.now() - start;
		logResponse(
			{ requestId, clientRequestId, method: c.req.method, path: c.req.path },
			c.res.status,
			duration,
		);
	};
}

/**
 * Optional proxy auth middleware.
 * Only active when PI_PROXY_AUTH_TOKEN is set.
 */
export function proxyAuthMiddleware(config: ServerConfig): MiddlewareHandler<ProxyEnv> {
	return async (c, next) => {
		if (config.proxyAuthToken === undefined) {
			await next();
			return;
		}

		const authHeader = c.req.header("authorization");
		if (authHeader === undefined) {
			return c.json(authenticationError("Missing Authorization header"), 401);
		}

		const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

		if (token !== config.proxyAuthToken) {
			return c.json(authenticationError("Invalid proxy authentication token"), 401);
		}

		await next();
		return undefined;
	};
}

/**
 * Client disconnect detection middleware.
 * Creates an AbortController for upstream cancellation.
 */
export function disconnectMiddleware(): MiddlewareHandler<ProxyEnv> {
	return async (c, next) => {
		const controller = new AbortController();
		c.set("abortController", controller);

		// Listen for client disconnect via the request signal
		const reqSignal = c.req.raw.signal;
		if (reqSignal !== undefined) {
			const onAbort = () => {
				const requestId = c.get("requestId");
				logDisconnect({
					requestId,
					method: c.req.method,
					path: c.req.path,
				});
				controller.abort();
			};
			if (reqSignal.aborted) {
				onAbort();
			} else {
				reqSignal.addEventListener("abort", onAbort, { once: true });
			}
		}

		await next();
	};
}

/**
 * Request body size limit middleware.
 * Rejects requests with Content-Length exceeding the configured maximum.
 * Only applies to POST/PUT/PATCH methods.
 */
export function bodySizeLimitMiddleware(config: ServerConfig): MiddlewareHandler<ProxyEnv> {
	return async (c, next) => {
		const method = c.req.method;
		if (method !== "POST" && method !== "PUT" && method !== "PATCH") {
			await next();
			return;
		}

		const contentLength = c.req.header("content-length");
		if (contentLength !== undefined) {
			const length = Number.parseInt(contentLength, 10);
			if (Number.isFinite(length) && length > config.maxBodySize) {
				return c.json(
					invalidRequest(
						`Request body too large. Maximum size: ${String(config.maxBodySize)} bytes`,
					),
					413,
				);
			}
		}

		await next();
		return undefined;
	};
}
