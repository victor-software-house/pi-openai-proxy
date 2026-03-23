/**
 * Hono middleware: request ID injection, proxy auth, body size limits, structured logging.
 */

import type { ProxyConfig } from "@proxy/config/env";
import { authenticationError, invalidRequest } from "@proxy/server/errors";
import { logDisconnect, logRequest, logResponse } from "@proxy/server/logging";
import { generateRequestId } from "@proxy/server/request-id";
import type { ProxyEnv } from "@proxy/server/types";
import type { MiddlewareHandler } from "hono";

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
export function proxyAuthMiddleware(config: ProxyConfig): MiddlewareHandler<ProxyEnv> {
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
export function bodySizeLimitMiddleware(config: ProxyConfig): MiddlewareHandler<ProxyEnv> {
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
