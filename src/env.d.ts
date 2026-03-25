/**
 * Typed environment variables for the proxy.
 * Allows dot-notation access without noPropertyAccessFromIndexSignature errors.
 */

declare namespace NodeJS {
	interface ProcessEnv {
		HOME?: string | undefined;
		XDG_CONFIG_HOME?: string | undefined;
		CUSTOM_DATA_DIR?: string | undefined;
		PI_CODING_AGENT_DIR?: string | undefined;
		PI_PROXY_HOST?: string | undefined;
		PI_PROXY_PORT?: string | undefined;
		PI_PROXY_AUTH_TOKEN?: string | undefined;
		PI_PROXY_AGENTIC?: string | undefined;
		PI_PROXY_REMOTE_IMAGES?: string | undefined;
		PI_PROXY_MAX_BODY_SIZE?: string | undefined;
		PI_PROXY_UPSTREAM_TIMEOUT_MS?: string | undefined;
	}
}
