import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		config: "src/config/schema.ts",
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
	external: ["@mariozechner/pi-ai", "@mariozechner/pi-coding-agent"],
});
