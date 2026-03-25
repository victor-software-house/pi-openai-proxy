/**
 * SDK conformance: streaming chat completions.
 *
 * Uses the official openai Node SDK against the proxy.
 * Runs once with the cheapest available model.
 * Skips when no credentials are available.
 */

import { describe, expect, test } from "bun:test";
import { createTestClient, getCheapestModel, setup } from "./helpers";

describe("SDK streaming chat conformance", () => {
	test("streaming text completion parses all chunks without SDK errors", async () => {
		const model = getCheapestModel();
		if (model === undefined) return;

		const { app } = setup();
		const client = createTestClient(app);

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "user", content: "Reply with exactly: hello" }],
			max_completion_tokens: 32,
			stream: true,
		});

		let chunkCount = 0;
		let lastFinishReason: string | null = null;

		for await (const chunk of stream) {
			chunkCount++;
			expect(chunk.object).toBe("chat.completion.chunk");
			expect(chunk.id).toBeString();
			expect(chunk.created).toBeNumber();

			if (chunk.choices.length > 0) {
				const choice = chunk.choices[0];
				if (choice !== undefined) {
					lastFinishReason = choice.finish_reason;
				}
			}
		}

		expect(chunkCount).toBeGreaterThan(0);
		expect(lastFinishReason).not.toBeNull();
	});

	test("stream_options.include_usage produces a usage chunk", async () => {
		const model = getCheapestModel();
		if (model === undefined) return;

		const { app } = setup();
		const client = createTestClient(app);

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "user", content: "Reply with exactly: hi" }],
			max_completion_tokens: 16,
			stream: true,
			stream_options: { include_usage: true },
		});

		let sawUsageChunk = false;

		for await (const chunk of stream) {
			if (chunk.usage !== undefined && chunk.usage !== null) {
				sawUsageChunk = true;
				expect(chunk.usage.prompt_tokens).toBeNumber();
				expect(chunk.usage.completion_tokens).toBeNumber();
				expect(chunk.usage.total_tokens).toBeNumber();
			}
		}

		expect(sawUsageChunk).toBe(true);
	});
});
