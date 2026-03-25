/**
 * Shared type guard utilities.
 */

/**
 * Narrow `unknown` to `Record<string, unknown>`.
 * Rejects null, undefined, and arrays.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
