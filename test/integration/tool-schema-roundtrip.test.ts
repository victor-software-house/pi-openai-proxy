import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getRegistry, initRegistry } from "@proxy/pi/registry";
import { isRecord } from "@proxy/utils/guards";
import { testApp, testConfig } from "../helpers";

const provider = "tool-schema-test";
const tools = [
	{
		type: "function",
		function: {
			name: "agent_browser_open",
			parameters: {
				type: "object",
				properties: { restore: { oneOf: [{ type: "string" }, { type: "boolean" }] } },
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "browser_drop",
			parameters: {
				type: "object",
				properties: { data: { type: "object", additionalProperties: { type: "string" } } },
			},
		},
	},
];

let upstream: ReturnType<typeof Bun.serve>;
let received: unknown;

beforeEach(() => {
	received = undefined;
	upstream = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			received = await request.json();
			const chunk = {
				id: "schema-test",
				object: "chat.completion.chunk",
				created: 0,
				model: "schema-test",
				choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
			};
			return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
				headers: { "Content-Type": "text/event-stream" },
			});
		},
	});
	initRegistry();
	getRegistry().registerProvider(provider, {
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${String(upstream.port)}/v1`,
		apiKey: "test-only-key",
		models: [
			{
				id: "schema-test",
				name: "Schema test",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8192,
				maxTokens: 1024,
			},
		],
	});
});

afterEach(() => {
	getRegistry().unregisterProvider(provider);
	upstream.stop(true);
});

describe("tool schemas through the HTTP and Pi SDK path", () => {
	for (const stream of [false, true]) {
		test(`forwards oneOf and additionalProperties with stream=${String(stream)}`, async () => {
			const app = testApp({ ...testConfig(), modelExposureMode: "all" });
			const response = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: `${provider}/schema-test`,
					messages: [{ role: "user", content: "Hello" }],
					tools,
					stream,
				}),
			});
			expect(response.status).toBe(200);
			const body = await response.text();
			expect(body).toContain('"content":"ok"');
			if (stream) expect(body).toContain("data: [DONE]");
			expect(isRecord(received)).toBe(true);
			if (!isRecord(received)) return;
			expect(received["tools"]).toMatchObject(tools);
		});
	}

	test("rejects unsupported nested schemas before calling the provider", async () => {
		const app = testApp({ ...testConfig(), modelExposureMode: "all" });
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: `${provider}/schema-test`,
				messages: [{ role: "user", content: "Hello" }],
				tools: [
					{
						type: "function",
						function: {
							name: "bad_tool",
							parameters: {
								type: "object",
								additionalProperties: { oneOf: [{ $ref: "#/definitions/Value" }] },
							},
						},
					},
				],
			}),
		});
		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({
			error: {
				code: "unsupported_parameter",
				param: "tools[0].function.parameters.additionalProperties.oneOf[0]",
			},
		});
		expect(received).toBeUndefined();
	});
});
