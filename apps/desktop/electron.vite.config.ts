import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import icons from "unplugin-icons/vite";
import { reactCompilerPlugin } from "../../config/react-compiler-audit";

const devPort = Number(process.env.PORT ?? 1420);

export default defineConfig({
	main: {
		plugins: [
			externalizeDepsPlugin({
				exclude: ["@hubble.md/runtime", "@tailwindcss/browser", "alpinejs"],
			}),
		],
		build: {
			lib: {
				entry: "electron/main.ts",
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
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
		server: {
			port: devPort,
			strictPort: false,
		},
		build: {
			rollupOptions: {
				input: "index.html",
			},
		},
	},
});
