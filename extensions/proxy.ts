/**
 * Pi extension: /proxy command family with config panel.
 *
 * Command family:
 *   /proxy            Open settings panel
 *   /proxy start      Start the proxy server
 *   /proxy stop       Stop the proxy server (session-managed only)
 *   /proxy status     Show proxy status
 *   /proxy config     Open settings panel (alias)
 *   /proxy show       Summarize current config
 *   /proxy path       Show config file location
 *   /proxy reset      Restore default settings
 *   /proxy help       Usage line
 */

import {
	getSettingsListTheme,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, SettingsList, Text, type SettingItem } from "@mariozechner/pi-tui";
import { spawn, type ChildProcess } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProxyConfig {
	host: string;
	port: number;
	authToken: string;
	remoteImages: boolean;
	maxBodySizeMb: number;
	upstreamTimeoutSec: number;
	/** "detached" = daemon that outlives the session, "session" = dies with the session */
	lifetime: "detached" | "session";
}

interface RuntimeStatus {
	reachable: boolean;
	models: number;
}

// ---------------------------------------------------------------------------
// Defaults and normalization
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ProxyConfig = {
	host: "127.0.0.1",
	port: 4141,
	authToken: "",
	remoteImages: false,
	maxBodySizeMb: 50,
	upstreamTimeoutSec: 120,
	lifetime: "detached",
};

function toObject(value: unknown): Record<string, unknown> {
	if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
	return Math.max(min, Math.min(max, Math.round(raw)));
}

