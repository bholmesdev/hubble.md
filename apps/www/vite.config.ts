import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
import { reactCompilerPlugin } from "../../config/react-compiler-audit";

export default defineConfig({
	plugins: [
		react({
			babel: {
				plugins: [reactCompilerPlugin("www")],
			},
		}),
		icons({
			compiler: "jsx",
			jsx: "react",
		}),
		tailwindcss(),
	],
	server: {
		port: 5173,
		strictPort: false,
	},
});
