/**
 * Environment and configuration loading.
 *
 * Defaults:
 * - Bind to 127.0.0.1 (safe for local use)
 * - Port 4141
 * - Proxy auth disabled
 * - Agentic mode disabled
 * - Remote image URLs disabled
 * - 50 MB request body limit
 * - 120s upstream timeout
 */

/** Default request body size limit: 50 MB (accommodates base64 image payloads). */
const DEFAULT_MAX_BODY_SIZE = 50 * 1024 * 1024;

/** Default upstream request timeout: 120 seconds. */
const DEFAULT_UPSTREAM_TIMEOUT_MS = 120_000;

export interface ProxyConfig {
	/** Host to bind to. Default: "127.0.0.1" */
	readonly host: string;
	/** Port to listen on. Default: 4141 */
	readonly port: number;
	/** Optional proxy auth bearer token. Undefined = no auth. */
	readonly proxyAuthToken: string | undefined;
	/** Whether agentic mode is enabled. Default: false */
	readonly agenticEnabled: boolean;
	/** Whether remote image URL fetching is enabled. Default: false */
	readonly remoteImagesEnabled: boolean;
	/** Maximum request body size in bytes. Default: 50 MB */
	readonly maxBodySize: number;
	/** Upstream request timeout in milliseconds. Default: 120000 */
	readonly upstreamTimeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (raw === undefined) return fallback;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return n;
}

export function loadConfig(): ProxyConfig {
	return {
		host: process.env.PI_PROXY_HOST ?? "127.0.0.1",
		port: Number.parseInt(process.env.PI_PROXY_PORT ?? "4141", 10),
		proxyAuthToken: process.env.PI_PROXY_AUTH_TOKEN,
		agenticEnabled: process.env.PI_PROXY_AGENTIC === "true",
		remoteImagesEnabled: process.env.PI_PROXY_REMOTE_IMAGES === "true",
		maxBodySize: parsePositiveInt(process.env.PI_PROXY_MAX_BODY_SIZE, DEFAULT_MAX_BODY_SIZE),
		upstreamTimeoutMs: parsePositiveInt(
			process.env.PI_PROXY_UPSTREAM_TIMEOUT_MS,
			DEFAULT_UPSTREAM_TIMEOUT_MS,
		),
	};
}
