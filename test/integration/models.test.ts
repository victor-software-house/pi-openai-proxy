import { jsonBody } from "../helpers.js";
/**
 * Integration tests for GET /v1/models and GET /v1/models/:model
 *
 * These tests use pi's real ModelRegistry and the model-exposure engine.
 * Only available (auth-configured) models are exposed through the API.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "@proxy/config/env.js";
import { getAvailableModels, initRegistry } from "@proxy/pi/registry.js";
import { createApp } from "@proxy/server/app.js";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
	initRegistry();
	app = createApp(loadConfig());
});

describe("GET /v1/models", () => {
	test("returns OpenAI-compatible list shape", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.object).toBe("list");
		expect(Array.isArray(body.data)).toBe(true);

		// In CI there may be no auth.json, so available models can be 0.
		// Validate item shape only when models are present.
		if (body.data.length > 0) {
			const first = body.data[0];
			expect(first.object).toBe("model");
			expect(first.owned_by).toBeDefined();
			expect(typeof first.created).toBe("number");
			// No x_pi field (removed in Phase 3A)
			expect(first.x_pi).toBeUndefined();
		}
	});

	test("model items have correct shape when auth is configured", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		// Fetch the list and verify the first item is reachable by its public ID
		const listRes = await app.request("/v1/models");
		const listBody = await jsonBody(listRes);
		if (listBody.data.length === 0) return;

		const first = listBody.data[0];
		const publicId: string = first.id;
		const encodedId = encodeURIComponent(publicId);

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.id).toBe(publicId);
		expect(body.object).toBe("model");
		expect(typeof body.created).toBe("number");
		expect(typeof body.owned_by).toBe("string");
	});
});

describe("GET /v1/models/:model", () => {
	test("returns model by public ID", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		// Get a public ID from the models list
		const listRes = await app.request("/v1/models");
		const listBody = await jsonBody(listRes);
		if (listBody.data.length === 0) return;

		const first = listBody.data[0];
		const publicId: string = first.id;
		const encodedId = encodeURIComponent(publicId);

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.id).toBe(publicId);
		expect(body.object).toBe("model");
		expect(body.owned_by).toBe(first.owned_by);
	});

	test("returns model by canonical ID fallback for exposed models", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;
		const canonicalId = `${first.provider}/${first.id}`;
		const encodedId = encodeURIComponent(canonicalId);

		// Canonical ID fallback should work for models that are exposed
		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.object).toBe("model");
		expect(body.owned_by).toBe(first.provider);
	});

	test("returns model by unencoded path with slashes", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;
		const canonicalId = `${first.provider}/${first.id}`;

		// Hono should handle slash-separated path naturally
		const res = await app.request(`/v1/models/${canonicalId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.object).toBe("model");
	});

	test("returns 404 for unknown model", async () => {
		const res = await app.request("/v1/models/nonexistent%2Fmodel");
		expect(res.status).toBe(404);

		const body = await jsonBody(res);
		expect(body.error).toBeDefined();
		expect(body.error.type).toBe("invalid_request_error");
		expect(body.error.code).toBe("model_not_found");
	});
});
