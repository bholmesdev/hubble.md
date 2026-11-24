import { setQwertyCommandKeys } from "@hubble.md/ui";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "./components/Toaster";
import { initThemePreference } from "./store/actions";
import "./components/toast.css";
import "./index.css";

window.desktopApi.onKeyboardLayoutChange(setQwertyCommandKeys);

initThemePreference();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
		<Toaster />
	</React.StrictMode>,
);
