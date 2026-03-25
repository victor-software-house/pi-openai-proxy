/**
 * SDK conformance: models endpoints.
 *
 * Uses the official openai Node SDK to validate that /v1/models
 * responses parse correctly. Skips when no credentials are available.
 */

import { describe, expect, test } from "bun:test";
import { createTestClient, getCheapestModel, hasCredentials, setup } from "./helpers.js";

describe("SDK models conformance", () => {
	test("client.models.list() returns iterable model objects", async () => {
		if (!hasCredentials()) return;

		const { app } = setup();
		const client = createTestClient(app);
		const response = await client.models.list();

		const models: unknown[] = [];
		for await (const model of response) {
			models.push(model);
		}

		expect(models.length).toBeGreaterThan(0);

		const first = models[0] as Record<string, unknown>;
		expect(first["id"]).toBeString();
		expect(first["object"]).toBe("model");
		expect(first["created"]).toBeNumber();
		expect(first["owned_by"]).toBeString();
	});

	test("client.models.retrieve() returns a model object", async () => {
		const model = getCheapestModel();
		if (model === undefined) return;

		const { app } = setup();
		const client = createTestClient(app);
		const result = await client.models.retrieve(model.id);

		expect(result.object).toBe("model");
		expect(result.created).toBeNumber();
		expect(result.owned_by).toBeString();
	});
});
