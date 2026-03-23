import { jsonBody } from "../helpers.js";
/**
 * Integration tests for GET /v1/models and GET /v1/models/:model
 *
 * These tests use pi's real ModelRegistry so they validate actual model data.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "@proxy/config/env.js";
import { getAllModels, initRegistry } from "@proxy/pi/registry.js";
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
			expect(first.id).toContain("/");
			expect(first.object).toBe("model");
			expect(first.owned_by).toBeDefined();
		}
	});

	test("model items have correct shape when auth is configured", async () => {
		// Uses getAllModels (ignores auth) to verify shape against the full registry
		const models = getAllModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;
		const canonicalId = `${first.provider}/${first.id}`;
		const encodedId = encodeURIComponent(canonicalId);

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.id).toBe(canonicalId);
		expect(body.object).toBe("model");
		expect(typeof body.created).toBe("number");
		expect(body.owned_by).toBe(first.provider);
	});
});

describe("GET /v1/models/:model", () => {
	test("returns model by canonical ID", async () => {
		const models = getAllModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;
		const canonicalId = `${first.provider}/${first.id}`;
		const encodedId = encodeURIComponent(canonicalId);

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.id).toBe(canonicalId);
		expect(body.object).toBe("model");
		expect(body.owned_by).toBe(first.provider);
	});

	test("returns model by unencoded canonical path", async () => {
		const models = getAllModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;
		const canonicalId = `${first.provider}/${first.id}`;

		// Hono should handle slash-separated path naturally
		const res = await app.request(`/v1/models/${canonicalId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.id).toBe(canonicalId);
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
