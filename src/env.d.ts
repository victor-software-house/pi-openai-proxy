/**
 * Typed environment variables for the proxy.
 * Allows dot-notation access without noPropertyAccessFromIndexSignature errors.
 */

declare namespace NodeJS {
	interface ProcessEnv {
		PI_PROXY_HOST?: string;
		PI_PROXY_PORT?: string;
		PI_PROXY_AUTH_TOKEN?: string;
		PI_PROXY_AGENTIC?: string;
		PI_PROXY_REMOTE_IMAGES?: string;
	}
}
