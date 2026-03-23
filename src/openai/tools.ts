/**
 * OpenAI function tools -> pi Tool conversion.
 *
 * Phase 2 contract:
 * - Convert OpenAI function tools to pi Tool definitions
 * - Reject unsupported JSON Schema constructs via json-schema-to-typebox
 * - Convert tool_choice to pi-compatible format
 */

import type { Tool } from "@mariozechner/pi-ai";
import { jsonSchemaToTypebox } from "@proxy/openai/json-schema-to-typebox";
import type { OpenAIFunctionTool } from "@proxy/openai/schemas";
import type { TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

export interface ToolConversionSuccess {
	readonly ok: true;
	readonly tools: Tool[];
}

export interface ToolConversionError {
	readonly ok: false;
	readonly message: string;
	readonly param: string;
}

export type ToolConversionResult = ToolConversionSuccess | ToolConversionError;

/**
 * Convert an array of OpenAI function tool definitions to pi Tool definitions.
 */
export function convertTools(openaiTools: OpenAIFunctionTool[]): ToolConversionResult {
	const piTools: Tool[] = [];

	for (let i = 0; i < openaiTools.length; i++) {
		const tool = openaiTools[i];
		if (tool === undefined) continue;

		const fn = tool.function;
		let parameters: TSchema;

		if (fn.parameters !== undefined) {
			const result = jsonSchemaToTypebox(fn.parameters, `tools[${String(i)}].function.parameters`);
			if (!result.ok) {
				return {
					ok: false,
					message: result.message,
					param: result.path,
				};
			}
			parameters = result.schema;
		} else {
			// No parameters specified -- empty object
			parameters = Type.Object({});
		}

		piTools.push({
			name: fn.name,
			description: fn.description ?? "",
			parameters,
		});
	}

	return { ok: true, tools: piTools };
}
