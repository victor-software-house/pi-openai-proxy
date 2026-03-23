/**
 * Pi ModelRegistry and AuthStorage integration.
 *
 * Initializes the model registry using pi's file-based auth and model storage,
 * then exposes lookup functions used by the proxy routes.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

let registry: ModelRegistry | undefined;
let authStorage: AuthStorage | undefined;

/**
 * Initialize the registry. Call once at startup.
 * Returns the load error if models.json failed to parse, or undefined on success.
 */
export function initRegistry(): string | undefined {
	authStorage = AuthStorage.create();
	registry = new ModelRegistry(authStorage);
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

/**
 * Get all models available (have auth configured).
 */
export function getAvailableModels(): Model<Api>[] {
	return getRegistry().getAvailable();
}

/**
 * Get all registered models (regardless of auth state).
 */
export function getAllModels(): Model<Api>[] {
	return getRegistry().getAll();
}
