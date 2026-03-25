import type { ServerConfig } from "@proxy/config/env";
import { createApp } from "@proxy/server/app";
import type { ExposureConfigReader } from "@proxy/server/routes";

/**
 * Parse JSON response body for test assertions.
 *
 * Returns `any` so tests can use dot notation on unknown response shapes.
 * This is intentional -- test files assert on response structure, not type it.
 */

// biome-ignore lint/suspicious/noExplicitAny: test helper for response assertion
export async function jsonBody(res: Response): Promise<any> {
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
		scopedProviders: [],
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
		scopedProviders: c.scopedProviders,
		customModels: c.customModels,
		providerPrefixes: c.providerPrefixes,
	});
	return createApp(c, reader);
}
