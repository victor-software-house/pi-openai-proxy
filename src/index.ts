/**
 * pi-openai-proxy entry point.
 *
 * Initializes the pi model registry, creates the Hono app, and starts serving.
 */

import { loadConfig } from "./config/env.js";
import { getAllModels, initRegistry } from "./pi/registry.js";
import { createApp } from "./server/app.js";
import { logStartup } from "./server/logging.js";

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
