/**
 * Security tests for image URL handling.
 *
 * Validates that remote image URLs are blocked, oversized payloads are
 * rejected, and only supported MIME types are accepted.
 * No credentials needed.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { getAvailableModels, initRegistry } from "@proxy/pi/registry";
import { createApp } from "@proxy/server/app";
import { jsonBody, testConfig } from "../helpers";

let app: ReturnType<typeof createApp>;
let modelId: string | undefined;

beforeAll(() => {
	initRegistry();
	app = createApp(testConfig());
	const models = getAvailableModels();
	const first = models[0];
	if (first !== undefined) {
		modelId = `${first.provider}/${first.id}`;
	}
});

function chatRequestWithImage(imageUrl: string): string {
	// These tests validate image URL handling in message conversion.
	// Model resolution must succeed first, so use a real model ID.
	// If no models are available, the test will be skipped.
	return JSON.stringify({
		model: modelId ?? "unavailable/model",
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "What is this?" },
					{ type: "image_url", image_url: { url: imageUrl } },
				],
			},
		],
	});
}

describe("image URL security", () => {
	test("rejects remote HTTP URL", async () => {
		if (modelId === undefined) return;
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: chatRequestWithImage("http://example.com/image.png"),
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("Remote image URLs are not supported");
	});

	test("rejects remote HTTPS URL", async () => {
		if (modelId === undefined) return;
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: chatRequestWithImage("https://example.com/photo.jpg"),
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("Remote image URLs are not supported");
	});

	test("rejects localhost URL", async () => {
		if (modelId === undefined) return;
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: chatRequestWithImage("http://localhost:8080/secret.png"),
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("Remote image URLs are not supported");
	});

	test("rejects private-range IP URL", async () => {
		if (modelId === undefined) return;
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: chatRequestWithImage("http://192.168.1.1/image.png"),
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("Remote image URLs are not supported");
	});

	test("rejects oversized base64 payload", async () => {
		if (modelId === undefined) return;
		// Create a data URI larger than 20MB
		const oversizedData = "A".repeat(21 * 1024 * 1024);
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: chatRequestWithImage(`data:image/png;base64,${oversizedData}`),
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("exceeds maximum size");
	});

	test("rejects unsupported MIME type", async () => {
		if (modelId === undefined) return;
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: chatRequestWithImage("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("Unsupported image MIME type");
	});

	test("rejects invalid data URI format", async () => {
		if (modelId === undefined) return;
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: chatRequestWithImage("data:not-valid"),
		});
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.error.message).toContain("Invalid base64 data URI");
	});
});
