import { describe, expect, test } from "bun:test";
import { jsonSchemaToTypebox } from "@proxy/openai/json-schema-to-typebox.js";

describe("jsonSchemaToTypebox", () => {
	describe("primitive types", () => {
		test("converts string type", () => {
			const result = jsonSchemaToTypebox({ type: "string" });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("string");
		});

		test("converts number type", () => {
			const result = jsonSchemaToTypebox({ type: "number" });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("number");
		});

		test("converts integer type", () => {
			const result = jsonSchemaToTypebox({ type: "integer" });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("integer");
		});

		test("converts boolean type", () => {
			const result = jsonSchemaToTypebox({ type: "boolean" });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("boolean");
		});

		test("converts null type", () => {
			const result = jsonSchemaToTypebox({ type: "null" });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("null");
		});

		test("preserves description", () => {
			const result = jsonSchemaToTypebox({
				type: "string",
				description: "A name",
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["description"]).toBe("A name");
		});
	});

	describe("object type", () => {
		test("converts empty object", () => {
			const result = jsonSchemaToTypebox({ type: "object" });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("object");
		});

		test("converts object with properties", () => {
			const result = jsonSchemaToTypebox({
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "integer" },
				},
				required: ["name"],
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("object");
			expect(result.schema["required"]).toContain("name");
		});

		test("makes non-required properties optional", () => {
			const result = jsonSchemaToTypebox({
				type: "object",
				properties: {
					name: { type: "string" },
					nickname: { type: "string" },
				},
				required: ["name"],
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("object");
		});

		test("rejects additionalProperties as schema object", () => {
			const result = jsonSchemaToTypebox({
				type: "object",
				properties: { name: { type: "string" } },
				additionalProperties: { type: "string" },
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.message).toContain("additionalProperties");
		});

		test("allows additionalProperties as boolean", () => {
			const result = jsonSchemaToTypebox({
				type: "object",
				properties: { name: { type: "string" } },
				additionalProperties: false,
			});
			expect(result.ok).toBe(true);
		});
	});

	describe("array type", () => {
		test("converts array with item schema", () => {
			const result = jsonSchemaToTypebox({
				type: "array",
				items: { type: "string" },
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("array");
		});

		test("converts array without items", () => {
			const result = jsonSchemaToTypebox({ type: "array" });
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["type"]).toBe("array");
		});

		test("converts nested array of objects", () => {
			const result = jsonSchemaToTypebox({
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "integer" },
						tags: { type: "array", items: { type: "string" } },
					},
					required: ["id"],
				},
			});
			expect(result.ok).toBe(true);
		});
	});

	describe("enum", () => {
		test("converts string enum", () => {
			const result = jsonSchemaToTypebox({
				enum: ["red", "green", "blue"],
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["anyOf"]).toBeDefined();
		});

		test("rejects non-string enum values", () => {
			const result = jsonSchemaToTypebox({
				enum: [1, 2, 3],
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.message).toContain("string enums");
		});

		test("rejects empty enum", () => {
			const result = jsonSchemaToTypebox({ enum: [] });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.message).toContain("Empty enum");
		});
	});

	describe("nullable types", () => {
		test("converts nullable string", () => {
			const result = jsonSchemaToTypebox({
				type: ["string", "null"],
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.schema["anyOf"]).toBeDefined();
		});

		test("rejects multi-type arrays beyond nullable", () => {
			const result = jsonSchemaToTypebox({
				type: ["string", "number", "null"],
			});
			expect(result.ok).toBe(false);
		});
	});

	describe("rejected keywords", () => {
		test("rejects $ref", () => {
			const result = jsonSchemaToTypebox({
				$ref: "#/definitions/Foo",
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.message).toContain("$ref");
		});

		test("rejects oneOf", () => {
			const result = jsonSchemaToTypebox({
				oneOf: [{ type: "string" }, { type: "number" }],
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.message).toContain("oneOf");
		});

		test("rejects allOf", () => {
			const result = jsonSchemaToTypebox({
				allOf: [{ type: "object" }],
			});
			expect(result.ok).toBe(false);
		});

		test("rejects anyOf", () => {
			const result = jsonSchemaToTypebox({
				anyOf: [{ type: "string" }],
			});
			expect(result.ok).toBe(false);
		});

		test("rejects patternProperties", () => {
			const result = jsonSchemaToTypebox({
				type: "object",
				patternProperties: { "^S_": { type: "string" } },
			});
			expect(result.ok).toBe(false);
		});
	});

	describe("edge cases", () => {
		test("rejects non-object schema", () => {
			const result = jsonSchemaToTypebox("not an object");
			expect(result.ok).toBe(false);
		});

		test("handles empty object as unconstrained", () => {
			const result = jsonSchemaToTypebox({});
			expect(result.ok).toBe(true);
		});

		test("rejects unknown type", () => {
			const result = jsonSchemaToTypebox({ type: "date" });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.message).toContain("date");
		});

		test("tracks path through nested properties", () => {
			const result = jsonSchemaToTypebox({
				type: "object",
				properties: {
					nested: {
						type: "object",
						properties: {
							bad: { $ref: "#/definitions/Bad" },
						},
					},
				},
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.path).toBe("nested.bad");
		});
	});
});
