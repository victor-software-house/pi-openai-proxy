import { describe, expect, test } from "bun:test";
import { validateChatRequest } from "@proxy/openai/validate.js";

describe("validateChatRequest", () => {
	test("accepts minimal valid request", () => {
		const result = validateChatRequest({
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "Hello" }],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.model).toBe("openai/gpt-4o");
		expect(result.data.messages).toHaveLength(1);
	});

	test("accepts request with all Phase 1 fields", () => {
		const result = validateChatRequest({
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "Hello" }],
			stream: true,
			temperature: 0.7,
			max_tokens: 100,
			stop: ["\n", "END"],
			user: "test-user",
			stream_options: { include_usage: true },
		});
		expect(result.ok).toBe(true);
	});

	test("rejects empty messages", () => {
		const result = validateChatRequest({
			model: "openai/gpt-4o",
			messages: [],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(400);
	});

	test("rejects permanently rejected fields with 422", () => {
		const permanentlyRejected = [
			"n",
			"logprobs",
			"top_logprobs",
			"logit_bias",
			"functions",
			"function_call",
			"parallel_tool_calls",
		];

		for (const field of permanentlyRejected) {
			const body = {
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello" }],
				[field]: "some_value",
			};
			const result = validateChatRequest(body);
			expect(result.ok).toBe(false);
			if (result.ok) continue;
			expect(result.status).toBe(422);
			expect(result.param).toBe(field);
		}
	});

	test("accepts Phase 2 fields", () => {
		const result = validateChatRequest({
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "Hello" }],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get the weather",
						parameters: {
							type: "object",
							properties: { city: { type: "string" } },
							required: ["city"],
						},
					},
				},
			],
			tool_choice: "auto",
			reasoning_effort: "high",
			top_p: 0.9,
			frequency_penalty: 0.5,
			presence_penalty: 0.5,
			seed: 42,
			response_format: { type: "json_object" },
		});
		expect(result.ok).toBe(true);
	});

	test("rejects unknown top-level fields with 422", () => {
		const result = validateChatRequest({
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "Hello" }],
			unknown_field: "value",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(422);
	});

	test("rejects temperature out of range", () => {
		const result = validateChatRequest({
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "Hello" }],
			temperature: 3.0,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(400);
	});

	test("rejects missing model", () => {
		const result = validateChatRequest({
			messages: [{ role: "user", content: "Hello" }],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(400);
	});

	test("accepts max_completion_tokens", () => {
		const result = validateChatRequest({
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "Hello" }],
			max_completion_tokens: 256,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.max_completion_tokens).toBe(256);
	});
});
