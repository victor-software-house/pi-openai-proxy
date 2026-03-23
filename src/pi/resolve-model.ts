/**
 * Model resolution: canonical ID parsing and shorthand resolution.
 *
 * Phase 0 contract decisions:
 * - Canonical format: "provider/model-id" (may contain nested slashes like "openrouter/anthropic/claude-sonnet-4-20250514")
 * - Shorthand: bare model-id scanned across all providers; must be unique
 * - Ambiguous shorthand returns 400 with the matching canonical IDs
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { getRegistry } from "./registry.js";

export interface ModelResolution {
	readonly ok: true;
	readonly model: Model<Api>;
}

export interface ModelResolutionError {
	readonly ok: false;
	readonly status: number;
	readonly message: string;
	readonly candidates?: string[];
}

export type ModelResolutionResult = ModelResolution | ModelResolutionError;

/**
 * Parse a canonical model ID string into provider and model-id.
 *
 * "openai/gpt-4o" -> { provider: "openai", modelId: "gpt-4o" }
 * "openrouter/anthropic/claude-sonnet-4-20250514" -> { provider: "openrouter", modelId: "anthropic/claude-sonnet-4-20250514" }
 * "gpt-4o" -> null (shorthand, no slash)
 */
export function parseCanonicalId(input: string): { provider: string; modelId: string } | null {
	const slashIndex = input.indexOf("/");
	if (slashIndex === -1) {
		return null;
	}
	return {
		provider: input.slice(0, slashIndex),
		modelId: input.slice(slashIndex + 1),
	};
}

/**
 * Resolve a model string (canonical or shorthand) to a pi Model.
 */
export function resolveModel(input: string): ModelResolutionResult {
	const registry = getRegistry();
	const parsed = parseCanonicalId(input);

	if (parsed !== null) {
		// Canonical lookup: provider/model-id
		const model = registry.find(parsed.provider, parsed.modelId);
		if (model === undefined) {
			return {
				ok: false,
				status: 404,
				message: `Model '${input}' not found`,
			};
		}
		return { ok: true, model };
	}

	// Shorthand: scan all models for a unique match by model id
	const allModels = registry.getAll();
	const matches: Model<Api>[] = [];
	for (const m of allModels) {
		if (m.id === input) {
			matches.push(m);
		}
	}

	if (matches.length === 0) {
		return {
			ok: false,
			status: 404,
			message: `Model '${input}' not found`,
		};
	}

	if (matches.length === 1) {
		const match = matches[0];
		if (match === undefined) {
			return { ok: false, status: 404, message: `Model '${input}' not found` };
		}
		return { ok: true, model: match };
	}

	// Ambiguous shorthand
	const candidates = matches.map((m) => `${m.provider}/${m.id}`);
	return {
		ok: false,
		status: 400,
		message: `Ambiguous model '${input}'. Matches: ${candidates.join(", ")}. Use the canonical form 'provider/model-id'.`,
		candidates,
	};
}