function normalizeConfig(raw: unknown): ProxyConfig {
	const v = toObject(raw);
	return {
		host: typeof v["host"] === "string" && v["host"].length > 0 ? (v["host"] as string) : DEFAULT_CONFIG.host,
		port: clampInt(v["port"], 1, 65535, DEFAULT_CONFIG.port),
		authToken: typeof v["authToken"] === "string" ? (v["authToken"] as string) : DEFAULT_CONFIG.authToken,
		remoteImages: typeof v["remoteImages"] === "boolean" ? (v["remoteImages"] as boolean) : DEFAULT_CONFIG.remoteImages,
		maxBodySizeMb: clampInt(v["maxBodySizeMb"], 1, 500, DEFAULT_CONFIG.maxBodySizeMb),
		upstreamTimeoutSec: clampInt(v["upstreamTimeoutSec"], 5, 600, DEFAULT_CONFIG.upstreamTimeoutSec),
		lifetime: v["lifetime"] === "session" ? "session" : "detached",
	};
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

function getConfigPath(): string {
	const piDir = process.env["PI_CODING_AGENT_DIR"] ?? resolve(process.env["HOME"] ?? "~", ".pi", "agent");
	return resolve(piDir, "proxy-config.json");
}

function loadConfig(): ProxyConfig {
	const p = getConfigPath();
	if (!existsSync(p)) return { ...DEFAULT_CONFIG };
	try {
		return normalizeConfig(JSON.parse(readFileSync(p, "utf-8")));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function saveConfig(config: ProxyConfig): void {
	const p = getConfigPath();
	const normalized = normalizeConfig(config);
	const tmp = `${p}.tmp`;
	try {
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(tmp, `${JSON.stringify(normalized, null, "\t")}\n`, "utf-8");
		renameSync(tmp, p);
	} catch {
		if (existsSync(tmp)) unlinkSync(tmp);
	}
}

// ---------------------------------------------------------------------------
// Config -> env vars
// ---------------------------------------------------------------------------

function configToEnv(config: ProxyConfig): Record<string, string> {
	const env: Record<string, string> = {};
	env["PI_PROXY_HOST"] = config.host;
	env["PI_PROXY_PORT"] = String(config.port);
	if (config.authToken.length > 0) {
		env["PI_PROXY_AUTH_TOKEN"] = config.authToken;
	}
	env["PI_PROXY_REMOTE_IMAGES"] = String(config.remoteImages);
	env["PI_PROXY_MAX_BODY_SIZE"] = String(config.maxBodySizeMb * 1024 * 1024);
	env["PI_PROXY_UPSTREAM_TIMEOUT_MS"] = String(config.upstreamTimeoutSec * 1000);
	return env;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function proxyExtension(pi: ExtensionAPI): void {
	let config = loadConfig();
	let sessionProcess: ChildProcess | undefined;

	const extensionDir = dirname(fileURLToPath(import.meta.url));
	const packageRoot = resolve(extensionDir, "..");
	const proxyEntry = resolve(packageRoot, "dist", "index.mjs");

	function proxyUrl(): string {
		return `http://${config.host}:${String(config.port)}`;
	}

	// --- Lifecycle ---

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		await refreshStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		// Only kill session-tied processes
		if (sessionProcess !== undefined) {
			sessionProcess.kill("SIGTERM");
			sessionProcess = undefined;
		}
	});

	// --- Command family ---

	const SUBCOMMANDS = ["start", "stop", "status", "config", "show", "path", "reset", "help"];
	const USAGE = "/proxy [start|stop|status|config|show|path|reset|help]";

	pi.registerCommand("proxy", {
		description: "Manage the OpenAI-compatible proxy",
		getArgumentCompletions: (prefix) => {
			const trimmed = prefix.trimStart();
			const matches = SUBCOMMANDS.filter((s) => s.startsWith(trimmed));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "";

			switch (sub) {
				case "start":
					await startProxy(ctx);
					return;
				case "stop":
					await stopProxy(ctx);
					return;
				case "status":
					await showStatus(ctx);
					return;
				case "show":
					await showConfig(ctx);
					return;
				case "path":
					ctx.ui.notify(getConfigPath(), "info");
					return;
				case "reset":
					config = { ...DEFAULT_CONFIG };
					saveConfig(config);
					ctx.ui.notify("Proxy settings reset to defaults", "info");
					return;
				case "help":
					ctx.ui.notify(USAGE, "info");
					return;
				case "":
				case "config":
					break;
				default:
					ctx.ui.notify(USAGE, "warning");
					return;
			}

			// Default: open settings panel
			if (!ctx.hasUI) {
				ctx.ui.notify("/proxy requires interactive mode. Use /proxy show instead.", "warning");
				return;
			}
			await openSettingsPanel(ctx);
		},
	});

	// --- PID file ---

	function getPidPath(): string {
		const piDir = process.env["PI_CODING_AGENT_DIR"] ?? resolve(process.env["HOME"] ?? "~", ".pi", "agent");
		return resolve(piDir, "proxy.pid");
	}

	function readPid(): number | undefined {
		const p = getPidPath();
		if (!existsSync(p)) return undefined;
		try {
			const raw = readFileSync(p, "utf-8").trim();
			const pid = Number.parseInt(raw, 10);
			if (!Number.isFinite(pid) || pid <= 0) return undefined;
			// Check if process is alive
			try {
				process.kill(pid, 0);
				return pid;
			} catch {
				// Process is dead, clean up stale PID file
				unlinkSync(p);
				return undefined;
			}
		} catch {
			return undefined;
		}
	}

	function writePid(pid: number): void {
		const p = getPidPath();
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, String(pid), "utf-8");
	}

	function removePid(): void {
		const p = getPidPath();
		if (existsSync(p)) {
			try {
				unlinkSync(p);
			} catch {
				// ignore
			}
		}
	}

	// --- Proxy process management ---

	async function probe(): Promise<RuntimeStatus> {
		try {
			const res = await fetch(`${proxyUrl()}/v1/models`, {
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
			ctx.ui.setStatus("proxy", `proxy: ${proxyUrl()} (${String(status.models)} models)`);
		} else {
			ctx.ui.setStatus("proxy", undefined);
		}
	}

	async function startProxy(ctx: ExtensionContext): Promise<void> {
		config = loadConfig();

		// Already running?
		const status = await probe();
		if (status.reachable) {
			ctx.ui.notify(
				`Proxy already running at ${proxyUrl()} (${String(status.models)} models)`,
				"info",
			);
			await refreshStatus(ctx);
			return;
		}

		// Stale PID from a previous detached run?
		const existingPid = readPid();
		if (existingPid !== undefined) {
			ctx.ui.notify(`Stale proxy process ${String(existingPid)} -- killing`, "warning");
			try {
				process.kill(existingPid, "SIGTERM");
			} catch {
				// already dead
			}
			removePid();
			await new Promise((r) => setTimeout(r, 500));
		}

		ctx.ui.setStatus("proxy", "proxy: starting...");

		try {
			const proxyEnv = configToEnv(config);

			if (config.lifetime === "detached") {
				await startDetached(ctx, proxyEnv);
			} else {
				startSessionTied(ctx, proxyEnv);
			}

			const ready = await waitForReady(3000);
			if (ready.reachable) {
				const mode = config.lifetime === "detached" ? "background" : "session";
				ctx.ui.notify(
					`Proxy started at ${proxyUrl()} (${String(ready.models)} models) [${mode}]`,
					"info",
				);
			} else {
				ctx.ui.notify(`Proxy spawned but not yet reachable at ${proxyUrl()}`, "warning");
			}
			await refreshStatus(ctx);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Failed to start proxy: ${message}`, "error");
			ctx.ui.setStatus("proxy", undefined);
		}
	}

	async function startDetached(_ctx: ExtensionContext, env: Record<string, string>): Promise<void> {
		const child = spawn("bun", ["run", proxyEntry], {
			stdio: ["ignore", "ignore", "ignore"],
			detached: true,
			env: { ...process.env, ...env },
		});

		if (child.pid === undefined) {
			throw new Error("No PID returned from spawn");
		}

		child.unref();
		writePid(child.pid);
	}

	function startSessionTied(ctx: ExtensionContext, env: Record<string, string>): void {
		if (sessionProcess !== undefined) {
			ctx.ui.notify("Session proxy already running", "info");
			return;
		}

		sessionProcess = spawn("bun", ["run", proxyEntry], {
			stdio: ["ignore", "pipe", "pipe"],
			detached: false,
			env: { ...process.env, ...env },
		});

		sessionProcess.on("exit", (code) => {
			sessionProcess = undefined;
			if (code !== null && code !== 0) {
				ctx.ui.notify(`Proxy exited with code ${String(code)}`, "warning");
			}
			ctx.ui.setStatus("proxy", undefined);
		});

		sessionProcess.on("error", (err) => {
			sessionProcess = undefined;
			ctx.ui.notify(`Proxy error: ${err.message}`, "error");
			ctx.ui.setStatus("proxy", undefined);
		});
	}

	async function stopProxy(ctx: ExtensionContext): Promise<void> {
		// Session-tied process?
		if (sessionProcess !== undefined) {
			sessionProcess.kill("SIGTERM");
			sessionProcess = undefined;
			ctx.ui.notify("Session proxy stopped", "info");
			ctx.ui.setStatus("proxy", undefined);
			return;
		}

		// Detached process via PID file?
		const pid = readPid();
		if (pid !== undefined) {
			try {
				process.kill(pid, "SIGTERM");
				removePid();
				ctx.ui.notify(`Proxy stopped (pid ${String(pid)})`, "info");
				ctx.ui.setStatus("proxy", undefined);
				return;
			} catch {
				removePid();
			}
		}

		// Something else listening?
		const status = await probe();
		if (status.reachable) {
			ctx.ui.notify(
				`Proxy at ${proxyUrl()} was not started by /proxy -- stop it manually`,
				"info",
			);
		} else {
			ctx.ui.notify("Proxy is not running", "info");
			ctx.ui.setStatus("proxy", undefined);
		}
	}

	async function showStatus(ctx: ExtensionContext): Promise<void> {
		const status = await probe();
		const pid = readPid();
		const pidTag = pid !== undefined ? ` [pid ${String(pid)}]` : "";

		if (status.reachable) {
			ctx.ui.notify(
				`${proxyUrl()} -- ${String(status.models)} models available${pidTag}`,
				"info",
			);
		} else {
			ctx.ui.notify("Proxy not running. Use /proxy start", "info");
		}
		await refreshStatus(ctx);
	}

	async function showConfig(ctx: ExtensionContext): Promise<void> {
		config = loadConfig();
		const authDisplay =
			config.authToken.length > 0 ? `enabled (token: ${config.authToken})` : "disabled";
		const lines = [
			`lifetime: ${config.lifetime}`,
			`host: ${config.host}`,
			`port: ${String(config.port)}`,
			`auth: ${authDisplay}`,
			`remote images: ${String(config.remoteImages)}`,
			`max body: ${String(config.maxBodySizeMb)} MB`,
			`timeout: ${String(config.upstreamTimeoutSec)}s`,
		];
		ctx.ui.notify(lines.join(" | "), "info");
		await refreshStatus(ctx);
	}

	async function waitForReady(timeoutMs: number): Promise<RuntimeStatus> {
		const start = Date.now();
		const interval = 300;
		while (Date.now() - start < timeoutMs) {
			const status = await probe();
			if (status.reachable) return status;
			await new Promise((r) => setTimeout(r, interval));
		}
		return { reachable: false, models: 0 };
	}

	// --- Settings panel ---

	let lastGeneratedToken = "";

	function buildSettingItems(): SettingItem[] {
		return [
			{
				id: "lifetime",
				label: "Lifetime",
				description: "detached = background daemon, session = dies when pi exits",
				currentValue: config.lifetime,
				values: ["detached", "session"],
			},
			{
				id: "host",
				label: "Bind address",
				description: "Network interface to listen on (127.0.0.1 = local only, 0.0.0.0 = all)",
				currentValue: config.host,
				values: ["127.0.0.1", "0.0.0.0"],
			},
			{
				id: "port",
				label: "Port",
				description: "HTTP port for the proxy",
				currentValue: String(config.port),
				values: ["4141", "8080", "3000", "9090"],
			},
			{
				id: "authToken",
				label: "Proxy auth",
				description:
					config.authToken.length > 0
						? `Token: ${config.authToken.slice(0, 8)}... (use /proxy show to copy)`
						: "Require bearer token for all requests",
				currentValue: config.authToken.length > 0 ? "enabled" : "disabled",
				values: ["disabled", "enabled"],
			},
			{
				id: "remoteImages",
				label: "Remote images",
				description: "Allow remote image URL fetching (security risk if exposed)",
				currentValue: config.remoteImages ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "maxBodySizeMb",
				label: "Max body size",
				description: "Maximum request body in MB",
				currentValue: `${String(config.maxBodySizeMb)} MB`,
				values: ["10 MB", "50 MB", "100 MB", "200 MB"],
			},
			{
				id: "upstreamTimeoutSec",
				label: "Upstream timeout",
				description: "Max seconds to wait for upstream provider response",
				currentValue: `${String(config.upstreamTimeoutSec)}s`,
				values: ["30s", "60s", "120s", "300s"],
			},
		];
	}

	function applySetting(id: string, value: string): void {
		switch (id) {
			case "lifetime":
				config = { ...config, lifetime: value === "session" ? "session" : "detached" };
				break;
			case "host":
				config = { ...config, host: value };
				break;
			case "port":
				config = { ...config, port: clampInt(Number.parseInt(value, 10), 1, 65535, config.port) };
				break;
			case "authToken":
				// Toggle: "enabled" keeps current token or generates one; "disabled" clears
				if (value === "disabled") {
					config = { ...config, authToken: "" };
				} else if (config.authToken.length === 0) {
					// Generate a random token on first enable
					const bytes = new Uint8Array(16);
					crypto.getRandomValues(bytes);
					config = {
						...config,
						authToken: Array.from(bytes)
							.map((b) => b.toString(16).padStart(2, "0"))
							.join(""),
					};
					// Stash token so the caller can notify the user
					lastGeneratedToken = config.authToken;
				}
				break;
			case "remoteImages":
				config = { ...config, remoteImages: value === "on" };
				break;
			case "maxBodySizeMb": {
				const mb = Number.parseInt(value, 10);
				if (Number.isFinite(mb) && mb > 0) config = { ...config, maxBodySizeMb: mb };
				break;
			}
			case "upstreamTimeoutSec": {
				const sec = Number.parseInt(value, 10);
				if (Number.isFinite(sec) && sec > 0) config = { ...config, upstreamTimeoutSec: sec };
				break;
			}
		}
		saveConfig(config);
		config = loadConfig(); // read back normalized
	}

	async function openSettingsPanel(ctx: ExtensionCommandContext): Promise<void> {
		config = loadConfig();

		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				function build(): { container: Container; settingsList: SettingsList } {
					const container = new Container();
					container.addChild(new Text(theme.fg("accent", theme.bold("Proxy Settings")), 1, 0));
					container.addChild(new Text(theme.fg("dim", getConfigPath()), 1, 0));

					const settingsList = new SettingsList(
						buildSettingItems(),
						10,
						getSettingsListTheme(),
						(id, newValue) => {
							lastGeneratedToken = "";
							applySetting(id, newValue);
							if (lastGeneratedToken.length > 0) {
								ctx.ui.notify(`Auth token: ${lastGeneratedToken}`, "info");
							}
							current = build();
							tui.requestRender();
						},
						() => done(undefined),
						{ enableSearch: true },
					);

					container.addChild(settingsList);
					container.addChild(
						new Text(
							theme.fg("dim", "Esc: close | Arrow keys: navigate | Space: toggle | Restart proxy to apply"),
							1,
							0,
						),
					);

					return { container, settingsList };
				}

				let current = build();

				return {
					render(width: number): string[] {
						return current.container.render(width);
					},
					invalidate(): void {
						current.container.invalidate();
					},
					handleInput(data: string): void {
						current.settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 80,
					maxHeight: "85%",
					margin: 1,
				},
			},
		);
	}
}
