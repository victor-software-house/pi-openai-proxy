import { describe, expect, test } from "bun:test";
import { convertMessages } from "@proxy/openai/messages.js";
import type { OpenAIMessage } from "@proxy/openai/schemas.js";

describe("convertMessages", () => {
	test("converts system messages into systemPrompt", () => {
		const messages: OpenAIMessage[] = [
			{ role: "system", content: "You are helpful." },
			{ role: "user", content: "Hello" },
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.context.systemPrompt).toBe("You are helpful.");
		expect(result.context.messages).toHaveLength(1);
		expect(result.context.messages[0]?.role).toBe("user");
	});

	test("merges system and developer messages", () => {
		const messages: OpenAIMessage[] = [
			{ role: "system", content: "System prompt" },
			{ role: "developer", content: "Developer context" },
			{ role: "user", content: "Hello" },
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.context.systemPrompt).toBe("System prompt\n\nDeveloper context");
	});

	test("converts user text messages", () => {
		const messages: OpenAIMessage[] = [{ role: "user", content: "Hello world" }];
		const result = convertMessages(messages);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.context.messages).toHaveLength(1);
		const msg = result.context.messages[0];
		expect(msg?.role).toBe("user");
		if (msg?.role === "user") {
			expect(msg.content).toBe("Hello world");
		}
	});

	test("converts assistant messages into history", () => {
		const messages: OpenAIMessage[] = [
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello!" },
			{ role: "user", content: "How are you?" },
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.context.messages).toHaveLength(3);
		const assistant = result.context.messages[1];
		expect(assistant?.role).toBe("assistant");
	});

	test("converts tool messages", () => {
		const messages: OpenAIMessage[] = [
			{ role: "user", content: "What's the weather?" },
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "tc_1",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"SF"}' },
					},
				],
			},
			{ role: "tool", content: '{"temp":72}', tool_call_id: "tc_1" },
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.context.messages).toHaveLength(3);
		const toolResult = result.context.messages[2];
		expect(toolResult?.role).toBe("toolResult");
	});

	test("rejects remote image URLs", () => {
		const messages: OpenAIMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "What is this?" },
					{ type: "image_url", image_url: { url: "https://example.com/image.png" } },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("Remote image URLs are not supported");
	});

	test("accepts base64 data URI images", () => {
		const messages: OpenAIMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "What is this?" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.context.messages).toHaveLength(1);
		const msg = result.context.messages[0];
		if (msg?.role === "user" && Array.isArray(msg.content)) {
			expect(msg.content).toHaveLength(2);
			const imagePart = msg.content[1];
			if (imagePart?.type === "image") {
				expect(imagePart.mimeType).toBe("image/png");
				expect(imagePart.data).toBe("iVBORw0KGgo=");
			}
		}
	});

	test("rejects unsupported image MIME types", () => {
		const messages: OpenAIMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "data:image/bmp;base64,iVBORw0KGgo=" },
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("Unsupported image MIME type");
		expect(result.message).toContain("image/bmp");
	});

	test("rejects invalid base64 data URI format", () => {
		const messages: OpenAIMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "data:notbase64content" },
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("Invalid base64 data URI format");
	});

	test("accepts all supported image MIME types", () => {
		const mimeTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
		for (const mime of mimeTypes) {
			const messages: OpenAIMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { url: `data:${mime};base64,iVBORw0KGgo=` },
						},
					],
				},
			];
			const result = convertMessages(messages);
			expect(result.ok).toBe(true);
		}
	});
});
