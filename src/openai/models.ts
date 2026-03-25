/**
 * Build OpenAI-compatible model list and model detail responses.
 *
 * Standard OpenAI model object shape only -- no x_pi extensions.
 * Public IDs are determined by the model-exposure engine.
 */

import type { ExposedModel } from "@proxy/openai/model-exposure";

/** Unix timestamp (seconds) from when the module was first loaded. */
const MODULE_CREATED = Math.floor(Date.now() / 1000);

export interface OpenAIModel {
	readonly id: string;
	readonly object: "model";
	readonly created: number;
	readonly owned_by: string;
}

export interface OpenAIModelList {
	readonly object: "list";
	readonly data: readonly OpenAIModel[];
}

/**
 * Convert an ExposedModel to an OpenAI model object.
 */
export function toOpenAIModel(exposed: ExposedModel): OpenAIModel {
	return {
		id: exposed.publicId,
		object: "model",
		created: MODULE_CREATED,
		owned_by: exposed.provider,
	};
}

/**
 * Build the full model list response.
 */
export function buildModelList(models: readonly ExposedModel[]): OpenAIModelList {
	return {
		object: "list",
		data: models.map(toOpenAIModel),
	};
}
