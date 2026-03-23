/**
 * Structured logging for the proxy.
 *
 * Logs JSON lines to stderr. Never logs secrets.
 */

export interface LogContext {
	readonly requestId: string;
	readonly clientRequestId?: string | undefined;
	readonly method: string;
	readonly path: string;
}

function timestamp(): string {
	return new Date().toISOString();
}

export function logRequest(ctx: LogContext): void {
	const entry = {
		ts: timestamp(),
		level: "info",
		event: "request",
		requestId: ctx.requestId,
		clientRequestId: ctx.clientRequestId,
		method: ctx.method,
		path: ctx.path,
	};
	console.error(JSON.stringify(entry));
}

export function logResponse(ctx: LogContext, status: number, durationMs: number): void {
	const entry = {
		ts: timestamp(),
		level: "info",
		event: "response",
		requestId: ctx.requestId,
		status,
		durationMs: Math.round(durationMs),
	};
	console.error(JSON.stringify(entry));
}

export function logError(ctx: LogContext, message: string, detail?: string): void {
	const entry = {
		ts: timestamp(),
		level: "error",
		event: "error",
		requestId: ctx.requestId,
		message,
		detail,
	};
	console.error(JSON.stringify(entry));
}

export function logDisconnect(ctx: LogContext): void {
	const entry = {
		ts: timestamp(),
		level: "info",
		event: "disconnect",
		requestId: ctx.requestId,
	};
	console.error(JSON.stringify(entry));
}

export function logStartup(host: string, port: number, modelCount: number): void {
	const entry = {
		ts: timestamp(),
		level: "info",
		event: "startup",
		host,
		port,
		modelCount,
	};
	console.error(JSON.stringify(entry));
}

export function logShutdown(signal: string): void {
	const entry = {
		ts: timestamp(),
		level: "info",
		event: "shutdown",
		signal,
	};
	console.error(JSON.stringify(entry));
}
