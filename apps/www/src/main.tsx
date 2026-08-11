import { applyTheme, HUBBLE_LIGHT_THEME } from "@hubble.md/theme";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

applyTheme(document.documentElement, HUBBLE_LIGHT_THEME);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
