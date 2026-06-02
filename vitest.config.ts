import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
	viteConfig({ mode: "test", command: "serve" }),
	defineConfig({
		test: {
			environment: "jsdom",
			setupFiles: ["tests/setup/vitest.setup.ts"],
			include: ["tests/**/*.{test,spec}.{ts,tsx,js,jsx}"],
			exclude: ["tests/e2e/**", "node_modules/**"],
			coverage: {
				provider: "v8",
				include: ["src/**/*.{ts,tsx,js,jsx}", "api/**/*.ts"],
				exclude: ["src/**/*.d.ts", "src/**/*.css"],
			},
			environmentMatchGlobs: [
				["tests/api/**", "node"],
				["tests/integration/**", "node"],
			],
		},
	}),
);
