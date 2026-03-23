/**
 * pi-openai-proxy entry point.
 *
 * Initializes the pi model registry, creates the Hono app, and starts serving.
 * Implements graceful shutdown on SIGTERM/SIGINT.
 */

import { loadConfig } from "@proxy/config/env";
import { getAllModels, initRegistry } from "@proxy/pi/registry";
import { createApp } from "@proxy/server/app";
import { logShutdown, logStartup } from "@proxy/server/logging";

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

// --- Graceful shutdown ---
let shutdownInitiated = false;

function handleShutdown(signal: string): void {
	if (shutdownInitiated) return;
	shutdownInitiated = true;

	logShutdown(signal);
	console.error(`[info] Received ${signal}, shutting down gracefully...`);

	// Bun.serve's stop() closes the listening socket and lets in-flight requests finish.
	// Set a hard deadline so the process exits even if streams hang.
	const SHUTDOWN_TIMEOUT_MS = 10_000;

	if (server !== undefined) {
		void server.stop();
	}

	setTimeout(() => {
		console.error("[warn] Shutdown timeout reached, forcing exit");
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

const server = Bun.serve({
	port: config.port,
	hostname: config.host,
	fetch: app.fetch,
});

export default server;
