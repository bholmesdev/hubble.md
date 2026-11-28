import { store } from "@simplestack/store";
import { useStoreValue } from "@simplestack/store/react";
import { uiStore } from "../store/state";

type WorkspaceMode = "wide" | "chat-collapsed" | "compact";
export const workspaceLayout = store({
	mode: "wide" as WorkspaceMode,
	width: 1200,
	sidebarWidth: 220,
});

export function isCompactWorkspace() {
	return workspaceLayout.get().mode === "compact";
}
export function useCompactWorkspace() {
	return useStoreValue(workspaceLayout, (layout) => layout.mode === "compact");
}

/** CSS owns the container thresholds; the observer applies their close transitions to app state. */
export function observeWorkspaceLayout(marker: HTMLSpanElement | null) {
	const container = marker?.parentElement;
	if (!marker || !container) return;
	const update = () => {
		const mode = getComputedStyle(marker)
			.getPropertyValue("--workspace-mode")
			.trim() as WorkspaceMode;
		if (mode !== "wide" && mode !== "chat-collapsed" && mode !== "compact")
			return;
		const previous = workspaceLayout.get();
		workspaceLayout.set({
			mode,
			width: container.getBoundingClientRect().width,
			sidebarWidth:
				Number.parseFloat(
					getComputedStyle(document.documentElement).getPropertyValue(
						"--sidebar-width",
					),
				) || 220,
		});
		if (mode !== previous.mode)
			uiStore.set((ui) => ({
				...ui,
				...(mode !== "wide" ? { chatPanelOpen: false } : {}),
				...(mode === "compact" ? { sidebarOpen: false } : {}),
			}));
	};
	update();
	const observer = new ResizeObserver(update);
	observer.observe(container);
	const sidebarWidthObserver = new MutationObserver(update);
	sidebarWidthObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["style"],
	});
	return () => {
		observer.disconnect();
		sidebarWidthObserver.disconnect();
	};
}
