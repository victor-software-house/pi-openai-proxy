/**
 * Parse JSON response body for test assertions.
 *
 * Returns `any` so tests can use dot notation on unknown response shapes.
 * This is intentional -- test files assert on response structure, not type it.
 */

// biome-ignore lint/suspicious/noExplicitAny: test helper for response assertion
export async function jsonBody(res: Response): Promise<any> {
	return res.json();
}
