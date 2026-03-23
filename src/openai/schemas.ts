/**
 * Zod schemas for the OpenAI chat-completions request subset.
 *
 * Phase 2 contract:
 * - Phase 1 supported fields: model, messages, stream, temperature,
 *   max_tokens, max_completion_tokens, stop, user, stream_options
 * - Phase 2 additions: tools, tool_choice, reasoning_effort,
 *   top_p, frequency_penalty, presence_penalty, seed, response_format
 * - Unknown top-level fields are rejected with 422
 * - `n > 1` is rejected
 * - `logprobs` is rejected
 */

import * as z from "zod";

// --- Message content parts ---

const textContentPartSchema = z.object({
	type: z.literal("text"),
	text: z.string().trim(),
});

const imageUrlContentPartSchema = z.object({
	type: z.literal("image_url"),
	image_url: z.object({
		url: z.string().trim(),
		detail: z.enum(["auto", "low", "high"]).optional(),
	}),
});

const contentPartSchema = z.discriminatedUnion("type", [
	textContentPartSchema,
	imageUrlContentPartSchema,
]);

// --- Messages ---

const systemMessageSchema = z.object({
	role: z.literal("system"),
	content: z.string().trim(),
	name: z.string().trim().optional(),
});

const developerMessageSchema = z.object({
	role: z.literal("developer"),
	content: z.string().trim(),
	name: z.string().trim().optional(),
});

const userMessageTextSchema = z.object({
	role: z.literal("user"),
	content: z.string().trim(),
	name: z.string().trim().optional(),
});

const userMessagePartsSchema = z.object({
	role: z.literal("user"),
	content: z.array(contentPartSchema),
	name: z.string().trim().optional(),
});

const assistantMessageSchema = z.object({
	role: z.literal("assistant"),
	content: z.string().trim().nullable().optional(),
	name: z.string().trim().optional(),
	tool_calls: z
		.array(
			z.object({
				id: z.string().trim(),
				type: z.literal("function"),
				function: z.object({
					name: z.string().trim(),
					arguments: z.string().trim(),
				}),
			}),
		)
		.optional(),
});

const toolMessageSchema = z.object({
	role: z.literal("tool"),
	content: z.string().trim(),
	tool_call_id: z.string().trim(),
});

const messageSchema = z.union([
	systemMessageSchema,
	developerMessageSchema,
	userMessageTextSchema,
	userMessagePartsSchema,
	assistantMessageSchema,
	toolMessageSchema,
]);

export type OpenAIMessage = z.infer<typeof messageSchema>;

// --- Stream options ---

const streamOptionsSchema = z.object({
	include_usage: z.boolean().optional(),
});

// --- Function tool definition ---

/**
 * OpenAI function tool definition.
 * The `parameters` field is a JSON Schema object validated structurally;
 * semantic conversion to TypeBox happens in json-schema-to-typebox.ts.
 */
const functionToolSchema = z.object({
	type: z.literal("function"),
	function: z.object({
		name: z.string().trim(),
		description: z.string().trim().optional(),
		parameters: z.record(z.string().trim(), z.unknown()).optional(),
		strict: z.boolean().nullable().optional(),
	}),
});

export type OpenAIFunctionTool = z.infer<typeof functionToolSchema>;

// --- Tool choice ---

/**
 * OpenAI tool_choice: "none" | "auto" | "required" | { type: "function", function: { name: string } }
 */
const namedToolChoiceSchema = z.object({
	type: z.literal("function"),
	function: z.object({
		name: z.string().trim(),
	}),
});

const toolChoiceSchema = z.union([z.enum(["none", "auto", "required"]), namedToolChoiceSchema]);

export type ToolChoice = z.infer<typeof toolChoiceSchema>;

// --- Response format ---

const responseFormatSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("text") }),
	z.object({ type: z.literal("json_object") }),
]);

export type ResponseFormat = z.infer<typeof responseFormatSchema>;

// --- Top-level request ---

export const chatCompletionRequestSchema = z
	.object({
		model: z.string().trim(),
		messages: z.array(messageSchema).min(1),
		stream: z.boolean().optional(),
		temperature: z.number().min(0).max(2).optional(),
		max_tokens: z.int().positive().optional(),
		max_completion_tokens: z.int().positive().optional(),
		stop: z.union([z.string().trim(), z.array(z.string().trim()).max(4)]).optional(),
		user: z.string().trim().optional(),
		stream_options: streamOptionsSchema.nullable().optional(),
		// Phase 2 additions
		tools: z.array(functionToolSchema).optional(),
		tool_choice: toolChoiceSchema.optional(),
		reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
		top_p: z.number().min(0).max(1).optional(),
		frequency_penalty: z.number().min(-2).max(2).optional(),
		presence_penalty: z.number().min(-2).max(2).optional(),
		seed: z.int().optional(),
		response_format: responseFormatSchema.optional(),
	})
	.strict();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

// --- Rejected fields ---

/**
 * Fields that are explicitly rejected with a helpful error.
 * These are not supported and won't be promoted.
 */
export const rejectedFields = [
	"n",
	"logprobs",
	"top_logprobs",
	"logit_bias",
	"functions",
	"function_call",
	"parallel_tool_calls",
] as const;
