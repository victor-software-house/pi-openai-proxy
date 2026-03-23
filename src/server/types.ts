/**
 * Hono environment type for the proxy.
 * Defines typed context variables available via c.get() / c.set().
 */

export interface ProxyEnv {
	Variables: {
		requestId: string;
		clientRequestId: string | undefined;
		abortController: AbortController;
	};
}
