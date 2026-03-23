/**
 * Zod schemas for the OpenAI chat-completions request subset.
 *
 * Phase 0 contract:
 * - Phase 1 supported fields: model, messages, stream, temperature,
 *   max_tokens, max_completion_tokens, stop, user, stream_options
 * - Unknown top-level fields are rejected with 422
 * - `n > 1` is rejected
 * - `logprobs` is rejected
 */

import { z } from "zod";

// --- Message content parts ---

const textContentPartSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
});

const imageUrlContentPartSchema = z.object({
	type: z.literal("image_url"),
	image_url: z.object({
		url: z.string(),
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
	content: z.string(),
	name: z.string().optional(),
});

const developerMessageSchema = z.object({
	role: z.literal("developer"),
	content: z.string(),
	name: z.string().optional(),
});

const userMessageTextSchema = z.object({
	role: z.literal("user"),
	content: z.string(),
	name: z.string().optional(),
});

const userMessagePartsSchema = z.object({
	role: z.literal("user"),
	content: z.array(contentPartSchema),
	name: z.string().optional(),
});

const assistantMessageSchema = z.object({
	role: z.literal("assistant"),
	content: z.string().nullable().optional(),
	name: z.string().optional(),
	tool_calls: z
		.array(
			z.object({
				id: z.string(),
				type: z.literal("function"),
				function: z.object({
					name: z.string(),
					arguments: z.string(),
				}),
			}),
		)
		.optional(),
});

const toolMessageSchema = z.object({
	role: z.literal("tool"),
	content: z.string(),
	tool_call_id: z.string(),
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

// --- Top-level request ---

export const chatCompletionRequestSchema = z
	.object({
		model: z.string(),
		messages: z.array(messageSchema).min(1),
		stream: z.boolean().optional(),
		temperature: z.number().min(0).max(2).optional(),
		max_tokens: z.number().int().positive().optional(),
		max_completion_tokens: z.number().int().positive().optional(),
		stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
		user: z.string().optional(),
		stream_options: streamOptionsSchema.nullable().optional(),
	})
	.strict();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

// --- Rejected fields (Phase 1) ---

/**
 * Fields that are explicitly rejected in Phase 1 with a helpful error.
 * Phase 2 will promote some of these to supported.
 */
export const phase1RejectedFields = [
	"tools",
	"tool_choice",
	"response_format",
	"top_p",
	"frequency_penalty",
	"presence_penalty",
	"seed",
	"reasoning_effort",
	"n",
	"logprobs",
	"top_logprobs",
	"logit_bias",
	"functions",
	"function_call",
	"parallel_tool_calls",
] as const;
