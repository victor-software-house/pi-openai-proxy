/**
 * Server configuration loading.
 *
 * Priority: CLI args > env vars > JSON config file > defaults.
 *
 * The JSON config file (~/.pi/agent/proxy-config.json) is the shared config
 * written by the pi extension's /proxy config panel. Env vars and CLI args
 * override it for one-off adjustments or container use.
 */

import type { ModelExposureMode, PublicModelIdMode } from "@proxy/config/schema";
import { loadConfigFromFile } from "@proxy/config/schema";

export interface ServerConfig {
	/** Host to bind to. */
	readonly host: string;
	/** Port to listen on. */
	readonly port: number;
	/** Optional proxy auth bearer token. Undefined = no auth. */
	readonly proxyAuthToken: string | undefined;
	/** Whether agentic mode is enabled. */
	readonly agenticEnabled: boolean;
	/** Whether remote image URL fetching is enabled. */
	readonly remoteImagesEnabled: boolean;
	/** Maximum request body size in bytes. */
	readonly maxBodySize: number;
	/** Upstream request timeout in milliseconds. */
	readonly upstreamTimeoutMs: number;
	/** How public model IDs are generated. */
	readonly publicModelIdMode: PublicModelIdMode;
	/** Which models are exposed. */
	readonly modelExposureMode: ModelExposureMode;
	/** Provider keys for "scoped" exposure mode. */
	readonly scopedProviders: readonly string[];
	/** Canonical model IDs for "custom" exposure mode. */
	readonly customModels: readonly string[];
	/** Provider key -> custom public prefix label. */
	readonly providerPrefixes: Readonly<Record<string, string>>;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (raw === undefined) return fallback;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return n;
}

export interface CliOverrides {
	host?: string | undefined;
	port?: number | undefined;
	authToken?: string | undefined;
	remoteImages?: boolean | undefined;
	maxBodySizeMb?: number | undefined;
	upstreamTimeoutSec?: number | undefined;
}

/**
 * Load config with priority: CLI args > env vars > JSON file > defaults.
 */
export function loadConfig(cli: CliOverrides = {}): ServerConfig {
	const file = loadConfigFromFile();

	const host = cli.host ?? process.env.PI_PROXY_HOST ?? file.host;
	const port = cli.port ?? parsePositiveInt(process.env.PI_PROXY_PORT, file.port);

	// Auth token: CLI > env > file (empty string in file = disabled)
	const fileToken = file.authToken.length > 0 ? file.authToken : undefined;
	const proxyAuthToken = cli.authToken ?? process.env.PI_PROXY_AUTH_TOKEN ?? fileToken;

	const remoteImagesEnabled =
		cli.remoteImages ??
		(process.env.PI_PROXY_REMOTE_IMAGES !== undefined
			? process.env.PI_PROXY_REMOTE_IMAGES === "true"
			: file.remoteImages);

	const maxBodySize =
		cli.maxBodySizeMb !== undefined
			? cli.maxBodySizeMb * 1024 * 1024
			: parsePositiveInt(process.env.PI_PROXY_MAX_BODY_SIZE, file.maxBodySizeMb * 1024 * 1024);

	const upstreamTimeoutMs =
		cli.upstreamTimeoutSec !== undefined
			? cli.upstreamTimeoutSec * 1000
			: parsePositiveInt(process.env.PI_PROXY_UPSTREAM_TIMEOUT_MS, file.upstreamTimeoutSec * 1000);

	const agenticEnabled = process.env.PI_PROXY_AGENTIC === "true";

	return {
		host,
		port,
		proxyAuthToken,
		agenticEnabled,
		remoteImagesEnabled,
		maxBodySize,
		upstreamTimeoutMs,
		publicModelIdMode: file.publicModelIdMode,
		modelExposureMode: file.modelExposureMode,
		scopedProviders: file.scopedProviders,
		customModels: file.customModels,
		providerPrefixes: file.providerPrefixes,
	};
}
