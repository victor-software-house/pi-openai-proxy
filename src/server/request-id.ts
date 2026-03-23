/**
 * Per-request proxy request ID generation.
 *
 * Format: "piproxy-{random}" to be easily distinguishable from upstream IDs.
 */

import { randomBytes } from "node:crypto";

export function generateRequestId(): string {
	return `piproxy-${randomBytes(12).toString("hex")}`;
}
