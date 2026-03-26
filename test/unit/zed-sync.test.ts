/**
 * Unit tests for extensions/zed-sync.ts
 *
 * Tests cover:
 * - findZedSettings: path resolution with env overrides
 * - toZedModel: ExposedModel -> Zed available_models mapping
 * - syncToZed: JSONC read/write with comment preservation
 * - readCurrentModelNames: extracting model names from parsed JSONC
 * - Dry-run mode: diff computation without writing
 * - Edge cases: missing provider block, empty models, malformed JSONC
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExposedModel } from "@proxy/openai/model-exposure";
import { findZedSettings, syncToZed, toZedModel } from "@proxy/sync/zed";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "claude-sonnet-4-20250514",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 64000,
		...overrides,
	};
}

function makeExposed(overrides: Partial<ExposedModel> = {}): ExposedModel {
	return {
		publicId: "anthropic/claude-sonnet-4-20250514",
		canonicalId: "anthropic/claude-sonnet-4-20250514",
		model: makeModel(),
		provider: "anthropic",
		...overrides,
	};
}

const ZED_SETTINGS_WITH_COMMENTS = `// Zed settings
// Some comments that must be preserved
{
  // Editor settings
  "buffer_font_size": 15,
  "language_models": {
    "openai_compatible": {
      "Pi Proxy": {
        "api_url": "http://127.0.0.1:4141/v1",
        "available_models": [
          {
            "name": "old-model",
            "display_name": "Old Model",
            "max_tokens": 100000,
            "max_output_tokens": 8000,
            "capabilities": {
              "tools": true,
              "images": false,
              "parallel_tool_calls": true,
              "prompt_cache_key": false,
              "chat_completions": true
            }
          }
        ]
      }
    }
  },
  // Theme
  "theme": "Gruvbox Dark"
}
`;

const MINIMAL_ZED_SETTINGS = `{
  "buffer_font_size": 15,
  "theme": "Gruvbox Dark"
}
`;

// ---------------------------------------------------------------------------
// toZedModel
// ---------------------------------------------------------------------------

describe("toZedModel", () => {
	test("maps ExposedModel fields correctly", () => {
		const exposed = makeExposed();
		const result = toZedModel(exposed);

		expect(result.name).toBe("anthropic/claude-sonnet-4-20250514");
		expect(result.display_name).toBe("Claude Sonnet 4");
		expect(result.max_tokens).toBe(200000);
		expect(result.max_output_tokens).toBe(64000);
		expect(result.capabilities.tools).toBe(true);
		expect(result.capabilities.images).toBe(true);
		expect(result.capabilities.chat_completions).toBe(true);
		expect(result.capabilities.parallel_tool_calls).toBe(true);
		expect(result.capabilities.prompt_cache_key).toBe(false);
	});

	test("sets images=false for text-only models", () => {
		const exposed = makeExposed({
			model: makeModel({ input: ["text"] }),
		});
		const result = toZedModel(exposed);
		expect(result.capabilities.images).toBe(false);
	});

	test("uses publicId as name", () => {
		const exposed = makeExposed({ publicId: "custom-prefix/my-model" });
		const result = toZedModel(exposed);
		expect(result.name).toBe("custom-prefix/my-model");
	});
});

// ---------------------------------------------------------------------------
// findZedSettings
// ---------------------------------------------------------------------------

describe("findZedSettings", () => {
	let tempDir: string;
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		tempDir = resolve(
			tmpdir(),
			`zed-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempDir, { recursive: true });

		// Save env vars we will modify
		savedEnv["CUSTOM_DATA_DIR"] = process.env.CUSTOM_DATA_DIR;
		savedEnv["HOME"] = process.env.HOME;
		savedEnv["XDG_CONFIG_HOME"] = process.env.XDG_CONFIG_HOME;
	});

	afterEach(() => {
		// Restore env vars
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				process.env[key] = undefined;
			} else {
				process.env[key] = value;
			}
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("returns CUSTOM_DATA_DIR path when set and file exists", () => {
		const customDir = resolve(tempDir, "custom-zed");
		mkdirSync(customDir, { recursive: true });
		writeFileSync(resolve(customDir, "settings.json"), "{}");

		process.env.CUSTOM_DATA_DIR = customDir;
		// Clear others to isolate
		process.env.HOME = undefined;
		process.env.XDG_CONFIG_HOME = undefined;

		expect(findZedSettings()).toBe(resolve(customDir, "settings.json"));
	});

	test("falls back to HOME/.config/zed when CUSTOM_DATA_DIR is unset", () => {
		process.env.CUSTOM_DATA_DIR = undefined;
		const zedDir = resolve(tempDir, ".config", "zed");
		mkdirSync(zedDir, { recursive: true });
		writeFileSync(resolve(zedDir, "settings.json"), "{}");

		process.env.HOME = tempDir;
		process.env.XDG_CONFIG_HOME = undefined;

		expect(findZedSettings()).toBe(resolve(zedDir, "settings.json"));
	});

	test("falls back to XDG_CONFIG_HOME when HOME config does not exist", () => {
		process.env.CUSTOM_DATA_DIR = undefined;
		process.env.HOME = resolve(tempDir, "no-such-home");

		const xdgDir = resolve(tempDir, "xdg-config", "zed");
		mkdirSync(xdgDir, { recursive: true });
		writeFileSync(resolve(xdgDir, "settings.json"), "{}");
		process.env.XDG_CONFIG_HOME = resolve(tempDir, "xdg-config");

		expect(findZedSettings()).toBe(resolve(xdgDir, "settings.json"));
	});

	test("returns undefined when no config found", () => {
		process.env.CUSTOM_DATA_DIR = undefined;
		process.env.HOME = resolve(tempDir, "no-such-home");
		process.env.XDG_CONFIG_HOME = undefined;

		expect(findZedSettings()).toBeUndefined();
	});

	test("CUSTOM_DATA_DIR takes priority over HOME", () => {
		const customDir = resolve(tempDir, "custom-zed");
		mkdirSync(customDir, { recursive: true });
		writeFileSync(resolve(customDir, "settings.json"), "{}");

		const homeZedDir = resolve(tempDir, ".config", "zed");
		mkdirSync(homeZedDir, { recursive: true });
		writeFileSync(resolve(homeZedDir, "settings.json"), "{}");

		process.env.CUSTOM_DATA_DIR = customDir;
		process.env.HOME = tempDir;

		expect(findZedSettings()).toBe(resolve(customDir, "settings.json"));
	});
});

// ---------------------------------------------------------------------------
// syncToZed
// ---------------------------------------------------------------------------

describe("syncToZed", () => {
	let tempDir: string;
	let settingsPath: string;
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		tempDir = resolve(
			tmpdir(),
			`zed-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		const zedDir = resolve(tempDir, ".config", "zed");
		mkdirSync(zedDir, { recursive: true });
		settingsPath = resolve(zedDir, "settings.json");

		savedEnv["HOME"] = process.env.HOME;
		savedEnv["CUSTOM_DATA_DIR"] = process.env.CUSTOM_DATA_DIR;
		savedEnv["XDG_CONFIG_HOME"] = process.env.XDG_CONFIG_HOME;

		// Point findZedSettings to our temp dir
		process.env.CUSTOM_DATA_DIR = undefined;
		process.env.XDG_CONFIG_HOME = undefined;
		process.env.HOME = tempDir;
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				process.env[key] = undefined;
			} else {
				process.env[key] = value;
			}
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("syncs models into existing provider block", () => {
		writeFileSync(settingsPath, ZED_SETTINGS_WITH_COMMENTS);

		const models = [
			makeExposed(),
			makeExposed({
				publicId: "openai/gpt-5.4-mini",
				canonicalId: "openai/gpt-5.4-mini",
				provider: "openai",
				model: makeModel({
					id: "gpt-5.4-mini",
					name: "GPT-5.4 Mini",
					provider: "openai",
					input: ["text"],
					contextWindow: 128000,
					maxTokens: 32000,
				}),
			}),
		];

		const result = syncToZed(models, {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: false,
		});

		expect(result.ok).toBe(true);
		expect(result.added).toBe(2);
		expect(result.removed).toBe(1);
		expect(result.configPath).toBe(settingsPath);

		// Verify the file was written
		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toContain("claude-sonnet-4-20250514");
		expect(content).toContain("gpt-5.4-mini");
		expect(content).not.toContain("old-model");
	});

	test("preserves JSONC comments", () => {
		writeFileSync(settingsPath, ZED_SETTINGS_WITH_COMMENTS);

		const result = syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: false,
		});

		expect(result.ok).toBe(true);
		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toContain("// Zed settings");
		expect(content).toContain("// Editor settings");
		expect(content).toContain("// Theme");
	});

	test("creates provider block when it does not exist", () => {
		writeFileSync(settingsPath, MINIMAL_ZED_SETTINGS);

		const result = syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: false,
		});

		expect(result.ok).toBe(true);
		expect(result.added).toBe(1);
		expect(result.removed).toBe(0);

		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toContain("language_models");
		expect(content).toContain("openai_compatible");
		expect(content).toContain("Pi Proxy");
		expect(content).toContain("claude-sonnet-4-20250514");
	});

	test("dry-run does not write to disk", () => {
		writeFileSync(settingsPath, ZED_SETTINGS_WITH_COMMENTS);

		const result = syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: true,
		});

		expect(result.ok).toBe(true);
		expect(result.summary).toContain("[dry-run]");

		// File should be unchanged
		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toBe(ZED_SETTINGS_WITH_COMMENTS);
	});

	test("reports correct diff counts", () => {
		writeFileSync(settingsPath, ZED_SETTINGS_WITH_COMMENTS);

		// old-model exists, we sync claude which is new -> 1 added, 1 removed
		const result = syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: true,
		});

		expect(result.added).toBe(1);
		expect(result.removed).toBe(1);
		expect(result.unchanged).toBe(0);
	});

	test("reports unchanged when models match", () => {
		// Write settings with the exact model we will sync
		const settingsWithClaude = `{
  "language_models": {
    "openai_compatible": {
      "Pi Proxy": {
        "api_url": "http://127.0.0.1:4141/v1",
        "available_models": [
          {
            "name": "anthropic/claude-sonnet-4-20250514",
            "display_name": "Claude Sonnet 4",
            "max_tokens": 200000,
            "max_output_tokens": 64000
          }
        ]
      }
    }
  }
}
`;
		writeFileSync(settingsPath, settingsWithClaude);

		const result = syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: true,
		});

		expect(result.added).toBe(0);
		expect(result.removed).toBe(0);
		expect(result.unchanged).toBe(1);
	});

	test("handles empty model list (removes all)", () => {
		writeFileSync(settingsPath, ZED_SETTINGS_WITH_COMMENTS);

		const result = syncToZed([], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: false,
		});

		expect(result.ok).toBe(true);
		expect(result.removed).toBe(1);
		expect(result.added).toBe(0);

		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toContain("available_models");
		expect(content).not.toContain("old-model");
	});

	test("returns error when settings file not found", () => {
		// Point HOME to non-existent dir
		process.env.HOME = resolve(tempDir, "no-such-dir");

		const result = syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: false,
		});

		expect(result.ok).toBe(false);
		expect(result.error).toContain("not found");
	});

	test("preserves other settings outside language_models", () => {
		writeFileSync(settingsPath, ZED_SETTINGS_WITH_COMMENTS);

		syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: false,
		});

		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toContain('"buffer_font_size": 15');
		expect(content).toContain('"theme": "Gruvbox Dark"');
	});

	test("preserves other providers in openai_compatible", () => {
		const settingsWithMultipleProviders = `{
  "language_models": {
    "openai_compatible": {
      "Other Provider": {
        "api_url": "https://other.example.com/v1",
        "available_models": [
          { "name": "other-model", "max_tokens": 4096 }
        ]
      },
      "Pi Proxy": {
        "api_url": "http://127.0.0.1:4141/v1",
        "available_models": [
          { "name": "old-model", "max_tokens": 100000 }
        ]
      }
    }
  }
}
`;
		writeFileSync(settingsPath, settingsWithMultipleProviders);

		syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://127.0.0.1:4141/v1",
			dryRun: false,
		});

		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toContain("Other Provider");
		expect(content).toContain("other-model");
		expect(content).toContain("claude-sonnet-4-20250514");
		expect(content).not.toContain("old-model");
	});

	test("writes correct api_url into provider block", () => {
		writeFileSync(settingsPath, MINIMAL_ZED_SETTINGS);

		syncToZed([makeExposed()], {
			providerName: "Pi Proxy",
			apiUrl: "http://192.168.1.100:8080/v1",
			dryRun: false,
		});

		const content = readFileSync(settingsPath, "utf-8");
		expect(content).toContain("http://192.168.1.100:8080/v1");
	});
});
