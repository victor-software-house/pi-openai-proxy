/**
 * SDK conformance: non-streaming chat completions.
 *
 * Uses the official openai Node SDK against the proxy.
 * Runs once with the cheapest available model.
 * Skips when no credentials are available.
 */

import { describe, expect, test } from "bun:test";
import { createTestClient, getCheapestModel, setup } from "./helpers";

describe("SDK non-streaming chat conformance", () => {
	test("simple text completion parses without SDK errors", async () => {
		const model = getCheapestModel();
		if (model === undefined) return;

		const { app } = setup();
		const client = createTestClient(app);

		const completion = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "user", content: "Reply with exactly: hello" }],
			max_completion_tokens: 32,
		});

		expect(completion.object).toBe("chat.completion");
		expect(completion.id).toBeString();
		expect(completion.created).toBeNumber();
		expect(completion.choices.length).toBe(1);

		const choice = completion.choices[0];
		expect(choice).toBeDefined();
		expect(choice?.message.role).toBe("assistant");
		expect(choice?.finish_reason).not.toBeNull();

		expect(completion.usage).toBeDefined();
		expect(completion.usage?.prompt_tokens).toBeNumber();
		expect(completion.usage?.completion_tokens).toBeNumber();
		expect(completion.usage?.total_tokens).toBeNumber();
	});
});
