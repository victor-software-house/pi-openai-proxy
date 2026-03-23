/**
 * pi-proxy entry point.
 *
 * Proper CLI with citty: args, help, version.
 * Config priority: CLI args > env vars > JSON config file > defaults.
 */

import { type CliOverrides, loadConfig } from "@proxy/config/env";
import { getConfigPath, loadConfigFromFile } from "@proxy/config/schema";
import { getAvailableModels, initRegistry } from "@proxy/pi/registry";
import { createApp } from "@proxy/server/app";
import { logShutdown, logStartup } from "@proxy/server/logging";
import { defineCommand, runMain } from "citty";

const main = defineCommand({
	meta: {
		name: "pi-proxy",
		description: "OpenAI-compatible HTTP proxy for pi's multi-provider model registry",
	},
	args: {
		host: {
			type: "string",
			description: "Bind address (default: from config or 127.0.0.1)",
		},
		port: {
			type: "string",
			description: "Listen port (default: from config or 4141)",
		},
		"auth-token": {
			type: "string",
			description: "Bearer token for proxy authentication",
		},
		"remote-images": {
			type: "boolean",
			description: "Enable remote image URL fetching",
		},
		"max-body-size": {
			type: "string",
			description: "Maximum request body size in MB (default: 50)",
		},
		"upstream-timeout": {
			type: "string",
			description: "Upstream timeout in seconds (default: 120)",
		},
		config: {
			type: "boolean",
			description: "Show effective configuration and exit",
		},
	},
	run: async ({ args }) => {
		// --config: show effective config and exit
		if (args.config === true) {
			const file = loadConfigFromFile();
			console.error(`Config file: ${getConfigPath()}`);
			console.error(JSON.stringify(file, null, 2));
			return;
		}

		// Build CLI overrides from parsed args
		const cli: CliOverrides = {};
		if (args.host !== undefined) {
			cli.host = args.host;
		}
		if (args.port !== undefined) {
			const p = Number.parseInt(args.port, 10);
			if (Number.isFinite(p) && p > 0) cli.port = p;
		}
		if (args["auth-token"] !== undefined) {
			cli.authToken = args["auth-token"];
		}
		if (args["remote-images"] !== undefined) {
			cli.remoteImages = args["remote-images"];
		}
		if (args["max-body-size"] !== undefined) {
			const mb = Number.parseInt(args["max-body-size"], 10);
			if (Number.isFinite(mb) && mb > 0) cli.maxBodySizeMb = mb;
		}
		if (args["upstream-timeout"] !== undefined) {
			const sec = Number.parseInt(args["upstream-timeout"], 10);
			if (Number.isFinite(sec) && sec > 0) cli.upstreamTimeoutSec = sec;
		}

		const config = loadConfig(cli);

		// Initialize pi integration
		const loadError = initRegistry();
		if (loadError !== undefined) {
			console.error(`[warn] models.json load error: ${loadError}`);
			console.error("[warn] Continuing with built-in models only.");
		}

		const models = getAvailableModels();
		const app = createApp(config);

		logStartup(config.host, config.port, models.length);

		console.error(
			`pi-proxy listening on http://${config.host}:${String(config.port)} (${String(models.length)} models)`,
		);

		// --- Graceful shutdown ---
		let shutdownInitiated = false;

		function handleShutdown(signal: string): void {
			if (shutdownInitiated) return;
			shutdownInitiated = true;

			logShutdown(signal);
			console.error(`[info] Received ${signal}, shutting down gracefully...`);

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
			idleTimeout: 255,
		});
	},
});

void runMain(main);
