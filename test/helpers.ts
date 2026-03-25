import type { ServerConfig } from "@proxy/config/env";
import { createApp } from "@proxy/server/app";
import type { ExposureConfigReader } from "@proxy/server/routes";
import { isRecord } from "@proxy/utils/guards";

// ---------------------------------------------------------------------------
// OpenAI model list response shape (used across integration tests)
// ---------------------------------------------------------------------------

interface OpenAIModelObject {
	readonly id: string;
	readonly object: string;
	readonly created: number;
	readonly owned_by: string;
}

export interface OpenAIModelListBody {
	readonly object: string;
	readonly data: readonly OpenAIModelObject[];
}

export interface OpenAIErrorBody {
	readonly error: {
		readonly message: string;
		readonly type: string;
		readonly code: string | null;
	};
}

/**
 * Narrow an unknown JSON body to an OpenAI model list shape.
 */
export function isModelListBody(value: unknown): value is OpenAIModelListBody {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value["data"])) return false;
	return value["object"] === "list";
}

/**
 * Narrow an unknown JSON body to an OpenAI error shape.
 */
export function isErrorBody(value: unknown): value is OpenAIErrorBody {
	if (!isRecord(value)) return false;
	const err = value["error"];
	if (!isRecord(err)) return false;
	if (typeof err["message"] !== "string") return false;
	// code can be string or null in OpenAI error responses
	const code = err["code"];
	return typeof code === "string" || code === null;
}

/**
 * Narrow to an OpenAI model object (single model detail).
 */
export function isModelObject(value: unknown): value is OpenAIModelObject {
	if (!isRecord(value)) return false;
	return typeof value["id"] === "string" && value["object"] === "model";
}

/**
 * Narrow to an error-like response with at least `error.message`.
 * Looser than `isErrorBody` -- used when only `.message` is checked.
 */
export interface OpenAIErrorLike {
	readonly error: {
		readonly message: string;
		readonly [key: string]: unknown;
	};
}

export function isErrorLike(value: unknown): value is OpenAIErrorLike {
	if (!isRecord(value)) return false;
	const err = value["error"];
	if (!isRecord(err)) return false;
	return typeof err["message"] === "string";
}

/**
 * Parse JSON response body for test assertions.
 * Returns `unknown` -- callers must narrow with type guards.
 */
export async function jsonBody(res: Response): Promise<unknown> {
	return res.json();
}

/**
 * Build a test-safe ServerConfig that does not read from the user's config file.
 * Auth is disabled, defaults are used for all settings.
 */
export function testConfig(): ServerConfig {
	return {
		host: "127.0.0.1",
		port: 4141,
		proxyAuthToken: undefined,
		agenticEnabled: false,
		remoteImagesEnabled: false,
		maxBodySize: 52428800,
		upstreamTimeoutMs: 120000,
		publicModelIdMode: "collision-prefixed",
		modelExposureMode: "scoped",
		customModels: [],
		providerPrefixes: {},
	};
}

/**
 * Create a test app that uses the given ServerConfig for both server
 * settings and exposure config. Never reads from the user's config file.
 */
export function testApp(config?: ServerConfig): ReturnType<typeof createApp> {
	const c = config ?? testConfig();
	const reader: ExposureConfigReader = () => ({
		publicModelIdMode: c.publicModelIdMode,
		modelExposureMode: c.modelExposureMode,
		enabledModels: undefined,
		customModels: c.customModels,
		providerPrefixes: c.providerPrefixes,
	});
	return createApp(c, reader);
}
