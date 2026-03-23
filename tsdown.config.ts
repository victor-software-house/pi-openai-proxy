import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	banner: { js: "#!/usr/bin/env node" },
	external: ["@mariozechner/pi-ai", "@mariozechner/pi-coding-agent"],
});
