import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import type { TLUiAssetUrlOverrides } from "tldraw";
import add from "~icons/mingcute/add-line?raw";
import back from "~icons/mingcute/back-line?raw";
import bold from "~icons/mingcute/bold-line?raw";
import check from "~icons/mingcute/check-line?raw";
import close from "~icons/mingcute/close-line?raw";
import code from "~icons/mingcute/code-line?raw";
import copy from "~icons/mingcute/copy-2-line?raw";
import deleteIcon from "~icons/mingcute/delete-line?raw";
import down from "~icons/mingcute/down-line?raw";
import download from "~icons/mingcute/download-2-line?raw";
import externalLink from "~icons/mingcute/external-link-line?raw";
import forward from "~icons/mingcute/forward-line?raw";
import heading from "~icons/mingcute/heading-1-line?raw";
import italic from "~icons/mingcute/italic-line?raw";
import left from "~icons/mingcute/left-line?raw";
import link from "~icons/mingcute/link-line?raw";
import lock from "~icons/mingcute/lock-line?raw";
import menu from "~icons/mingcute/menu-line?raw";
import more1 from "~icons/mingcute/more-1-line?raw";
import more2 from "~icons/mingcute/more-2-line?raw";
import right from "~icons/mingcute/right-line?raw";
import strikethrough from "~icons/mingcute/strikethrough-line?raw";
import subtract from "~icons/mingcute/subtract-line?raw";
import underline from "~icons/mingcute/underline-line?raw";
import unlock from "~icons/mingcute/unlock-line?raw";
import up from "~icons/mingcute/up-line?raw";
import zoomIn from "~icons/mingcute/zoom-in-line?raw";
import zoomOut from "~icons/mingcute/zoom-out-line?raw";

/**
 * tldraw draws icons as CSS masks, so a plain SVG data URL keeps theming.
 * unplugin-icons' raw SVG omits `xmlns`, which an SVG image needs to load.
 */
function iconUrl(svg: string) {
	const image = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
	return `data:image/svg+xml,${encodeURIComponent(image)}`;
}

// tldraw otherwise fetches its icons, fonts and translations from its CDN
// at runtime, which is slow on first load and fails offline.
const bundled = getAssetUrlsByImport();

/**
 * Hubble's Mingcute icons for tldraw's generic UI icons: actions, menus and
 * text formatting. Tools, styles, shapes and sizes keep tldraw's icons,
 * which have no Mingcute counterpart.
 */
export const diagramAssetUrls: TLUiAssetUrlOverrides = {
	...bundled,
	icons: {
		...bundled.icons,
		undo: iconUrl(back),
		redo: iconUrl(forward),
		trash: iconUrl(deleteIcon),
		duplicate: iconUrl(copy),
		"clipboard-copy": iconUrl(copy),
		"dots-vertical": iconUrl(more2),
		"dots-horizontal": iconUrl(more1),
		menu: iconUrl(menu),
		"chevron-up": iconUrl(up),
		"chevron-down": iconUrl(down),
		"chevron-left": iconUrl(left),
		"chevron-right": iconUrl(right),
		check: iconUrl(check),
		"cross-2": iconUrl(close),
		plus: iconUrl(add),
		minus: iconUrl(subtract),
		"zoom-in": iconUrl(zoomIn),
		"zoom-out": iconUrl(zoomOut),
		"external-link": iconUrl(externalLink),
		link: iconUrl(link),
		lock: iconUrl(lock),
		unlock: iconUrl(unlock),
		download: iconUrl(download),
		bold: iconUrl(bold),
		italic: iconUrl(italic),
		underline: iconUrl(underline),
		strike: iconUrl(strikethrough),
		code: iconUrl(code),
		heading: iconUrl(heading),
	},
};
