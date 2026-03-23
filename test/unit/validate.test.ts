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

	test("rejects Phase 1 rejected fields with 422", () => {
		const rejectedFields = [
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
		];

		for (const field of rejectedFields) {
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
