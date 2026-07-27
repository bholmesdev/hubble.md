import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "./components/Toaster";
import { themePreferenceStore } from "./store/state";
import { initTheme } from "./theme";
import "./components/toast.css";
import "./index.css";

initTheme(themePreferenceStore.get());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
		<Toaster />
	</React.StrictMode>,
);
