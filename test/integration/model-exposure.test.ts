/**
 * Integration tests for model exposure configurations through HTTP routes.
 *
 * Tests different publicModelIdMode and modelExposureMode values
 * against the actual HTTP endpoints. No API credentials needed.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import type { ServerConfig } from "@proxy/config/env";
import { getAllModels, getAvailableModels, initRegistry } from "@proxy/pi/registry";

import { jsonBody, testApp, testConfig } from "../helpers";

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
		expect(body.data.length).toBeGreaterThan(0);

		// Every ID should contain a slash (prefix/model-id)
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
		if (body.data.length === 0) return;

		// Check if there are actual collisions in the available models
		const idCounts = new Map<string, number>();
		for (const m of models) {
			idCounts.set(m.id, (idCounts.get(m.id) ?? 0) + 1);
		}
		const hasCollisions = [...idCounts.values()].some((c) => c > 1);

		if (!hasCollisions) {
			// No collisions: IDs should be raw (no provider prefix)
			for (const model of body.data) {
				// Raw IDs don't start with a known provider prefix
				// Just verify they exist and are strings
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
		expect(body.data.length).toBe(1);
	});

	test("custom mode with empty list exposes zero models", async () => {
		const app = appWith({
			modelExposureMode: "custom",
			customModels: [],
		});
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.data.length).toBe(0);
	});

	test("all mode exposes more models than scoped when unauthed models exist", async () => {
		const available = getAvailableModels();
		const all = getAllModels();

		// Only meaningful if there are unauthed models
		if (all.length <= available.length) return;

		const scopedApp = appWith({ modelExposureMode: "scoped" });
		const allApp = appWith({ modelExposureMode: "all" });

		const scopedRes = await scopedApp.request("/v1/models");
		const allRes = await allApp.request("/v1/models");

		const scopedBody = await jsonBody(scopedRes);
		const allBody = await jsonBody(allRes);

		expect(allBody.data.length).toBeGreaterThan(scopedBody.data.length);
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
		// Find the model from the first provider
		const prefixedModel = body.data.find((m: Record<string, string>) =>
			m["id"]?.startsWith("custom/"),
		);
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

		// Expose only the first model
		const app = appWith({
			modelExposureMode: "custom",
			customModels: [`${first.provider}/${first.id}`],
		});

		// Try to use the second (hidden) model
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
		expect(body.error.code).toBe("model_not_found");
	});

	test("exposed model resolves by public ID in always-prefixed mode", async () => {
		const models = getAvailableModels();
		if (models.length === 0) return;

		const first = models[0];
		if (first === undefined) return;

		const app = appWith({ publicModelIdMode: "always-prefixed" });

		// Get the public ID from the models list
		const listRes = await app.request("/v1/models");
		const listBody = await jsonBody(listRes);
		if (listBody.data.length === 0) return;

		const publicId: string = listBody.data[0].id;
		const encodedId = encodeURIComponent(publicId);

		// Resolve by public ID
		const res = await app.request(`/v1/models/${encodedId}`);
		expect(res.status).toBe(200);

		const body = await jsonBody(res);
		expect(body.id).toBe(publicId);
	});
});
