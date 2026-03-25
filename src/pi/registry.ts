/**
 * Pi ModelRegistry, AuthStorage, and SettingsManager integration.
 *
 * Initializes the model registry using pi's file-based auth and model storage,
 * reads the global `enabledModels` setting from pi's SettingsManager,
 * and exposes lookup functions used by the proxy routes.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry, SettingsManager } from "@mariozechner/pi-coding-agent";

let registry: ModelRegistry | undefined;
let authStorage: AuthStorage | undefined;
let settingsManager: SettingsManager | undefined;

/**
 * Initialize the registry and settings. Call once at startup.
 * Returns the load error if models.json failed to parse, or undefined on success.
 */
export function initRegistry(): string | undefined {
	authStorage = AuthStorage.create();
	registry = new ModelRegistry(authStorage);
	settingsManager = SettingsManager.create();
	return registry.getError();
}

export function getRegistry(): ModelRegistry {
	if (registry === undefined) {
		throw new Error("ModelRegistry not initialized. Call initRegistry() first.");
	}
	return registry;
}

export function getAuthStorage(): AuthStorage {
	if (authStorage === undefined) {
		throw new Error("AuthStorage not initialized. Call initRegistry() first.");
	}
	return authStorage;
}

export function getSettingsManager(): SettingsManager {
	if (settingsManager === undefined) {
		throw new Error("SettingsManager not initialized. Call initRegistry() first.");
	}
	return settingsManager;
}

/**
 * Get all models available (have auth configured).
 */
export function getAvailableModels(): Model<Api>[] {
	return getRegistry().getAvailable();
}

/**
 * Get the `enabledModels` patterns from pi's global settings.
 *
 * These are the canonical model IDs (e.g. "anthropic/claude-sonnet-4-6")
 * persisted by the `/scoped-models` TUI when the user presses Ctrl+S.
 *
 * Returns undefined when no filter is configured (all models enabled).
 */
export function getEnabledModels(): readonly string[] | undefined {
	getSettingsManager().reload();
	return getSettingsManager().getEnabledModels();
}
