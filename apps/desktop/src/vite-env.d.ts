/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

import type { DesktopApi } from "./desktopApi/types";

declare global {
	interface ImportMetaEnv {
		readonly VITE_TLDRAW_LICENSE_KEY?: string;
	}

	interface Window {
		desktopApi: DesktopApi;
	}
}
