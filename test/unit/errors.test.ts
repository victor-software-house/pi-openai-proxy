import { describe, expect, test } from "bun:test";
import {
	invalidRequest,
	mapUpstreamError,
	modelNotFound,
	unsupportedParameter,
} from "@proxy/server/errors";

describe("error helpers", () => {
	test("invalidRequest creates correct shape", () => {
		const err = invalidRequest("bad input", "model");
		expect(err.error.message).toBe("bad input");
		expect(err.error.type).toBe("invalid_request_error");
		expect(err.error.param).toBe("model");
		expect(err.error.code).toBeNull();
	});

	test("modelNotFound creates correct shape", () => {
		const err = modelNotFound("fake/model");
		expect(err.error.message).toContain("fake/model");
		expect(err.error.code).toBe("model_not_found");
	});

	test("unsupportedParameter creates correct shape", () => {
		const err = unsupportedParameter("tools");
		expect(err.error.param).toBe("tools");
		expect(err.error.code).toBe("unsupported_parameter");
	});
});

describe("mapUpstreamError", () => {
	test("maps rate limit errors to 429", () => {
		const result = mapUpstreamError(new Error("rate limit exceeded"));
		expect(result.status).toBe(429);
	});

	test("maps timeout errors to 504", () => {
		const result = mapUpstreamError(new Error("ETIMEDOUT"));
		expect(result.status).toBe(504);
	});

	test("maps auth errors to 502", () => {
		const result = mapUpstreamError(new Error("401 Unauthorized"));
		expect(result.status).toBe(502);
	});

	test("maps overloaded errors to 503", () => {
		const result = mapUpstreamError(new Error("529 overloaded"));
		expect(result.status).toBe(503);
	});

	test("maps unknown errors to 502", () => {
		const result = mapUpstreamError(new Error("something weird"));
		expect(result.status).toBe(502);
	});

	test("handles non-Error objects", () => {
		const result = mapUpstreamError("string error");
		expect(result.status).toBe(502);
	});
});
