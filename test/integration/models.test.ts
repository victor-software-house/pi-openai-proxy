/**
 * Integration tests for GET /v1/models and GET /v1/models/:model
 *
 * These tests use pi's real ModelRegistry and the model-exposure engine.
 * Only available (auth-configured) models are exposed through the API.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { getAvailableModels, initRegistry } from "@proxy/pi/registry";

import { isErrorBody, isModelListBody, isModelObject, jsonBody, testApp } from "../helpers";

let app: ReturnType<typeof testApp>;

beforeAll(() => {
	initRegistry();
	app = testApp();
});

describe("GET /v1/models", () => {
	test("returns OpenAI-compatible list shape", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelListBody(body)).toBe(true);
		if (!isModelListBody(body)) return;

		expect(body.object).toBe("list");
		expect(body.data).toBeArray();

		if (body.data.length > 0) {
			const first = body.data[0];
			if (first === undefined) return;
			expect(first.object).toBe("model");
			expect(first.owned_by).toBeDefined();
			expect(first.created).toBeNumber();
		}
	});

	test("model items have correct shape when auth is configured", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const listRes = await app.request("/v1/models");
		const listBody = await jsonBody(listRes);
		if (!isModelListBody(listBody)) return;
		if (listBody.data.length === 0) return;

		const first = listBody.data[0];
		if (first === undefined) return;
		const publicId = first.id;
		const encodedId = encodeURIComponent(publicId);

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelObject(body)).toBe(true);
		if (!isModelObject(body)) return;

		expect(body.id).toBe(publicId);
		expect(body.object).toBe("model");
		expect(body.created).toBeNumber();
		expect(body.owned_by).toBeString();
	});
});

describe("GET /v1/models/:model", () => {
	test("returns model by public ID", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const listRes = await app.request("/v1/models");
		const listBody = await jsonBody(listRes);
		if (!isModelListBody(listBody)) return;
		if (listBody.data.length === 0) return;

		const first = listBody.data[0];
		if (first === undefined) return;
		const publicId = first.id;
		const encodedId = encodeURIComponent(publicId);

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelObject(body)).toBe(true);
		if (!isModelObject(body)) return;

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

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelObject(body)).toBe(true);
		if (!isModelObject(body)) return;

		expect(body.object).toBe("model");
		expect(body.owned_by).toBe(first.provider);
	});

	test("returns model by unencoded path with slashes", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;
		const canonicalId = `${first.provider}/${first.id}`;

		const res = await app.request(`/v1/models/${canonicalId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelObject(body)).toBe(true);
		if (!isModelObject(body)) return;

		expect(body.object).toBe("model");
	});

	test("returns 404 for unknown model", async () => {
		const res = await app.request("/v1/models/nonexistent%2Fmodel");
		expect(res.status).toBe(404);

		const body = await jsonBody(res);
		expect(isErrorBody(body)).toBe(true);
		if (!isErrorBody(body)) return;

		expect(body.error.type).toBe("invalid_request_error");
		expect(body.error.code).toBe("model_not_found");
	});
});
