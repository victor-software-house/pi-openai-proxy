/**
 * Pi ModelRuntime and SettingsManager integration.
 *
 * Initializes the model runtime using pi's file-based auth and model storage,
 * reads the global `enabledModels` setting from pi's SettingsManager,
 * and exposes lookup functions used by the proxy routes.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

let modelRuntime: ModelRuntime | undefined;
let modelRuntimePromise: Promise<ModelRuntime> | undefined;
let settingsManager: SettingsManager | undefined;

/**
 * Initialize the model runtime and settings. Call once at startup.
 * Returns the load error if models.json failed to parse, or undefined on success.
 */
export async function initRegistry(): Promise<string | undefined> {
	modelRuntimePromise ??= ModelRuntime.create();
	modelRuntime = await modelRuntimePromise;
	settingsManager ??= SettingsManager.create(process.cwd());
	return modelRuntime.getError();
}

export function getModelRuntime(): ModelRuntime {
	if (modelRuntime === undefined) {
		throw new Error("ModelRuntime not initialized. Await initRegistry() first.");
	}
	return modelRuntime;
}

export function getSettingsManager(): SettingsManager {
	if (settingsManager === undefined) {
		throw new Error("SettingsManager not initialized. Call initRegistry() first.");
	}
	return settingsManager;
}

/**
 * Get the initialized snapshot of models with configured auth.
 */
export function getAvailableModels(): Model<Api>[] {
	return [...getModelRuntime().getAvailableSnapshot()];
}

/**
 * Resolve request auth for a specific model at request time.
 *
 * This uses Pi's current request-auth contract, which may return both an API
 * key and model-specific headers. That covers API-key providers, OAuth-backed
 * providers, authHeader handling, and dynamic models.json header resolution.
 */
export async function getRequestAuth(model: Model<Api>) {
	try {
		const result = await getModelRuntime().getAuth(model);
		if (result === undefined) {
			return { ok: false as const, error: "No configured authentication" };
		}
		return { ok: true as const };
	} catch (error) {
		return {
			ok: false as const,
			error: error instanceof Error ? error.message : "Authentication resolution failed",
		};
	}
}

/**
 * Get the `enabledModels` patterns from pi's global settings.
 *
 * These are the canonical model IDs (e.g. "anthropic/claude-sonnet-4-6")
 * persisted by the `/scoped-models` TUI when the user presses Ctrl+S.
 *
 * Returns undefined when no filter is configured (all models enabled).
 */
export async function getEnabledModels(): Promise<readonly string[] | undefined> {
	const manager = getSettingsManager();
	await manager.reload();
	return manager.getEnabledModels();
}
