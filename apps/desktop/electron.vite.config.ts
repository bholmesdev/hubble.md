import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import icons from "unplugin-icons/vite";
import type { Plugin } from "vite";
import { reactCompilerPlugin } from "../../config/react-compiler-audit";
import { userSkillNames } from "./electron/agentSkills";

const devPort = Number(process.env.PORT ?? 1420);

/**
 * Copies the user-facing skills from the repo's .agents/skills into out/skills,
 * which electron-builder ships as Resources/skills. Dev skills are marked
 * `metadata.internal: true` and stay out of the app.
 */
function bundleUserSkills(): Plugin {
	const skillsDir = fileURLToPath(
		new URL("../../.agents/skills", import.meta.url),
	);
	const outDir = fileURLToPath(new URL("./out/skills", import.meta.url));
	return {
		name: "hubble:bundle-user-skills",
		async closeBundle() {
			await fs.rm(outDir, { recursive: true, force: true });
			for (const name of await userSkillNames(skillsDir)) {
				await fs.cp(path.join(skillsDir, name), path.join(outDir, name), {
					recursive: true,
				});
			}
		},
	};
}

export default defineConfig({
	main: {
		plugins: [
			externalizeDepsPlugin({
				exclude: ["@hubble.md/runtime", "@tailwindcss/browser", "alpinejs"],
			}),
			bundleUserSkills(),
		],
		build: {
			minify: "esbuild",
			lib: {
				entry: "electron/main.ts",
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			minify: "esbuild",
			lib: {
				entry: "electron/preload.ts",
			},
		},
	},
	renderer: {
		root: ".",
		plugins: [
			react({
				babel: {
					plugins: [reactCompilerPlugin("desktop")],
				},
			}),
			icons({
				compiler: "jsx",
				jsx: "react",
			}),
			tailwindcss(),
		],
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		// Pre-bundling drops the `?url` imports tldraw's bundled assets rely on.
		optimizeDeps: {
			exclude: ["@tldraw/assets"],
		},
		server: {
			port: devPort,
			strictPort: false,
		},
		build: {
			minify: "esbuild",
			rollupOptions: {
				input: "index.html",
			},
		},
	},
});
