/**
 * SDK conformance test helpers.
 *
 * Provides an OpenAI SDK client pointed at the Hono test app,
 * and skip utilities for when no API credentials are available.
 */

import { getAvailableModels, initRegistry } from "@proxy/pi/registry";
import OpenAI from "openai";
import { testApp } from "../helpers";

let initialized = false;
let app: ReturnType<typeof testApp> | undefined;

/**
 * Curated test model matrix.
 *
 * Three categories per provider:
 *   fast     -- cheapest, for basic shape validation
 *   mid      -- mid-tier, for tool call and streaming tests
 *   reasoning -- reasoning-capable, for reasoning_effort tests
 *
 * Tests pick from this matrix based on what's available.
 * Uses OAuth subscription accounts -- be mindful of quota.
 */
export interface TestModel {
	readonly id: string;
	readonly category: "fast" | "mid" | "reasoning";
}

const TEST_MODEL_MATRIX: readonly TestModel[] = [
	// Anthropic (direct)
	{ id: "anthropic/claude-haiku-4-5", category: "fast" },
	{ id: "anthropic/claude-sonnet-4-5", category: "mid" },
	{ id: "anthropic/claude-sonnet-4-6", category: "reasoning" },

	// Google Gemini
	{ id: "google-gemini-cli/gemini-2.0-flash", category: "fast" },
	{ id: "google-gemini-cli/gemini-2.5-flash", category: "mid" },
	{ id: "google-gemini-cli/gemini-2.5-pro", category: "reasoning" },

	// OpenAI / Codex
	{ id: "openai-codex/gpt-5.4-mini", category: "fast" },
	{ id: "openai-codex/gpt-5.1-codex-mini", category: "mid" },
	{ id: "openai-codex/gpt-5.2-codex", category: "reasoning" },
];

let resolvedModels: Map<string, TestModel> | undefined;

/**
 * Initialize the registry and app once.
 */
export function setup(): { app: ReturnType<typeof testApp> } {
	if (!initialized) {
		initRegistry();
		app = testApp();

		const available = new Set(getAvailableModels().map((m) => `${m.provider}/${m.id}`));
		resolvedModels = new Map();
		for (const tm of TEST_MODEL_MATRIX) {
			if (available.has(tm.id)) {
				resolvedModels.set(tm.id, tm);
			}
		}

		initialized = true;
	}
	if (app === undefined) {
		throw new Error("App not initialized");
	}
	return { app };
}

/**
 * Get all available test models, optionally filtered by category.
 */
export function getTestModels(category?: TestModel["category"]): TestModel[] {
	setup();
	if (resolvedModels === undefined) return [];
	const all = [...resolvedModels.values()];
	if (category === undefined) return all;
	return all.filter((m) => m.category === category);
}

/**
 * Get the single cheapest available test model. Prefer "fast" category.
 * Returns undefined if no credentials are available.
 */
export function getCheapestModel(): TestModel | undefined {
	const fast = getTestModels("fast");
	if (fast.length > 0) return fast[0];
	const mid = getTestModels("mid");
	if (mid.length > 0) return mid[0];
	return getTestModels()[0];
}

/**
 * Create an OpenAI SDK client that sends requests through the Hono test app.
 *
 * Uses a custom fetch that routes requests to app.request() instead of
 * making real HTTP calls. This lets the SDK's response parsing and
 * strict validation run against our response shapes.
 *
 * The Hono app.request() return type is compatible with globalThis.Response
 * at runtime (same underlying Response class in Bun), but TypeScript sees
 * them as distinct types because Hono re-exports its own Response type.
 * We bridge this by constructing a new globalThis.Response from the Hono
 * response body and status.
 */
export function createTestClient(proxyApp: ReturnType<typeof testApp>): OpenAI {
	return new OpenAI({
		apiKey: "test-key-unused",
		baseURL: "http://localhost:4141/v1",
		maxRetries: 0,
		fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const path = new URL(url).pathname;
			const method = init?.method ?? "GET";
			const headers = init?.headers ?? {};
			const body = init?.body ?? null;

			const honoRes = await proxyApp.request(path, {
				method,
				headers,
				body,
			});

			// Bridge Hono Response -> globalThis.Response for the SDK
			return new globalThis.Response(honoRes.body, {
				status: honoRes.status,
				statusText: honoRes.statusText,
				headers: Object.fromEntries(honoRes.headers.entries()),
			});
		},
	});
}

/**
 * Returns true if at least one test model has credentials configured.
 */
export function hasCredentials(): boolean {
	return getTestModels().length > 0;
}
