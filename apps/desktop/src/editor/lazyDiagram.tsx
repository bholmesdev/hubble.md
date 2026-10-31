import { type ComponentProps, useSyncExternalStore } from "react";
import type { DiagramMenuItems as MenuItemsComponent } from "../components/DiagramMenuItems";
import { DIAGRAMS_ENABLED } from "../lib/filePath";
import type { DiagramView as ViewComponent } from "./DiagramView";

// tldraw is most of the renderer's code, so it stays out of startup and
// loads once the app is idle, or as soon as a diagram needs it. This skips
// React's lazy/Suspense: React holds suspended content back for about
// 300ms, which would delay a diagram restored at launch.
type DiagramModules = {
	View: typeof ViewComponent;
	MenuItems: typeof MenuItemsComponent;
};

let modules: DiagramModules | null = null;
let started = false;
const listeners = new Set<() => void>();

function loadDiagrams() {
	if (started) return;
	started = true;
	void Promise.all([
		import("./DiagramView"),
		import("../components/DiagramMenuItems"),
	]).then(([view, menuItems]) => {
		modules = { View: view.DiagramView, MenuItems: menuItems.DiagramMenuItems };
		for (const listener of listeners) listener();
	});
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	void loadDiagrams();
	return () => listeners.delete(listener);
}

function useDiagramModules() {
	return useSyncExternalStore(subscribe, () => modules);
}

export function DiagramView(props: ComponentProps<typeof ViewComponent>) {
	const loaded = useDiagramModules();
	return loaded ? <loaded.View {...props} /> : null;
}

export function DiagramMenuItems(
	props: ComponentProps<typeof MenuItemsComponent>,
) {
	const loaded = useDiagramModules();
	return loaded ? <loaded.MenuItems {...props} /> : null;
}

/** Loads diagram code after startup, so the first diagram opens without waiting. */
export function preloadDiagrams() {
	if (!DIAGRAMS_ENABLED) return;
	requestIdleCallback(() => void loadDiagrams());
}
