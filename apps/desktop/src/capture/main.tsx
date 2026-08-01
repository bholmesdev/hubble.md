import React from "react";
import ReactDOM from "react-dom/client";
import { initTheme } from "../theme";
import { CaptureApp } from "./CaptureApp";
import "../index.css";

initTheme("system");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<CaptureApp />
	</React.StrictMode>,
);
