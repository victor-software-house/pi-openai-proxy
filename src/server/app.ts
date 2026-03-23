/**
 * Hono application assembly: middleware + routes.
 */

import type { ProxyConfig } from "@proxy/config/env";
import {
	disconnectMiddleware,
	proxyAuthMiddleware,
	requestIdMiddleware,
} from "@proxy/server/middleware";
import { createRoutes } from "@proxy/server/routes";
import type { ProxyEnv } from "@proxy/server/types";
import { Hono } from "hono";

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
