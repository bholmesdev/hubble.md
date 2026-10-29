/// <reference types="electron-vite/node" />

// Main shares `src/lib/filePath.ts`, which reads the license key to decide
// whether this build offers diagrams.
interface ImportMetaEnv {
	readonly VITE_TLDRAW_LICENSE_KEY?: string;
}
