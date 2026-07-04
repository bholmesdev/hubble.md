/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_TEST_CONVEX_URL?: string;
	readonly VITE_TEST_WORKSPACE_ID?: string;
	readonly VITE_TEST_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module "~icons/*" {
	import type { ComponentType, SVGProps } from "react";
	const component: ComponentType<SVGProps<SVGSVGElement>>;
	export default component;
}
