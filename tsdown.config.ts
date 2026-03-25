import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		config: "src/config/schema.ts",
		exposure: "src/openai/model-exposure.ts",
		"sync-zed": "src/sync/zed.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	banner: (chunk) => {
		if (chunk.fileName === "index.mjs") {
			return { js: "#!/usr/bin/env bun" };
		}
		return {};
	},
	deps: {
		neverBundle: ["@mariozechner/pi-ai", "@mariozechner/pi-coding-agent"],
	},
});
