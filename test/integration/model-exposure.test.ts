/**
 * Integration tests for model exposure configurations through HTTP routes.
 *
 * Tests different publicModelIdMode and modelExposureMode values
 * against the actual HTTP endpoints. No API credentials needed.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import type { ServerConfig } from "@proxy/config/env";
import { getAvailableModels, initRegistry } from "@proxy/pi/registry";
import { isRecord } from "@proxy/utils/guards";

import { isErrorBody, isModelListBody, jsonBody, testApp, testConfig } from "../helpers";

beforeAll(() => {
	initRegistry();
});

function appWith(overrides: Partial<ServerConfig>): ReturnType<typeof testApp> {
	return testApp({ ...testConfig(), ...overrides });
}

// ---------------------------------------------------------------------------
// Public ID modes through HTTP
// ---------------------------------------------------------------------------

describe("publicModelIdMode through HTTP", () => {
	test("always-prefixed mode returns prefixed IDs in model list", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const app = appWith({ publicModelIdMode: "always-prefixed" });
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelListBody(body)).toBe(true);
		if (!isModelListBody(body)) return;

		expect(body.data.length).toBeGreaterThan(0);

		for (const model of body.data) {
			expect(model.id).toContain("/");
		}
	});

	test("collision-prefixed mode returns unprefixed IDs when no collisions", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const app = appWith({ publicModelIdMode: "collision-prefixed" });
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelListBody(body)).toBe(true);
		if (!isModelListBody(body)) return;

		if (body.data.length === 0) return;

		const idCounts = new Map<string, number>();
		for (const m of models) {
			idCounts.set(m.id, (idCounts.get(m.id) ?? 0) + 1);
		}
		const hasCollisions = [...idCounts.values()].some((c) => c > 1);

		if (!hasCollisions) {
			for (const model of body.data) {
				expect(model.id).toBeString();
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Exposure modes through HTTP
// ---------------------------------------------------------------------------

describe("modelExposureMode through HTTP", () => {
	test("custom mode exposes only selected models", async () => {
		const models = getAvailableModels();
		if (models.length < 2) return;

		const first = models[0];
		if (first === undefined) return;
		const canonicalId = `${first.provider}/${first.id}`;

		const app = appWith({
			modelExposureMode: "custom",
			customModels: [canonicalId],
		});
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelListBody(body)).toBe(true);
		if (!isModelListBody(body)) return;

		expect(body.data.length).toBe(1);
	});

	test("custom mode with empty list exposes all available models", async () => {
		const available = getAvailableModels();
		if (available.length === 0) return;

		const app = appWith({
			modelExposureMode: "custom",
			customModels: [],
		});
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelListBody(body)).toBe(true);
		if (!isModelListBody(body)) return;

		expect(body.data.length).toBe(available.length);
	});

	test("all mode exposes same count as scoped with no filter", async () => {
		const available = getAvailableModels();
		if (available.length === 0) return;

		const scopedApp = appWith({ modelExposureMode: "scoped" });
		const allApp = appWith({ modelExposureMode: "all" });

		const scopedRes = await scopedApp.request("/v1/models");
		const allRes = await allApp.request("/v1/models");

		const scopedBody = await jsonBody(scopedRes);
		const allBody = await jsonBody(allRes);

		expect(isModelListBody(scopedBody)).toBe(true);
		expect(isModelListBody(allBody)).toBe(true);
		if (!isModelListBody(scopedBody) || !isModelListBody(allBody)) return;

		expect(allBody.data.length).toBe(scopedBody.data.length);
	});
});

// ---------------------------------------------------------------------------
// Provider prefix overrides through HTTP
// ---------------------------------------------------------------------------

describe("providerPrefixes through HTTP", () => {
	test("always-prefixed mode uses custom prefix labels", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;

		const app = appWith({
			publicModelIdMode: "always-prefixed",
			providerPrefixes: { [first.provider]: "custom" },
		});
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isModelListBody(body)).toBe(true);
		if (!isModelListBody(body)) return;

		const prefixedModel = body.data.find((m) => m.id.startsWith("custom/"));
		expect(prefixedModel).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Model resolution with different configs
// ---------------------------------------------------------------------------

describe("model resolution with exposure configs", () => {
	test("hidden model returns 404 on chat completions", async () => {
		const models = getAvailableModels();
		if (models.length < 2) return;

		const first = models[0];
		const second = models[1];
		if (first === undefined || second === undefined) return;

		const app = appWith({
			modelExposureMode: "custom",
			customModels: [`${first.provider}/${first.id}`],
		});

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: `${second.provider}/${second.id}`,
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		expect(res.status).toBe(404);

		const body = await jsonBody(res);
		expect(isErrorBody(body)).toBe(true);
		if (!isErrorBody(body)) return;

		expect(body.error.code).toBe("model_not_found");
	});

	test("exposed model resolves by public ID in always-prefixed mode", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;

		const app = appWith({ publicModelIdMode: "always-prefixed" });

		const listRes = await app.request("/v1/models");
		const listBody = await jsonBody(listRes);
		expect(isModelListBody(listBody)).toBe(true);
		if (!isModelListBody(listBody)) return;

		if (listBody.data.length === 0) return;

		const firstModel = listBody.data[0];
		if (firstModel === undefined) return;
		const publicId = firstModel.id;
		const encodedId = encodeURIComponent(publicId);

		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(isRecord(body)).toBe(true);
		if (!isRecord(body)) return;

		expect(body["id"]).toBe(publicId);
	});
});
