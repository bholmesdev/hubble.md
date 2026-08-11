import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "./components/Toaster";
import { desktopApi } from "./desktopApi";
import { initTheme } from "./theme";
import "./components/toast.css";
import "./index.css";

async function start() {
	try {
		await initTheme();
	} catch (error) {
		console.error("Failed to load theme state:", error);
	}
	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<App />
			<Toaster />
		</React.StrictMode>,
	);
	requestAnimationFrame(() => desktopApi.notifyThemeReady());
}

void start();
