/**
 * Hono environment type for the proxy.
 * Defines typed context variables available via c.get() / c.set().
 */

export interface ProxyEnv {
	Variables: {
		requestId: string;
		clientRequestId: string | undefined;
		abortController: AbortController;
		/** Per-request upstream API key override via X-Pi-Upstream-Api-Key header. */
		upstreamApiKey: string | undefined;
	};
}
