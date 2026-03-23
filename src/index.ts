/**
 * pi-openai-proxy entry point.
 *
 * Initializes the pi model registry, creates the Hono app, and starts serving.
 */

import { loadConfig } from "@proxy/config/env";
import { getAllModels, initRegistry } from "@proxy/pi/registry";
import { createApp } from "@proxy/server/app";
import { logStartup } from "@proxy/server/logging";

const config = loadConfig();

// Initialize pi integration
const loadError = initRegistry();
if (loadError !== undefined) {
	console.error(`[warn] models.json load error: ${loadError}`);
	console.error("[warn] Continuing with built-in models only.");
}

const models = getAllModels();
const app = createApp(config);

logStartup(config.host, config.port, models.length);

console.error(
	`pi-openai-proxy listening on http://${config.host}:${String(config.port)} (${String(models.length)} models)`,
);

export default {
	port: config.port,
	hostname: config.host,
	fetch: app.fetch,
};
