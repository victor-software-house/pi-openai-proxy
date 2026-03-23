/**
 * OpenAI-compatible error response helpers.
 *
 * Phase 0 contract: Error shape is:
 * { error: { message, type, param, code } }
 *
 * Status code mapping:
 * - 400: invalid request, ambiguous shorthand
 * - 401: proxy auth failure, missing upstream credential
 * - 404: model not found
 * - 422: unsupported parameter, unsupported content
 * - 429: upstream rate limit
 * - 500: internal proxy failure
 * - 502: malformed upstream response
 * - 503: provider unavailable
 * - 504: upstream timeout
 */

export interface OpenAIError {
	readonly error: {
		readonly message: string;
		readonly type: string;
		readonly param: string | null;
		readonly code: string | null;
	};
}

export function makeError(
	message: string,
	type: string,
	param: string | null,
	code: string | null,
): OpenAIError {
	return {
		error: { message, type, param, code },
	};
}

export function invalidRequest(message: string, param?: string): OpenAIError {
	return makeError(message, "invalid_request_error", param ?? null, null);
}

export function modelNotFound(modelId: string): OpenAIError {
	return makeError(
		`The model '${modelId}' does not exist`,
		"invalid_request_error",
		"model",
		"model_not_found",
	);
}

export function unsupportedParameter(param: string, message?: string): OpenAIError {
	return makeError(
		message ?? `Unsupported parameter: '${param}'`,
		"invalid_request_error",
		param,
		"unsupported_parameter",
	);
}

export function authenticationError(message: string): OpenAIError {
	return makeError(message, "authentication_error", null, null);
}

export function upstreamError(message: string, code?: string): OpenAIError {
	return makeError(message, "server_error", null, code ?? "upstream_error");
}

export function internalError(message: string): OpenAIError {
	return makeError(message, "server_error", null, "internal_error");
}

/**
 * Map an upstream provider error into appropriate status + error body.
 * Never leaks secrets.
 */
export function mapUpstreamError(err: unknown): { status: number; body: OpenAIError } {
	const message = err instanceof Error ? err.message : "Unknown upstream error";

	// Detect rate-limiting
	if (message.includes("rate") && message.includes("limit")) {
		return { status: 429, body: upstreamError("Upstream rate limit exceeded", "rate_limit") };
	}

	// Detect timeout
	if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
		return { status: 504, body: upstreamError("Upstream request timed out", "timeout") };
	}

	// Detect auth
	if (message.includes("401") || message.includes("403") || message.includes("Unauthorized")) {
		return {
			status: 502,
			body: upstreamError("Upstream authentication failed", "upstream_auth_error"),
		};
	}

	// Detect overloaded
	if (message.includes("529") || message.includes("overloaded")) {
		return {
			status: 503,
			body: upstreamError("Upstream provider is overloaded", "provider_overloaded"),
		};
	}

	return { status: 502, body: upstreamError("Upstream provider error") };
}
