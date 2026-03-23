/**
 * Request validation: parse and reject unsupported fields.
 *
 * Phase 0 contract: unknown fields -> 422
 */

import {
	type ChatCompletionRequest,
	chatCompletionRequestSchema,
	phase1RejectedFields,
} from "@proxy/openai/schemas";

export interface ValidationSuccess {
	readonly ok: true;
	readonly data: ChatCompletionRequest;
}

export interface ValidationError {
	readonly ok: false;
	readonly status: number;
	readonly message: string;
	readonly param: string | null;
}

export type ValidationResult = ValidationSuccess | ValidationError;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate a raw request body against the Phase 1 schema.
 *
 * Also checks for known rejected fields to give friendly errors.
 */
export function validateChatRequest(body: unknown): ValidationResult {
	// Check for Phase 1 rejected fields before schema parsing
	if (isRecord(body)) {
		for (const field of phase1RejectedFields) {
			if (body[field] !== undefined) {
				return {
					ok: false,
					status: 422,
					message: `'${field}' is not supported in this version of the proxy`,
					param: field,
				};
			}
		}
	}

	const result = chatCompletionRequestSchema.safeParse(body);

	if (result.success) {
		return { ok: true, data: result.data };
	}

	// Extract the first Zod error for a clean message
	const firstIssue = result.error.issues[0];
	if (firstIssue !== undefined) {
		const path = firstIssue.path.join(".");
		if (firstIssue.code === "unrecognized_keys") {
			return {
				ok: false,
				status: 422,
				message: `Unknown parameter(s): ${firstIssue.keys.join(", ")}`,
				param: firstIssue.keys[0] ?? null,
			};
		}
		return {
			ok: false,
			status: 400,
			message: `Invalid value for '${path}': ${firstIssue.message}`,
			param: path.length > 0 ? path : null,
		};
	}

	return {
		ok: false,
		status: 400,
		message: "Invalid request body",
		param: null,
	};
}
