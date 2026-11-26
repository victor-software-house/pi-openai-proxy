import { describe, expect, test } from "bun:test";
import { jsonSchemaToTypebox } from "@proxy/openai/json-schema-to-typebox";
import { convertTools } from "@proxy/openai/tools";
import { Compile } from "typebox/compile";

function converted(schema: unknown) {
	const result = jsonSchemaToTypebox(schema);
	if (!result.ok) throw new Error(`${result.path}: ${result.message}`);
	return result.schema;
}

describe("oneOf tool schemas", () => {
	test("preserves oneOf and its description", () => {
		const schema = {
			description: "Restore a named profile or the last session",
			oneOf: [{ type: "string" }, { type: "boolean" }],
		};
		const result = converted(schema);
		expect(JSON.parse(JSON.stringify(result))).toEqual(schema);
		const check = Compile(result);
		expect(check.Check("profile")).toBe(true);
		expect(check.Check(true)).toBe(true);
		expect(check.Check(12)).toBe(false);
	});

	test("rejects values matching more than one branch", () => {
		const check = Compile(converted({ oneOf: [{ type: "number" }, { type: "integer" }] }));
		expect(check.Check(1)).toBe(false);
		expect(check.Check(1.5)).toBe(true);
		expect(check.Check("bad")).toBe(false);
	});

	test("preserves constraints alongside oneOf", () => {
		const check = Compile(
			converted({
				enum: ["saved"],
				oneOf: [{ type: "string" }, { type: "boolean" }],
			}),
		);
		expect(check.Check("saved")).toBe(true);
		expect(check.Check("other")).toBe(false);
		expect(check.Check(true)).toBe(false);
	});

	test("preserves object properties and required fields alongside oneOf", () => {
		const check = Compile(
			converted({
				type: "object",
				properties: { name: { type: "string" } },
				required: ["name"],
				additionalProperties: false,
				oneOf: [{ type: "object" }, { type: "null" }],
			}),
		);
		expect(check.Check({ name: "profile" })).toBe(true);
		expect(check.Check({})).toBe(false);
		expect(check.Check({ name: "profile", extra: true })).toBe(false);
		expect(check.Check(null)).toBe(false);
	});

	test("preserves anyOf alongside oneOf", () => {
		const check = Compile(
			converted({
				anyOf: [{ type: "string" }, { type: "null" }],
				oneOf: [{ type: "string" }, { type: "boolean" }],
			}),
		);
		expect(check.Check("profile")).toBe(true);
		expect(check.Check(true)).toBe(false);
		expect(check.Check(null)).toBe(false);
	});

	test("works in optional properties and array items", () => {
		const check = Compile(
			converted({
				type: "object",
				properties: {
					restore: { oneOf: [{ type: "string" }, { type: "boolean" }] },
					items: { type: "array", items: { oneOf: [{ type: "string" }, { type: "null" }] } },
				},
			}),
		);
		expect(check.Check({})).toBe(true);
		expect(check.Check({ restore: true, items: ["profile", null] })).toBe(true);
		expect(check.Check({ restore: 1 })).toBe(false);
		expect(check.Check({ items: [false] })).toBe(false);
	});

	test.each(
		[null, true, {}, "string", [], Array.from({ length: 11 }, () => ({ type: "string" }))].map(
			(value) => [value],
		),
	)("rejects malformed or oversized oneOf: %j", (oneOf) => {
		const result = jsonSchemaToTypebox({ type: "string", oneOf }, "restore");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.path).toBe("restore");
		expect(result.message).toContain("oneOf");
	});

	test("accepts the one-branch and ten-branch boundaries", () => {
		for (const count of [1, 10]) {
			const branches = Array.from({ length: count }, (_, i) => ({ enum: [String(i)] }));
			const check = Compile(converted({ oneOf: branches }));
			expect(check.Check("0")).toBe(true);
			expect(check.Check("missing")).toBe(false);
		}
	});

	test.each([
		true,
		{ $ref: "#/definitions/Profile" },
		{ allOf: [{ type: "string" }] },
	])("reports the path of an unsupported branch: %j", (branch) => {
		const result = jsonSchemaToTypebox({ oneOf: [{ type: "string" }, branch] }, "restore");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.path).toBe("restore.oneOf[1]");
	});
});

describe("additionalProperties tool schemas", () => {
	for (const properties of [undefined, {}, { name: { type: "string" } }]) {
		test(`validates dictionary values with properties ${JSON.stringify(properties)}`, () => {
			const check = Compile(
				converted({ type: "object", properties, additionalProperties: { type: "string" } }),
			);
			expect(check.Check({})).toBe(true);
			expect(check.Check({ "text/plain": "hello" })).toBe(true);
			expect(check.Check({ "text/plain": 12 })).toBe(false);
		});

		test(`preserves boolean policies with properties ${JSON.stringify(properties)}`, () => {
			for (const additionalProperties of [false, true]) {
				const check = Compile(converted({ type: "object", properties, additionalProperties }));
				expect(check.Check({})).toBe(true);
				expect(check.Check({ extra: 12 })).toBe(additionalProperties);
			}
		});
	}

	test("applies dictionary constraints only to undeclared properties", () => {
		const check = Compile(
			converted({
				type: "object",
				properties: { count: { type: "integer" } },
				required: ["count"],
				additionalProperties: { type: "string" },
			}),
		);
		expect(check.Check({ count: 1, label: "hello" })).toBe(true);
		expect(check.Check({ count: 1, label: 2 })).toBe(false);
		expect(check.Check({ label: "hello" })).toBe(false);
	});

	test("supports nested schemas and oneOf dictionary values", () => {
		const check = Compile(
			converted({
				type: "object",
				additionalProperties: {
					type: "array",
					items: { oneOf: [{ type: "string" }, { type: "boolean" }] },
				},
			}),
		);
		expect(check.Check({ params: ["profile", true] })).toBe(true);
		expect(check.Check({ params: [12] })).toBe(false);
	});

	test.each(
		[null, "string", [], { $ref: "#/definitions/Value" }].map((value) => [value]),
	)("rejects invalid dictionary schemas with their path: %j", (additionalProperties) => {
		const result = jsonSchemaToTypebox({ type: "object", additionalProperties }, "data");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.path).toBe("data.additionalProperties");
	});
});

test("converts browser tools together without dropping an incompatible tool", () => {
	const result = convertTools([
		{
			type: "function",
			function: {
				name: "agent_browser_open",
				parameters: {
					type: "object",
					properties: { restore: { oneOf: [{ type: "string" }, { type: "boolean" }] } },
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
	]);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.tools.map((tool) => tool.name)).toEqual(["agent_browser_open", "browser_drop"]);
	for (const tool of result.tools) expect(Compile(tool.parameters).Check({})).toBe(true);
});
