import { execFileSync } from "node:child_process";
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

function bundleDictation(): Plugin {
	return {
		name: "hubble:dictation",
		async closeBundle() {
			if (process.platform !== "darwin") return;
			const root = fileURLToPath(new URL(".", import.meta.url));
			const bundle = path.join(root, "out/native/Hubble Dictation.app");
			const executable = path.join(bundle, "Contents/MacOS/hubble-dictation");
			await fs.mkdir(path.dirname(executable), { recursive: true });
			await fs.copyFile(
				path.join(root, "native/Dictation.plist"),
				path.join(bundle, "Contents/Info.plist"),
			);
			const binaries: string[] = [];
			for (const arch of ["arm64", "x86_64"]) {
				const binary = path.join(root, `out/native/dictation-${arch}`);
				binaries.push(binary);
				execFileSync(
					"xcrun",
					[
						"swiftc",
						"-O",
						"-target",
						`${arch}-apple-macosx12.0`,
						path.join(root, "native/Dictation.swift"),
						"-o",
						binary,
						"-Xlinker",
						"-sectcreate",
						"-Xlinker",
						"__TEXT",
						"-Xlinker",
						"__info_plist",
						"-Xlinker",
						path.join(root, "native/Dictation.plist"),
					],
					{ stdio: "inherit" },
				);
			}
			execFileSync("xcrun", [
				"lipo",
				"-create",
				...binaries,
				"-output",
				executable,
			]);
			for (const binary of binaries) await fs.unlink(binary);
			execFileSync("/usr/bin/codesign", [
				"--force",
				"--sign",
				"-",
				"--identifier",
				"com.benholmes.hubblemd.dictation",
				bundle,
			]);
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
			bundleDictation(),
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
