/**
 * Hono application assembly: middleware + routes.
 */

import { Hono } from "hono";
import type { ProxyConfig } from "../config/env.js";
import { disconnectMiddleware, proxyAuthMiddleware, requestIdMiddleware } from "./middleware.js";
import { createRoutes } from "./routes.js";
import type { ProxyEnv } from "./types.js";

export function createApp(config: ProxyConfig): Hono<ProxyEnv> {
	const app = new Hono<ProxyEnv>();

	// Global middleware
	app.use("*", requestIdMiddleware());
	app.use("*", disconnectMiddleware());
	app.use("/v1/*", proxyAuthMiddleware(config));

	// Routes
	app.route("/", createRoutes());

	return app;
}
