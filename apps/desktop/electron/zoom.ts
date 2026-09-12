import fsSync from "node:fs";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import { z } from "zod/v4";

const defaultZoomFactor = 1;
export const zoomStep = 0.1;
const minZoomFactor = 0.5;
const maxZoomFactor = 3;
const trafficLightX = 12;
const trafficLightWidth = 54;
const trafficLightGap = 4;
const trafficLightHeight = 14;
const trafficLightYOffset = -1;
export const toolbarHeight = 36;

const zoomStateSchema = z.object({
	factor: z.number().min(minZoomFactor).max(maxZoomFactor),
});

function zoomStatePath(): string {
	return path.join(app.getPath("userData"), "zoom-factor.json");
}

export function loadZoomFactor() {
	try {
		const raw = fsSync.readFileSync(zoomStatePath(), "utf8");
		const parsed = zoomStateSchema.safeParse(JSON.parse(raw));
		if (parsed.success) return parsed.data.factor;
	} catch {
		// Missing or malformed zoom state should not block launch.
	}
	return defaultZoomFactor;
}

function saveZoomFactor(factor: number) {
	const parsed = zoomStateSchema.safeParse({ factor });
	if (!parsed.success) return;
	try {
		fsSync.mkdirSync(path.dirname(zoomStatePath()), { recursive: true });
		fsSync.writeFileSync(zoomStatePath(), JSON.stringify(parsed.data, null, 2));
	} catch {
		// Best-effort zoom state should not interrupt menu actions.
	}
}

function normalizeZoom(factor: number) {
	const stepped = Number(factor.toFixed(1));
	return Math.min(maxZoomFactor, Math.max(minZoomFactor, stepped));
}

function setWindowZoomFactor(window: BrowserWindow, factor: number) {
	const nextFactor = normalizeZoom(factor);
	window.webContents.setZoomFactor(nextFactor);
	setTrafficLightPosition(window, nextFactor);
	void setTrafficLightInset(window, nextFactor);
	saveZoomFactor(nextFactor);
}

export function trafficLightPositionForZoom(zoomFactor: number) {
	return {
		x: Math.round(trafficLightX * zoomFactor),
		y: Math.max(
			0,
			Math.round(
				(toolbarHeight * zoomFactor - trafficLightHeight) / 2 +
					trafficLightYOffset,
			),
		),
	};
}

export function trafficLightInsetForZoom(zoomFactor: number) {
	const { x } = trafficLightPositionForZoom(zoomFactor);
	return (x + trafficLightWidth + trafficLightGap) / zoomFactor;
}

function setTrafficLightPosition(window: BrowserWindow, zoomFactor: number) {
	if (process.platform !== "darwin" || window.isDestroyed()) return;
	window.setWindowButtonPosition(trafficLightPositionForZoom(zoomFactor));
}

export async function setTrafficLightInset(
	window: BrowserWindow,
	zoomFactor: number,
) {
	if (window.isDestroyed()) return;
	const inset = trafficLightInsetForZoom(zoomFactor);
	try {
		await window.webContents.executeJavaScript(
			`document.documentElement.style.setProperty("--hubble-traffic-light-inset", "${inset}px")`,
		);
	} catch {
		// The fallback inset still works if the renderer is navigating or destroyed.
	}
}

export function stepWindowZoom(window: BrowserWindow | null, delta: number) {
	if (!window || window.isDestroyed()) return;
	const current = window.webContents.getZoomFactor();
	const nextFactor = normalizeZoom(current + delta);
	if (nextFactor === current) return;
	setWindowZoomFactor(window, nextFactor);
}

export function resetWindowZoom(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) return;
	setWindowZoomFactor(window, defaultZoomFactor);
}
