/**
 * Proxy configuration schema -- single source of truth.
 *
 * Used by both the proxy server and the pi extension.
 * The server reads the JSON config file as defaults, with env vars and CLI args as overrides.
 * The pi extension reads and writes the JSON config file via the /proxy config panel.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxyConfig {
	/** Bind address. Default: "127.0.0.1" */
	readonly host: string;
	/** Listen port. Default: 4141 */
	readonly port: number;
	/** Bearer token for proxy auth. Empty string = disabled. */
	readonly authToken: string;
	/** Allow remote image URL fetching. Default: false */
	readonly remoteImages: boolean;
	/** Max request body in MB. Default: 50 */
	readonly maxBodySizeMb: number;
	/** Upstream timeout in seconds. Default: 120 */
	readonly upstreamTimeoutSec: number;
	/** "detached" = background daemon, "session" = dies with pi session. Default: "detached" */
	readonly lifetime: "detached" | "session";
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Readonly<ProxyConfig> = {
	host: "127.0.0.1",
	port: 4141,
	authToken: "",
	remoteImages: false,
	maxBodySizeMb: 50,
	upstreamTimeoutSec: 120,
	lifetime: "detached",
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
	);
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
	return Math.max(min, Math.min(max, Math.round(raw)));
}

export function normalizeConfig(raw: unknown): ProxyConfig {
	const v = isRecord(raw) ? raw : {};
	const rawHost = v["host"];
	const rawAuthToken = v["authToken"];
	const rawRemoteImages = v["remoteImages"];
	return {
		host: typeof rawHost === "string" && rawHost.length > 0 ? rawHost : DEFAULT_CONFIG.host,
		port: clampInt(v["port"], 1, 65535, DEFAULT_CONFIG.port),
		authToken: typeof rawAuthToken === "string" ? rawAuthToken : DEFAULT_CONFIG.authToken,
		remoteImages:
			typeof rawRemoteImages === "boolean" ? rawRemoteImages : DEFAULT_CONFIG.remoteImages,
		maxBodySizeMb: clampInt(v["maxBodySizeMb"], 1, 500, DEFAULT_CONFIG.maxBodySizeMb),
		upstreamTimeoutSec: clampInt(
			v["upstreamTimeoutSec"],
			5,
			600,
			DEFAULT_CONFIG.upstreamTimeoutSec,
		),
		lifetime: v["lifetime"] === "session" ? "session" : "detached",
	};
}

// ---------------------------------------------------------------------------
// JSON config file path
// ---------------------------------------------------------------------------

export function getConfigPath(): string {
	const piDir =
		process.env["PI_CODING_AGENT_DIR"] ?? resolve(process.env["HOME"] ?? "~", ".pi", "agent");
	return resolve(piDir, "proxy-config.json");
}

// ---------------------------------------------------------------------------
// JSON config file I/O
// ---------------------------------------------------------------------------

export function loadConfigFromFile(): ProxyConfig {
	const p = getConfigPath();
	if (!existsSync(p)) return { ...DEFAULT_CONFIG };
	try {
		return normalizeConfig(JSON.parse(readFileSync(p, "utf-8")));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function saveConfigToFile(config: ProxyConfig): void {
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
// Config -> env vars (for spawning the proxy as a child process)
// ---------------------------------------------------------------------------

export function configToEnv(config: ProxyConfig): Record<string, string> {
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
