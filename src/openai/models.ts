/**
 * Build OpenAI-compatible model list and model detail responses.
 *
 * Phase 0 contract:
 * - id: "provider/model-id" canonical form
 * - object: "model"
 * - created: 0 (pi doesn't track model creation dates)
 * - owned_by: provider name
 * - Extended metadata under x_pi
 */

import type { Api, Model } from "@mariozechner/pi-ai";

export interface OpenAIModel {
	readonly id: string;
	readonly object: "model";
	readonly created: number;
	readonly owned_by: string;
	readonly x_pi?: {
		readonly api: string;
		readonly reasoning: boolean;
		readonly input: string[];
		readonly context_window: number;
		readonly max_tokens: number;
	};
}

export interface OpenAIModelList {
	readonly object: "list";
	readonly data: OpenAIModel[];
}

/**
 * Convert a pi Model to an OpenAI model object.
 */
export function toOpenAIModel(model: Model<Api>): OpenAIModel {
	return {
		id: `${model.provider}/${model.id}`,
		object: "model",
		created: 0,
		owned_by: model.provider,
		x_pi: {
			api: model.api,
			reasoning: model.reasoning,
			input: model.input,
			context_window: model.contextWindow,
			max_tokens: model.maxTokens,
		},
	};
}

/**
 * Build the full model list response.
 */
export function buildModelList(models: Model<Api>[]): OpenAIModelList {
	return {
		object: "list",
		data: models.map(toOpenAIModel),
	};
}
