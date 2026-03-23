import { jsonBody } from "../helpers.js";
/**
 * Integration tests for POST /v1/chat/completions validation.
 *
 * These tests validate request parsing, validation, and error responses
 * without requiring actual API credentials.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "@proxy/config/env.js";
import { initRegistry } from "@proxy/pi/registry.js";
import { createApp } from "@proxy/server/app.js";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
	initRegistry();
	app = createApp(loadConfig());
});

describe("POST /v1/chat/completions - validation", () => {
	test("rejects invalid JSON", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.type).toBe("invalid_request_error");
	});

	test("rejects missing model", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		expect(res.status).toBe(400);
	});

	test("rejects empty messages", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [],
			}),
		});
		expect(res.status).toBe(400);
	});

	test("accepts tools in Phase 2", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "fakeprovider/fake-model",
				messages: [{ role: "user", content: "Hello" }],
				tools: [
					{
						type: "function",
						function: {
							name: "get_weather",
							description: "Get the weather",
							parameters: {
								type: "object",
								properties: { city: { type: "string" } },
								required: ["city"],
							},
						},
					},
				],
			}),
		});
		// Should pass validation -- gets 404 because the model doesn't exist
		expect(res.status).toBe(404);
	});

	test("rejects unsupported tool schemas with 422", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello" }],
				tools: [
					{
						type: "function",
						function: {
							name: "bad_tool",
							parameters: {
								type: "object",
								properties: {
									data: { $ref: "#/definitions/Data" },
								},
							},
						},
					},
				],
			}),
		});
		expect(res.status).toBe(422);
		const body = await jsonBody(res);
		expect(body.error.code).toBe("unsupported_parameter");
	});

	test("rejects permanently rejected fields with 422", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello" }],
				n: 2,
			}),
		});
		expect(res.status).toBe(422);
		const body = await jsonBody(res);
		expect(body.error.param).toBe("n");
	});

	test("rejects unknown fields with 422", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello" }],
				totally_made_up: true,
			}),
		});
		expect(res.status).toBe(422);
	});

	test("returns 404 for non-existent model", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "fakeprovider/fake-model",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		expect(res.status).toBe(404);
		const body = await jsonBody(res);
		expect(body.error.code).toBe("model_not_found");
	});

	test("returns request-id header", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		// Even on error, the request-id middleware should have set the header
		const requestId = res.headers.get("x-request-id");
		expect(requestId).toBeDefined();
		expect(requestId).toStartWith("piproxy-");
	});

	test("echoes x-client-request-id", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Client-Request-Id": "client-123",
			},
			body: JSON.stringify({
				model: "fakeprovider/fake-model",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		expect(res.headers.get("x-client-request-id")).toBe("client-123");
	});
});

describe("POST /v1/chat/completions - proxy auth", () => {
	test("blocks requests when proxy auth is configured", async () => {
		const authedApp = createApp({
			...loadConfig(),
			proxyAuthToken: "secret-token",
		});

		const res = await authedApp.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		expect(res.status).toBe(401);
	});

	test("accepts requests with correct proxy auth", async () => {
		const authedApp = createApp({
			...loadConfig(),
			proxyAuthToken: "secret-token",
		});

		const res = await authedApp.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer secret-token",
			},
			body: JSON.stringify({
				model: "fakeprovider/fake-model",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		// Should get past auth (model not found is OK)
		expect(res.status).toBe(404);
	});
});

describe("POST /v1/chat/completions - body size limit", () => {
	test("rejects requests exceeding body size limit", async () => {
		const smallLimitApp = createApp({
			...loadConfig(),
			maxBodySize: 100,
		});

		const res = await smallLimitApp.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": "200",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "a".repeat(150) }],
			}),
		});
		expect(res.status).toBe(413);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("too large");
	});

	test("allows requests within body size limit", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": "100",
			},
			body: JSON.stringify({
				model: "fakeprovider/fake-model",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		// Should not be 413
		expect(res.status).not.toBe(413);
	});

	test("does not apply body size limit to GET requests", async () => {
		const smallLimitApp = createApp({
			...loadConfig(),
			maxBodySize: 10,
		});

		const res = await smallLimitApp.request("/v1/models", {
			method: "GET",
			headers: {
				"Content-Length": "999999",
			},
		});
		expect(res.status).toBe(200);
	});
});

describe("POST /v1/chat/completions - upstream API key override", () => {
	test("accepts X-Pi-Upstream-Api-Key header without error", async () => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Pi-Upstream-Api-Key": "sk-override-key",
			},
			body: JSON.stringify({
				model: "fakeprovider/fake-model",
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		// Model not found is expected (no such provider), but not 400/422 from the header
		expect(res.status).toBe(404);
	});
});

describe("unsupported endpoints", () => {
	const endpoints = ["/v1/completions", "/v1/embeddings", "/v1/assistants"];

	for (const endpoint of endpoints) {
		test(`returns 404 for ${endpoint}`, async () => {
			const res = await app.request(endpoint, { method: "POST" });
			expect(res.status).toBe(404);
			const body = await jsonBody(res);
			expect(body.error.message).toContain("not supported");
		});
	}
});
