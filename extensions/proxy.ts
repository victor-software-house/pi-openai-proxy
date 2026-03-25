/**
 * Pi extension: /proxy command family with config panel.
 *
 * Command family:
 *   /proxy            Open settings panel
 *   /proxy start      Start the proxy server
 *   /proxy stop       Stop the proxy server
 *   /proxy status     Show proxy status
 *   /proxy verify     Validate model exposure config against available models
 *   /proxy models     List all exposed models with their public IDs
 *   /proxy zed-sync   Sync exposed models to Zed settings.json (--dry-run)
 *   /proxy config     Open settings panel (alias)
 *   /proxy show       Summarize current config and exposure policy
 *   /proxy path       Show config file location
 *   /proxy reset      Restore default settings
 *   /proxy help       Usage line
 *
 * Config schema imported from @victor-software-house/pi-openai-proxy/config (SSOT).
 * Model-exposure engine imported from @victor-software-house/pi-openai-proxy/exposure.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getSettingsListTheme,
	ModelRegistry,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import {
	type Component,
	Container,
	type SettingItem,
	SettingsList,
	Text,
} from "@mariozechner/pi-tui";

// Config schema -- single source of truth
import {
	configToEnv,
	DEFAULT_CONFIG,
	getConfigPath,
	loadConfigFromFile,
	type ModelExposureMode,
	type PublicModelIdMode,
	saveConfigToFile,
} from "@victor-software-house/pi-openai-proxy/config";

// Model-exposure engine
import {
	computeModelExposure,
	type ModelExposureConfig,
} from "@victor-software-house/pi-openai-proxy/exposure";

import { syncToZed, type ZedSyncOptions } from "@victor-software-house/pi-openai-proxy/sync/zed";

// ---------------------------------------------------------------------------
// Runtime status
// ---------------------------------------------------------------------------

interface RuntimeStatus {
	reachable: boolean;
	models: number;
}

interface ProbeBody {
	data: unknown[];
}

function isProbeBody(value: unknown): value is ProbeBody {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	if (!("data" in value)) return false;
	const v: { data: unknown } = value;
	return Array.isArray(v.data);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function proxyExtension(pi: ExtensionAPI): void {
	let config = loadConfigFromFile();
	let sessionProcess: ChildProcess | undefined;

	const extensionDir = dirname(fileURLToPath(import.meta.url));
	const packageRoot = resolve(extensionDir, "..");

	// --- Model registry access (cached, refreshed per call) ---

	const cachedAuth = AuthStorage.create();
	const cachedRegistry = new ModelRegistry(cachedAuth);
	const settingsManager = SettingsManager.create();

	function getAvailableModels(): Model<Api>[] {
		cachedRegistry.refresh();
		return cachedRegistry.getAvailable();
	}

	function getEnabledModels(): readonly string[] | undefined {
		settingsManager.reload();
		return settingsManager.getEnabledModels();
	}

	function buildExposureConfig(): ModelExposureConfig {
		return {
			publicModelIdMode: config.publicModelIdMode,
			modelExposureMode: config.modelExposureMode,
			enabledModels: getEnabledModels(),
			customModels: config.customModels,
			providerPrefixes: config.providerPrefixes,
		};
	}

	// Resolve pi-proxy binary: try local dev build, then installed package, then PATH
	function findProxyBinary(): string {
		// Local development: dist/index.mjs in the same package root
		const localBin = resolve(packageRoot, "dist", "index.mjs");
		if (existsSync(localBin)) return localBin;
		// Installed as dependency: node_modules/pi-proxy/dist/index.mjs
		const depBin = resolve(packageRoot, "node_modules", "pi-proxy", "dist", "index.mjs");
		if (existsSync(depBin)) return depBin;
		// Fallback: assume pi-proxy is in PATH
		return "pi-proxy";
	}

	function proxyUrl(): string {
		return `http://${config.host}:${String(config.port)}`;
	}

	// --- Lifecycle ---

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfigFromFile();
		await refreshStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (sessionProcess !== undefined) {
			sessionProcess.kill("SIGTERM");
			sessionProcess = undefined;
		}
	});

	// --- Command family ---

	const SUBCOMMANDS = [
		"start",
		"stop",
		"restart",
		"status",
		"verify",
		"models",
		"zed-sync",
		"config",
		"show",
		"path",
		"reset",
		"help",
	];
	const USAGE =
		"/proxy [start|stop|restart|status|verify|models|zed-sync|config|show|path|reset|help]";

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
				case "restart":
					await stopProxy(ctx);
					await new Promise((r) => setTimeout(r, 500));
					await startProxy(ctx);
					return;
				case "status":
					await showStatus(ctx);
					return;
				case "verify":
					verifyExposure(ctx);
					return;
				case "models":
					showModels(ctx);
					return;
				case "zed-sync":
					handleZedSync(ctx, args);
					return;
				case "show":
					showConfig(ctx);
					return;
				case "path":
					ctx.ui.notify(getConfigPath(), "info");
					return;
				case "reset":
					config = { ...DEFAULT_CONFIG };
					saveConfigToFile(config);
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

			if (!ctx.hasUI) {
				ctx.ui.notify("/proxy requires interactive mode. Use /proxy show instead.", "warning");
				return;
			}
			await openSettingsPanel(ctx);
		},
	});

	// --- PID file ---

	function getPidPath(): string {
		const piDir =
			process.env["PI_CODING_AGENT_DIR"] ?? resolve(process.env["HOME"] ?? "~", ".pi", "agent");
		return resolve(piDir, "proxy.pid");
	}

	function readPid(): number | undefined {
		const p = getPidPath();
		if (!existsSync(p)) return undefined;
		try {
			const raw = readFileSync(p, "utf-8").trim();
			const pid = Number.parseInt(raw, 10);
			if (!Number.isFinite(pid) || pid <= 0) return undefined;
			try {
				process.kill(pid, 0);
				return pid;
			} catch {
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
			const headers: Record<string, string> = {};
			if (config.authToken.length > 0) {
				headers["authorization"] = `Bearer ${config.authToken}`;
			}
			const res = await fetch(`${proxyUrl()}/v1/models`, {
				signal: AbortSignal.timeout(2000),
				headers,
			});
			if (res.ok) {
				const body: unknown = await res.json();
				let modelCount = 0;
				if (isProbeBody(body)) {
					modelCount = body.data.length;
				}
				return { reachable: true, models: modelCount };
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
		config = loadConfigFromFile();

		const status = await probe();
		if (status.reachable) {
			ctx.ui.notify(
				`Proxy already running at ${proxyUrl()} (${String(status.models)} models)`,
				"info",
			);
			await refreshStatus(ctx);
			return;
		}

		// Clean up stale PID
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
			const bin = findProxyBinary();

			if (config.lifetime === "detached") {
				startDetached(bin, proxyEnv);
			} else {
				startSessionTied(ctx, bin, proxyEnv);
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

	function startDetached(bin: string, env: Record<string, string>): void {
		const usesBun = bin.endsWith(".mjs");
		const cmd = usesBun ? "bun" : bin;
		const cmdArgs = usesBun ? ["run", bin] : [];

		const child = spawn(cmd, cmdArgs, {
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

	function startSessionTied(ctx: ExtensionContext, bin: string, env: Record<string, string>): void {
		if (sessionProcess !== undefined) {
			ctx.ui.notify("Session proxy already running", "info");
			return;
		}

		const usesBun = bin.endsWith(".mjs");
		const cmd = usesBun ? "bun" : bin;
		const cmdArgs = usesBun ? ["run", bin] : [];

		sessionProcess = spawn(cmd, cmdArgs, {
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
		if (sessionProcess !== undefined) {
			sessionProcess.kill("SIGTERM");
			sessionProcess = undefined;
			ctx.ui.notify("Session proxy stopped", "info");
			ctx.ui.setStatus("proxy", undefined);
			return;
		}

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

		const status = await probe();
		if (status.reachable) {
			ctx.ui.notify(`Proxy at ${proxyUrl()} was not started by /proxy -- stop it manually`, "info");
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
			ctx.ui.notify(`${proxyUrl()} -- ${String(status.models)} models available${pidTag}`, "info");
		} else {
			ctx.ui.notify("Proxy not running. Use /proxy start", "info");
		}
		await refreshStatus(ctx);
	}

	function showConfig(ctx: ExtensionContext): void {
		config = loadConfigFromFile();
		const authDisplay =
			config.authToken.length > 0 ? `enabled (token: ${config.authToken})` : "disabled";

		// Server settings
		const serverLines = [
			`lifetime: ${config.lifetime}`,
			`host: ${config.host}`,
			`port: ${String(config.port)}`,
			`auth: ${authDisplay}`,
			`remote images: ${String(config.remoteImages)}`,
			`max body: ${String(config.maxBodySizeMb)} MB`,
			`timeout: ${String(config.upstreamTimeoutSec)}s`,
		];

		// Exposure policy
		const exposureLines = [
			`id mode: ${config.publicModelIdMode}`,
			`exposure: ${config.modelExposureMode}`,
		];

		if (config.modelExposureMode === "scoped") {
			const enabledModels = getEnabledModels();
			if (enabledModels !== undefined && enabledModels.length > 0) {
				exposureLines.push(`enabled: ${String(enabledModels.length)} pi model(s)`);
			}
		}
		if (config.modelExposureMode === "custom" && config.customModels.length > 0) {
			exposureLines.push(`models: ${String(config.customModels.length)} custom`);
		}

		const prefixKeys = Object.keys(config.providerPrefixes);
		if (prefixKeys.length > 0) {
			const pairs = prefixKeys.map((k) => `${k}=${config.providerPrefixes[k] ?? k}`);
			exposureLines.push(`prefixes: ${pairs.join(", ")}`);
		}

		// Public ID preview (first 5 exposed models)
		const models = getAvailableModels();
		const outcome = computeModelExposure(models, buildExposureConfig());
		if (outcome.ok && outcome.models.length > 0) {
			const preview = outcome.models.slice(0, 5).map((m) => m.publicId);
			const suffix =
				outcome.models.length > 5 ? ` (+${String(outcome.models.length - 5)} more)` : "";
			exposureLines.push(`exposed: ${preview.join(", ")}${suffix}`);
		} else if (outcome.ok) {
			exposureLines.push("exposed: none");
		} else {
			exposureLines.push(`error: ${outcome.message}`);
		}

		ctx.ui.notify(`${serverLines.join(" | ")}\n${exposureLines.join(" | ")}`, "info");
	}

	// --- /proxy models ---

	function showModels(ctx: ExtensionContext): void {
		config = loadConfigFromFile();
		const models = getAvailableModels();
		const outcome = computeModelExposure(models, buildExposureConfig());

		if (!outcome.ok) {
			ctx.ui.notify(`Model exposure error: ${outcome.message}`, "warning");
			return;
		}

		if (outcome.models.length === 0) {
			ctx.ui.notify("No models exposed. Check /proxy verify for details.", "info");
			return;
		}

		// Group models by provider for readable output
		const byProvider = new Map<string, { publicId: string; canonicalId: string }[]>();
		for (const m of outcome.models) {
			const list = byProvider.get(m.provider);
			const entry = { publicId: m.publicId, canonicalId: m.canonicalId };
			if (list !== undefined) {
				list.push(entry);
			} else {
				byProvider.set(m.provider, [entry]);
			}
		}

		const sections: string[] = [];
		for (const [provider, entries] of byProvider) {
			const lines = entries.map((e) => {
				// Only show canonical ID when it differs from the public ID
				if (e.publicId === e.canonicalId) {
					return `  ${e.publicId}`;
				}
				return `  ${e.publicId}  (${e.canonicalId})`;
			});
			sections.push(`${provider} (${String(entries.length)}):\n${lines.join("\n")}`);
		}

		const header = `${String(outcome.models.length)} exposed model(s)`;
		ctx.ui.notify(`${header}\n\n${sections.join("\n\n")}`, "info");
	}

	// --- /proxy verify ---

	function verifyExposure(ctx: ExtensionContext): void {
		config = loadConfigFromFile();
		const models = getAvailableModels();
		const issues: string[] = [];

		// Check available models
		if (models.length === 0) {
			issues.push("No models have auth configured. The proxy will expose 0 models.");
		}

		// Check custom models reference valid canonical IDs
		if (config.modelExposureMode === "custom") {
			const canonicalSet = new Set(models.map((m) => `${m.provider}/${m.id}`));
			for (const id of config.customModels) {
				if (!canonicalSet.has(id)) {
					issues.push(`Custom model '${id}' is not available (no auth or unknown).`);
				}
			}
			if (config.customModels.length === 0) {
				issues.push("Custom mode with empty model list will expose 0 models.");
			}
		}

		// Run the full exposure computation to catch ID/prefix errors
		const outcome = computeModelExposure(models, buildExposureConfig());
		if (!outcome.ok) {
			issues.push(outcome.message);
		}

		if (issues.length === 0) {
			const count = outcome.ok ? outcome.models.length : 0;
			ctx.ui.notify(`Verification passed. ${String(count)} models exposed.`, "info");
		} else {
			ctx.ui.notify(
				`Verification found ${String(issues.length)} issue(s):\n${issues.join("\n")}`,
				"warning",
			);
		}
	}

	// --- Zed sync ---

	/**
	 * Run Zed sync and return the result. Shared by the command and auto-sync.
	 */
	function runZedSync(dryRun: boolean): { ok: boolean; message: string } {
		const available = getAvailableModels();
		const outcome = computeModelExposure(available, buildExposureConfig());
		if (!outcome.ok) {
			return { ok: false, message: `Model exposure error: ${outcome.message}` };
		}

		if (outcome.models.length === 0) {
			return { ok: false, message: "No models exposed. Nothing to sync." };
		}

		const syncOptions: ZedSyncOptions = {
			providerName: config.zed.providerName,
			apiUrl: `http://${config.host}:${String(config.port)}/v1`,
			dryRun,
		};

		const result = syncToZed(outcome.models, syncOptions);

		if (!result.ok) {
			return { ok: false, message: result.error ?? "Zed sync failed" };
		}

		const prefix = dryRun ? "[dry-run] " : "";
		return { ok: true, message: `${prefix}${result.summary} (${result.configPath})` };
	}

	function handleZedSync(ctx: ExtensionContext, args: string): void {
		config = loadConfigFromFile();
		const dryRun = args.includes("--dry-run");
		const result = runZedSync(dryRun);
		ctx.ui.notify(`Zed sync: ${result.message}`, result.ok ? "info" : "error");
	}

	/**
	 * Trigger auto-sync to Zed if enabled. Called after config save.
	 */
	function maybeAutoSyncZed(ctx: ExtensionContext): void {
		if (!config.zed.autoSync) return;
		const result = runZedSync(false);
		if (result.ok) {
			ctx.ui.notify(`Zed auto-sync: ${result.message}`, "info");
		}
		// Silent on failure during auto-sync -- don't spam the user
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

	function customModelsDisplay(): string {
		if (config.modelExposureMode !== "custom") return "n/a";
		return config.customModels.length > 0
			? `${String(config.customModels.length)} selected`
			: "(none)";
	}

	/**
	 * Build a submenu Component for selecting custom models.
	 * Shows all available models as a toggleable checklist.
	 */
	function buildModelSelectorSubmenu(
		_currentValue: string,
		done: (selectedValue?: string) => void,
	): Component {
		const models = getAvailableModels();
		const selected = new Set(config.customModels);

		// Build provider order from sorted model list
		const providerOrder: string[] = [];
		for (const m of models) {
			if (!providerOrder.includes(m.provider)) providerOrder.push(m.provider);
		}

		const items: SettingItem[] = models.map((m) => {
			const canonical = `${m.provider}/${m.id}`;
			return {
				id: canonical,
				label: canonical,
				description: `Provider: ${m.provider}  |  Left/Right: jump provider`,
				currentValue: selected.has(canonical) ? "true" : "false",
				values: ["true", "false"],
			};
		});

		const list = new SettingsList(
			items,
			Math.min(items.length + 2, 20),
			getSettingsListTheme(),
			(id: string, newValue: string) => {
				if (newValue === "true") {
					selected.add(id);
				} else {
					selected.delete(id);
				}
				config = { ...config, customModels: [...selected] };
				saveConfigToFile(config);
				config = loadConfigFromFile();
			},
			() => done(`${String(selected.size)} selected`),
			{ enableSearch: true },
		);

		// HACK: SettingsList has no public API for jumping to an index.
		// Accesses private fields via bracket notation for provider jumping.
		// Pinned to pi-tui behavior as of @mariozechner/pi-coding-agent ^0.62.0.
		// Remove when SettingsList exposes a jumpTo/setSelectedIndex method.

		// Isolated unsafe accessor for SettingsList private fields.
		// Consolidated here so jumpProvider itself is fully type-safe.
		function listGet(key: string): unknown {
			return Reflect.get(list, key);
		}
		function listSet(key: string, value: unknown): void {
			Reflect.set(list, key, value);
		}

		function getSettingsListItems(): SettingItem[] {
			const rawSearch = listGet("searchEnabled");
			const raw =
				typeof rawSearch === "boolean" && rawSearch ? listGet("filteredItems") : listGet("items");
			if (!Array.isArray(raw)) return [];
			const result: SettingItem[] = [];
			for (const item of raw) {
				if (isSettingItem(item)) result.push(item);
			}
			return result;
		}

		function isSettingItem(value: unknown): value is SettingItem {
			if (value === null || typeof value !== "object") return false;
			if (!("id" in value)) return false;
			const v: { id: unknown } = value;
			return typeof v.id === "string";
		}

		function jumpProvider(direction: "prev" | "next"): void {
			const rawIdx = listGet("selectedIndex");
			if (typeof rawIdx !== "number") return;
			const idx = rawIdx;
			const display = getSettingsListItems();
			if (display.length === 0) return;

			const current = display[idx];
			if (current === undefined) return;
			const currentProv = current.id.split("/")[0] ?? "";
			const provIdx = providerOrder.indexOf(currentProv);

			let target: number;
			if (direction === "prev") {
				if (provIdx <= 0) {
					target = 0;
				} else {
					const prev = providerOrder[provIdx - 1] ?? "";
					target = 0;
					for (let i = display.length - 1; i >= 0; i--) {
						if (display[i]?.id.startsWith(`${prev}/`) === true) {
							target = i;
							break;
						}
					}
				}
			} else {
				if (provIdx >= providerOrder.length - 1) {
					target = display.length - 1;
				} else {
					const next = providerOrder[provIdx + 1] ?? "";
					target = display.length - 1;
					for (let i = 0; i < display.length; i++) {
						if (display[i]?.id.startsWith(`${next}/`) === true) {
							target = i;
							break;
						}
					}
				}
			}
			listSet("selectedIndex", target);
		}

		return {
			render(width: number): string[] {
				return list.render(width);
			},
			invalidate(): void {
				list.invalidate();
			},
			handleInput(data: string): void {
				if (data === "\x1B[D") {
					jumpProvider("prev");
				} else if (data === "\x1B[C") {
					jumpProvider("next");
				} else {
					list.handleInput(data);
				}
			},
		};
	}

	// --- Dynamic descriptions ---

	const ID_MODE_DESCRIPTIONS: Record<string, string> = {
		"collision-prefixed": "Short names; adds provider/ prefix only when models collide",
		universal: "Short names only; fails if any model name is shared by two providers",
		"always-prefixed": "Always provider/model-id for every model",
	};

	const EXPOSURE_MODE_DESCRIPTIONS: Record<string, string> = {
		scoped: "Expose models from pi's configured auth (default)",
		all: "Expose all registered models, including those without auth",
		custom: "Expose only manually selected models",
	};

	function idModeDescription(): string {
		return ID_MODE_DESCRIPTIONS[config.publicModelIdMode] ?? "";
	}

	function exposureModeDescription(): string {
		return EXPOSURE_MODE_DESCRIPTIONS[config.modelExposureMode] ?? "";
	}

	function customModelsDescription(): string {
		if (config.modelExposureMode === "custom") return "Press Enter to open model selector";
		return "Switch exposure mode to 'custom' to select models";
	}

	function authDescription(): string {
		if (config.authToken.length > 0) {
			return `Token: ${config.authToken.slice(0, 8)}... (use /proxy show to copy)`;
		}
		return "Require bearer token for all requests";
	}

	function buildSettingItems(): SettingItem[] {
		return [
			// --- Server ---
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
				description: "Network interface (127.0.0.1 = local only, 0.0.0.0 = all)",
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
				description: authDescription(),
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
			// --- Model exposure ---
			{
				id: "publicModelIdMode",
				label: "Model ID format",
				description: idModeDescription(),
				currentValue: config.publicModelIdMode,
				values: ["collision-prefixed", "universal", "always-prefixed"],
			},
			{
				id: "modelExposureMode",
				label: "Exposure mode",
				description: exposureModeDescription(),
				currentValue: config.modelExposureMode,
				values: ["scoped", "all", "custom"],
			},
			{
				id: "customModels",
				label: "Select models",
				description: customModelsDescription(),
				currentValue: customModelsDisplay(),
				...(config.modelExposureMode === "custom" ? { submenu: buildModelSelectorSubmenu } : {}),
			},
			// --- Zed sync ---
			{
				id: "zed.autoSync",
				label: "Zed auto-sync",
				description: "Sync models to Zed settings.json when config changes",
				currentValue: config.zed.autoSync ? "on" : "off",
				values: ["off", "on"],
			},
			{
				id: "zed.providerName",
				label: "Zed provider name",
				description: "Provider label in Zed's openai_compatible section",
				currentValue: config.zed.providerName,
				values: ["Pi Proxy"],
			},
		];
	}

	/**
	 * Update descriptions on items that change dynamically based on the current value.
	 */
	function refreshDescriptions(items: SettingItem[]): void {
		for (const item of items) {
			switch (item.id) {
				case "publicModelIdMode":
					item.description = idModeDescription();
					break;
				case "modelExposureMode":
					item.description = exposureModeDescription();
					break;
				case "customModels":
					item.description = customModelsDescription();
					break;
				case "authToken":
					item.description = authDescription();
					break;
			}
		}
	}

	// Local type guards — the extension resolves against the built dist, so it
	// cannot import these from the source config module during development.
	function isPublicModelIdMode(v: string): v is PublicModelIdMode {
		return v === "collision-prefixed" || v === "universal" || v === "always-prefixed";
	}

	function isModelExposureMode(v: string): v is ModelExposureMode {
		return v === "all" || v === "scoped" || v === "custom";
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
				config = {
					...config,
					port: Math.max(1, Math.min(65535, Number.parseInt(value, 10) || config.port)),
				};
				break;
			case "authToken":
				if (value === "disabled") {
					config = { ...config, authToken: "" };
				} else if (config.authToken.length === 0) {
					const bytes = new Uint8Array(16);
					crypto.getRandomValues(bytes);
					config = {
						...config,
						authToken: Array.from(bytes)
							.map((b) => b.toString(16).padStart(2, "0"))
							.join(""),
					};
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
			case "publicModelIdMode":
				if (isPublicModelIdMode(value)) {
					config = { ...config, publicModelIdMode: value };
				}
				break;
			case "modelExposureMode":
				if (isModelExposureMode(value)) {
					config = { ...config, modelExposureMode: value };
				}
				break;
			case "customModels":
				// Handled by submenu -- no cycling
				break;
			case "zed.autoSync":
				config = { ...config, zed: { ...config.zed, autoSync: value === "on" } };
				break;
			case "zed.providerName":
				if (value.length > 0) {
					config = { ...config, zed: { ...config.zed, providerName: value } };
				}
				break;
		}
		saveConfigToFile(config);
		config = loadConfigFromFile();
	}

	/**
	 * Get the display value for a setting after it has been applied.
	 */
	function getDisplayValue(id: string): string {
		switch (id) {
			case "lifetime":
				return config.lifetime;
			case "host":
				return config.host;
			case "port":
				return String(config.port);
			case "authToken":
				return config.authToken.length > 0 ? "enabled" : "disabled";
			case "remoteImages":
				return config.remoteImages ? "on" : "off";
			case "maxBodySizeMb":
				return `${String(config.maxBodySizeMb)} MB`;
			case "upstreamTimeoutSec":
				return `${String(config.upstreamTimeoutSec)}s`;
			case "publicModelIdMode":
				return config.publicModelIdMode;
			case "modelExposureMode":
				return config.modelExposureMode;
			case "customModels":
				return customModelsDisplay();
			case "zed.autoSync":
				return config.zed.autoSync ? "on" : "off";
			case "zed.providerName":
				return config.zed.providerName;
			default:
				return "";
		}
	}

	async function openSettingsPanel(ctx: ExtensionCommandContext): Promise<void> {
		config = loadConfigFromFile();

		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("Proxy Settings")), 1, 0));
				container.addChild(new Text(theme.fg("dim", getConfigPath()), 1, 0));

				const items = buildSettingItems();
				const settingsList = new SettingsList(
					items,
					12,
					getSettingsListTheme(),
					(id, newValue) => {
						lastGeneratedToken = "";
						applySetting(id, newValue);
						if (lastGeneratedToken.length > 0) {
							ctx.ui.notify(`Auth token: ${lastGeneratedToken}`, "info");
						}

						// Update display value and descriptions in-place (preserves selection)
						settingsList.updateValue(id, getDisplayValue(id));
						refreshDescriptions(items);

						// When exposure mode changes, update the "Select models" item
						if (id === "modelExposureMode") {
							settingsList.updateValue("customModels", customModelsDisplay());
						}

						maybeAutoSyncZed(ctx);
						tui.requestRender();
					},
					() => done(undefined),
					{ enableSearch: true },
				);

				container.addChild(settingsList);
				container.addChild(
					new Text(
						theme.fg(
							"dim",
							"Esc: close | Arrow keys: navigate | Space: toggle | Restart proxy to apply",
						),
						1,
						0,
					),
				);

				return {
					render(width: number): string[] {
						return container.render(width);
					},
					invalidate(): void {
						container.invalidate();
					},
					handleInput(data: string): void {
						settingsList.handleInput?.(data);
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
