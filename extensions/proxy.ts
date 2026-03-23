/**
 * Pi extension: /proxy command and --proxy flag.
 *
 * Manages the pi-openai-proxy server from inside a pi session.
 *
 * - /proxy          Show status
 * - /proxy start    Start the proxy server
 * - /proxy stop     Stop the proxy server (session-managed only)
 * - /proxy status   Show status
 * - --proxy         Auto-start on session start
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default function proxyExtension(pi: ExtensionAPI) {
	let proxyProcess: ChildProcess | undefined;

	const host = process.env["PI_PROXY_HOST"] ?? "127.0.0.1";
	const port = process.env["PI_PROXY_PORT"] ?? "4141";
	const proxyUrl = `http://${host}:${port}`;

	const extensionDir = dirname(fileURLToPath(import.meta.url));
	const packageRoot = resolve(extensionDir, "..");
	const proxyEntry = resolve(packageRoot, "dist", "index.mjs");

	// --- Flag: --proxy ---

	pi.registerFlag("proxy", {
		description: "Start the OpenAI proxy on session start",
		type: "boolean",
		default: false,
	});

	// --- Lifecycle ---

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("--proxy")) {
			await startProxy(ctx);
		} else {
			await refreshStatus(ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		killProxy();
	});

	// --- Command: /proxy ---

	pi.registerCommand("proxy", {
		description: "Manage the OpenAI-compatible proxy (start/stop/status)",
		getArgumentCompletions: (prefix) => {
			const subs = [
				{ value: "start", label: "Start the proxy server" },
				{ value: "stop", label: "Stop the proxy server" },
				{ value: "status", label: "Show proxy status" },
			];
			if (prefix.length === 0) return subs;
			return subs.filter((s) => s.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "";

			switch (sub) {
				case "":
				case "status":
					await showStatus(ctx);
					break;
				case "start":
					await startProxy(ctx);
					break;
				case "stop":
					await stopProxy(ctx);
					break;
				default:
					ctx.ui.notify("/proxy [start|stop|status]", "info");
			}
		},
	});

	// --- Proxy management ---

	async function probe(): Promise<{ reachable: boolean; models: number }> {
		try {
			const res = await fetch(`${proxyUrl}/v1/models`, {
				signal: AbortSignal.timeout(2000),
			});
			if (res.ok) {
				const body = (await res.json()) as { data?: unknown[] };
				return { reachable: true, models: body.data?.length ?? 0 };
			}
		} catch {
			// not reachable
		}
		return { reachable: false, models: 0 };
	}

	async function refreshStatus(ctx: ExtensionContext): Promise<void> {
		const status = await probe();
		if (status.reachable) {
			ctx.ui.setStatus("proxy", `proxy: ${proxyUrl} (${String(status.models)} models)`);
		} else if (proxyProcess !== undefined) {
			ctx.ui.setStatus("proxy", "proxy: starting...");
		} else {
			ctx.ui.setStatus("proxy", undefined);
		}
	}

	async function startProxy(ctx: ExtensionContext): Promise<void> {
		const status = await probe();
		if (status.reachable) {
			ctx.ui.notify(
				`Proxy already running at ${proxyUrl} (${String(status.models)} models)`,
				"info",
			);
			await refreshStatus(ctx);
			return;
		}

		if (proxyProcess !== undefined) {
			ctx.ui.notify("Proxy is already starting...", "info");
			return;
		}

		ctx.ui.setStatus("proxy", "proxy: starting...");

		try {
			proxyProcess = spawn("bun", ["run", proxyEntry], {
				stdio: ["ignore", "pipe", "pipe"],
				detached: false,
				env: { ...process.env },
			});

			proxyProcess.on("exit", (code) => {
				proxyProcess = undefined;
				if (code !== null && code !== 0) {
					ctx.ui.notify(`Proxy exited with code ${String(code)}`, "warning");
				}
				ctx.ui.setStatus("proxy", undefined);
			});

			proxyProcess.on("error", (err) => {
				proxyProcess = undefined;
				ctx.ui.notify(`Failed to start proxy: ${err.message}`, "error");
				ctx.ui.setStatus("proxy", undefined);
			});

			// Wait for the server to become reachable
			const ready = await waitForReady(3000);
			if (ready.reachable) {
				ctx.ui.notify(
					`Proxy started at ${proxyUrl} (${String(ready.models)} models)`,
					"info",
				);
			} else {
				ctx.ui.notify(`Proxy spawned but not yet reachable at ${proxyUrl}`, "warning");
			}
			await refreshStatus(ctx);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Failed to start proxy: ${message}`, "error");
			ctx.ui.setStatus("proxy", undefined);
		}
	}

	async function stopProxy(ctx: ExtensionContext): Promise<void> {
		if (proxyProcess !== undefined) {
			killProxy();
			ctx.ui.notify("Proxy stopped", "info");
			ctx.ui.setStatus("proxy", undefined);
			return;
		}

		const status = await probe();
		if (status.reachable) {
			ctx.ui.notify(
				`Proxy at ${proxyUrl} is running externally (not managed by this session)`,
				"info",
			);
		} else {
			ctx.ui.notify("Proxy is not running", "info");
		}
	}

	async function showStatus(ctx: ExtensionContext): Promise<void> {
		const status = await probe();
		const managed = proxyProcess !== undefined ? " (managed)" : " (external)";

		if (status.reachable) {
			ctx.ui.notify(
				`${proxyUrl}${managed} -- ${String(status.models)} models available`,
				"info",
			);
		} else {
			ctx.ui.notify("Proxy not running. Use /proxy start or pi --proxy", "info");
		}
		await refreshStatus(ctx);
	}

	function killProxy(): void {
		if (proxyProcess !== undefined) {
			proxyProcess.kill("SIGTERM");
			proxyProcess = undefined;
		}
	}

	async function waitForReady(
		timeoutMs: number,
	): Promise<{ reachable: boolean; models: number }> {
		const start = Date.now();
		const interval = 300;
		while (Date.now() - start < timeoutMs) {
			const status = await probe();
			if (status.reachable) return status;
			await new Promise((r) => setTimeout(r, interval));
		}
		return { reachable: false, models: 0 };
	}
}
