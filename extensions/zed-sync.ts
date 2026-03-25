/**
 * Zed settings.json model sync.
 *
 * Discovers Zed's settings file, maps exposed proxy models to Zed's
 * openai_compatible available_models shape, and writes them back using
 * jsonc-parser's modify() to preserve comments and formatting.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExposedModel } from "@victor-software-house/pi-openai-proxy/exposure";
import { applyEdits, type ModificationOptions, modify, parse } from "jsonc-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZedAvailableModel {
	readonly name: string;
	readonly display_name: string;
	readonly max_tokens: number;
	readonly max_output_tokens: number;
	readonly capabilities: {
		readonly tools: boolean;
		readonly images: boolean;
		readonly parallel_tool_calls: boolean;
		readonly prompt_cache_key: boolean;
		readonly chat_completions: boolean;
	};
}

export interface ZedSyncOptions {
	/** Provider label in Zed settings (e.g. "Pi Proxy"). */
	readonly providerName: string;
	/** API URL written into the provider block. */
	readonly apiUrl: string;
	/** Preview changes without writing to disk. */
	readonly dryRun: boolean;
}

export interface ZedSyncResult {
	readonly ok: boolean;
	readonly configPath: string;
	readonly added: number;
	readonly removed: number;
	readonly unchanged: number;
	readonly summary: string;
	readonly error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Settings file discovery
// ---------------------------------------------------------------------------

/**
 * Resolve Zed's global settings.json path.
 *
 * Resolution order:
 * 1. CUSTOM_DATA_DIR env var (Zed's own override)
 * 2. ~/.config/zed/settings.json (macOS + Linux standard)
 * 3. $XDG_CONFIG_HOME/zed/settings.json (Linux XDG)
 */
export function findZedSettings(): string | undefined {
	const customDir = process.env["CUSTOM_DATA_DIR"];
	if (customDir !== undefined && customDir.length > 0) {
		const p = resolve(customDir, "settings.json");
		if (existsSync(p)) return p;
	}

	const home = process.env["HOME"];
	if (home !== undefined && home.length > 0) {
		const p = resolve(home, ".config", "zed", "settings.json");
		if (existsSync(p)) return p;
	}

	const xdg = process.env["XDG_CONFIG_HOME"];
	if (xdg !== undefined && xdg.length > 0) {
		const p = resolve(xdg, "zed", "settings.json");
		if (existsSync(p)) return p;
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Model mapping
// ---------------------------------------------------------------------------

/**
 * Map an ExposedModel to Zed's available_models entry.
 */
export function toZedModel(exposed: ExposedModel): ZedAvailableModel {
	const model = exposed.model;
	return {
		name: exposed.publicId,
		display_name: model.name,
		max_tokens: model.contextWindow,
		max_output_tokens: model.maxTokens,
		capabilities: {
			tools: true,
			images: model.input.includes("image"),
			parallel_tool_calls: false,
			prompt_cache_key: false,
			chat_completions: true,
		},
	};
}

// ---------------------------------------------------------------------------
// JSONC surgical edit
// ---------------------------------------------------------------------------

const MODIFY_OPTIONS: ModificationOptions = {
	isArrayInsertion: false,
	formattingOptions: {
		tabSize: 2,
		insertSpaces: true,
		eol: "\n",
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the current available_models for a provider from Zed settings.
 * Returns the parsed model names, or an empty array if the path does not exist.
 */
function readCurrentModelNames(text: string, providerName: string): string[] {
	const root: unknown = parse(text);
	if (!isRecord(root)) return [];

	const langModels: unknown = root["language_models"];
	if (!isRecord(langModels)) return [];

	const compat: unknown = langModels["openai_compatible"];
	if (!isRecord(compat)) return [];

	const provider: unknown = compat[providerName];
	if (!isRecord(provider)) return [];

	const models: unknown = provider["available_models"];
	if (!Array.isArray(models)) return [];

	const names: string[] = [];
	for (const entry of models) {
		if (isRecord(entry)) {
			const name: unknown = entry["name"];
			if (typeof name === "string") {
				names.push(name);
			}
		}
	}
	return names;
}

/**
 * Apply the full provider block (api_url + available_models) to the JSONC text.
 * Returns the new text with edits applied.
 */
function applyProviderBlock(
	text: string,
	providerName: string,
	apiUrl: string,
	models: readonly ZedAvailableModel[],
): string {
	const providerBlock = {
		api_url: apiUrl,
		available_models: models,
	};

	const edits = modify(
		text,
		["language_models", "openai_compatible", providerName],
		providerBlock,
		MODIFY_OPTIONS,
	);

	return applyEdits(text, edits);
}

// ---------------------------------------------------------------------------
// Public sync API
// ---------------------------------------------------------------------------

/**
 * Sync exposed models into Zed's settings.json.
 */
export function syncToZed(
	exposedModels: readonly ExposedModel[],
	options: ZedSyncOptions,
): ZedSyncResult {
	const configPath = findZedSettings();
	if (configPath === undefined) {
		return {
			ok: false,
			configPath: "",
			added: 0,
			removed: 0,
			unchanged: 0,
			summary: "",
			error:
				"Zed settings.json not found. Checked ~/.config/zed/settings.json and $XDG_CONFIG_HOME/zed/settings.json",
		};
	}

	const originalText = readFileSync(configPath, "utf-8");
	const currentNames = new Set(readCurrentModelNames(originalText, options.providerName));
	const zedModels = exposedModels.map(toZedModel);
	const newNames = new Set(zedModels.map((m) => m.name));

	let added = 0;
	let removed = 0;
	let unchanged = 0;

	for (const name of newNames) {
		if (currentNames.has(name)) {
			unchanged += 1;
		} else {
			added += 1;
		}
	}
	for (const name of currentNames) {
		if (!newNames.has(name)) {
			removed += 1;
		}
	}

	const parts: string[] = [];
	if (added > 0) parts.push(`${String(added)} added`);
	if (removed > 0) parts.push(`${String(removed)} removed`);
	if (unchanged > 0) parts.push(`${String(unchanged)} unchanged`);
	const summary = parts.length > 0 ? parts.join(", ") : "no changes";

	if (options.dryRun) {
		return {
			ok: true,
			configPath,
			added,
			removed,
			unchanged,
			summary: `[dry-run] ${summary}`,
		};
	}

	const newText = applyProviderBlock(originalText, options.providerName, options.apiUrl, zedModels);
	writeFileSync(configPath, newText, "utf-8");

	return {
		ok: true,
		configPath,
		added,
		removed,
		unchanged,
		summary,
	};
}
