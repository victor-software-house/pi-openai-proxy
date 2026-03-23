/**
 * Environment and configuration loading.
 *
 * Phase 0 contract decisions embedded here:
 * - Bind to 127.0.0.1 by default (safe for local use)
 * - Default port 4141
 * - Proxy auth disabled by default
 * - Agentic mode disabled by default
 * - Remote image URLs disabled by default
 */

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
}

export function loadConfig(): ProxyConfig {
	return {
		host: process.env["PI_PROXY_HOST"] ?? "127.0.0.1",
		port: Number.parseInt(process.env["PI_PROXY_PORT"] ?? "4141", 10),
		proxyAuthToken: process.env["PI_PROXY_AUTH_TOKEN"],
		agenticEnabled: process.env["PI_PROXY_AGENTIC"] === "true",
		remoteImagesEnabled: process.env["PI_PROXY_REMOTE_IMAGES"] === "true",
	};
}
