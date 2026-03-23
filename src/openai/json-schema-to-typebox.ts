/**
 * JSON Schema -> TypeBox conversion for OpenAI function tool parameters.
 *
 * Phase 2 contract:
 * - Support a documented subset of JSON Schema only
 * - Reject unsupported schema constructs with ConversionError
 * - Do not silently downgrade complex schemas
 *
 * Supported subset:
 * - type: object, string, number, integer, boolean, array, null
 * - properties, required
 * - enum (string enums)
 * - arrays with supported item schema
 * - nullable via type: [T, "null"]
 * - anyOf for nullable types and simple unions (max 10 branches)
 * - description on any schema node
 *
 * Rejected:
 * - $ref
 * - oneOf, allOf
 * - recursive schemas
 * - additionalProperties as a schema (boolean true/false allowed)
 * - patternProperties
 * - if/then/else
 */

import type { TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

export interface SchemaConversionSuccess {
	readonly ok: true;
	readonly schema: TSchema;
}

export interface SchemaConversionError {
	readonly ok: false;
	readonly message: string;
	readonly path: string;
}

export type SchemaConversionResult = SchemaConversionSuccess | SchemaConversionError;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Unsupported JSON Schema keywords that we reject explicitly.
 * Note: `anyOf` is handled separately for common patterns (nullable types, simple unions).
 */
const REJECTED_KEYWORDS = [
	"$ref",
	"oneOf",
	"allOf",
	"if",
	"then",
	"else",
	"patternProperties",
	"not",
] as const;

/**
 * Convert a JSON Schema object to a TypeBox TSchema.
 *
 * Returns a ConversionError for unsupported constructs.
 */
export function jsonSchemaToTypebox(schema: unknown, path: string = ""): SchemaConversionResult {
	if (!isRecord(schema)) {
		return {
			ok: false,
			message: "Schema must be an object",
			path,
		};
	}

	// Check for rejected keywords
	for (const keyword of REJECTED_KEYWORDS) {
		if (schema[keyword] !== undefined) {
			return {
				ok: false,
				message: `Unsupported JSON Schema keyword '${keyword}' at ${path || "root"}`,
				path,
			};
		}
	}

	const description = typeof schema["description"] === "string" ? schema["description"] : undefined;
	const opts: Record<string, unknown> = {};
	if (description !== undefined) {
		opts["description"] = description;
	}

	// Handle anyOf: common patterns like nullable types and simple type unions.
	// Example: anyOf: [{type: "string"}, {type: "null"}] -> Union(String, Null)
	const anyOf = schema["anyOf"];
	if (Array.isArray(anyOf)) {
		return convertAnyOf(anyOf, path, opts);
	}

	// Handle enum
	const enumValues = schema["enum"];
	if (Array.isArray(enumValues)) {
		return convertEnum(enumValues, path, opts);
	}

	// Determine the type
	const rawType = schema["type"];

	// Handle nullable via type: [T, "null"]
	if (Array.isArray(rawType)) {
		return convertNullableType(rawType, schema, path, opts);
	}

	if (typeof rawType !== "string") {
		// No type specified -- treat as an unconstrained schema if it's an empty object
		if (
			Object.keys(schema).length === 0 ||
			(Object.keys(schema).length === 1 && description !== undefined)
		) {
			return { ok: true, schema: Type.Unknown(opts) };
		}
		return {
			ok: false,
			message: `Missing or invalid 'type' at ${path || "root"}`,
			path,
		};
	}

	switch (rawType) {
		case "object":
			return convertObject(schema, path, opts);
		case "string":
			return { ok: true, schema: Type.String(opts) };
		case "number":
			return { ok: true, schema: Type.Number(opts) };
		case "integer":
			return { ok: true, schema: Type.Integer(opts) };
		case "boolean":
			return { ok: true, schema: Type.Boolean(opts) };
		case "null":
			return { ok: true, schema: Type.Null(opts) };
		case "array":
			return convertArray(schema, path, opts);
		default:
			return {
				ok: false,
				message: `Unsupported type '${rawType}' at ${path || "root"}`,
				path,
			};
	}
}

/**
 * Convert anyOf to a TypeBox Union.
 *
 * Supports:
 * - Nullable: anyOf: [{type: T}, {type: "null"}]
 * - Simple unions of supported types (max 10 branches)
 */
function convertAnyOf(
	branches: unknown[],
	path: string,
	opts: Record<string, unknown>,
): SchemaConversionResult {
	if (branches.length === 0) {
		return { ok: false, message: `Empty 'anyOf' at ${path || "root"}`, path };
	}
	if (branches.length > 10) {
		return {
			ok: false,
			message: `'anyOf' with more than 10 branches is not supported at ${path || "root"}`,
			path,
		};
	}

	const converted: TSchema[] = [];
	for (let i = 0; i < branches.length; i++) {
		const branchPath = `${path || "root"}.anyOf[${String(i)}]`;
		const result = jsonSchemaToTypebox(branches[i], branchPath);
		if (!result.ok) {
			return result;
		}
		converted.push(result.schema);
	}

	return { ok: true, schema: Type.Union(converted, opts) };
}

function convertEnum(
	values: unknown[],
	path: string,
	opts: Record<string, unknown>,
): SchemaConversionResult {
	const stringValues: string[] = [];
	for (const v of values) {
		if (typeof v !== "string") {
			return {
				ok: false,
				message: `Only string enums are supported at ${path || "root"}`,
				path,
			};
		}
		stringValues.push(v);
	}
	if (stringValues.length === 0) {
		return {
			ok: false,
			message: `Empty enum at ${path || "root"}`,
			path,
		};
	}
	// Use Type.Union of literals for string enums
	const literals = stringValues.map((v) => Type.Literal(v));
	return { ok: true, schema: Type.Union(literals, opts) };
}

function convertNullableType(
	typeArray: unknown[],
	schema: Record<string, unknown>,
	path: string,
	opts: Record<string, unknown>,
): SchemaConversionResult {
	const nonNullTypes = typeArray.filter((t) => t !== "null");
	if (nonNullTypes.length !== 1 || typeArray.length !== 2) {
		return {
			ok: false,
			message: `Only [type, "null"] nullable types are supported at ${path || "root"}`,
			path,
		};
	}

	const innerType = nonNullTypes[0];
	if (typeof innerType !== "string") {
		return {
			ok: false,
			message: `Invalid nullable type at ${path || "root"}`,
			path,
		};
	}

	// Recurse with the inner type
	const innerSchema = { ...schema, type: innerType };
	const innerResult = jsonSchemaToTypebox(innerSchema, path);
	if (!innerResult.ok) {
		return innerResult;
	}

	return { ok: true, schema: Type.Union([innerResult.schema, Type.Null()], opts) };
}

function convertObject(
	schema: Record<string, unknown>,
	path: string,
	opts: Record<string, unknown>,
): SchemaConversionResult {
	const rawProperties = schema["properties"];
	const rawRequired = schema["required"];
	const additionalProperties = schema["additionalProperties"];

	// Reject additionalProperties when it's a schema object (boolean is allowed)
	if (additionalProperties !== undefined && typeof additionalProperties !== "boolean") {
		return {
			ok: false,
			message: `'additionalProperties' as a schema is not supported at ${path || "root"}; only boolean values are allowed`,
			path,
		};
	}

	// Object with no properties -- just return an empty object type
	if (rawProperties === undefined) {
		return { ok: true, schema: Type.Object({}, opts) };
	}

	if (!isRecord(rawProperties)) {
		return {
			ok: false,
			message: `'properties' must be an object at ${path || "root"}`,
			path,
		};
	}

	const requiredSet = new Set<string>();
	if (Array.isArray(rawRequired)) {
		for (const r of rawRequired) {
			if (typeof r === "string") {
				requiredSet.add(r);
			}
		}
	}

	const typeboxProperties: Record<string, TSchema> = {};

	for (const [key, propSchema] of Object.entries(rawProperties)) {
		const propPath = path.length > 0 ? `${path}.${key}` : key;
		const result = jsonSchemaToTypebox(propSchema, propPath);
		if (!result.ok) {
			return result;
		}

		if (requiredSet.has(key)) {
			typeboxProperties[key] = result.schema;
		} else {
			typeboxProperties[key] = Type.Optional(result.schema);
		}
	}

	return { ok: true, schema: Type.Object(typeboxProperties, opts) };
}

function convertArray(
	schema: Record<string, unknown>,
	path: string,
	opts: Record<string, unknown>,
): SchemaConversionResult {
	const items = schema["items"];
	if (items === undefined) {
		// Array with no items schema -- allow any items
		return { ok: true, schema: Type.Array(Type.Unknown(), opts) };
	}

	const itemPath = path.length > 0 ? `${path}.items` : "items";
	const itemResult = jsonSchemaToTypebox(items, itemPath);
	if (!itemResult.ok) {
		return itemResult;
	}

	return { ok: true, schema: Type.Array(itemResult.schema, opts) };
}
