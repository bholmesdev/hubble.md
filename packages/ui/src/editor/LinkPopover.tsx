import {
	computePosition,
	flip,
	offset,
	shift,
	type VirtualElement,
} from "@floating-ui/dom";
import {
	getActiveLinkRange,
	wikiDisplayNameForTarget,
	withMarkdownExtension,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { keymatch } from "keymatch";
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
} from "react";
import MingcuteArrowRightLine from "~icons/mingcute/arrow-right-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteDelete2Line from "~icons/mingcute/delete-2-line";
import MingcutePencilFill from "~icons/mingcute/pencil-fill";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Separator } from "../primitives/separator";
import { classifyHref, linkAttrsForHref } from "./href";
import { linkCreationGhostKey } from "./LinkCreationGhostExtension";
import styles from "./LinkPopover.module.css";
import {
	FOCUS_LINK_POPOVER_EVENT,
	LINK_CREATION_REQUESTED_EVENT,
} from "./SmartLinkExtension";
import { useEditorInputMode } from "./useEditorInputMode";
import type { VirtualCursorMode } from "./virtualCursorMode";

// ── State machine ───────────────────────────────────────────────────

type PopoverMode = "hidden" | "preview" | "actions" | "creating";
type MachineState = {
	mode: PopoverMode;
	activeKey: string | null;
	pendingCreation: boolean;
};
type MachineEvent =
	| { type: "LINK_SESSION_CHANGED"; activeKey: string | null }
	| { type: "EXPAND_REQUESTED" }
	| { type: "TOGGLE_ACTIONS_REQUESTED" }
	| { type: "ESCAPE_REQUESTED" }
	| { type: "CREATION_REQUESTED" }
	| { type: "CREATION_CONFIRMED" }
	| { type: "TITLE_INPUT_REQUESTED" };
type ActiveLink = {
	from: number;
	to: number;
	href: string;
	kind: "url" | "wiki";
	target: string | null;
};
export type WikiTarget = {
	path: string;
	target: string;
	title: string;
};

const INITIAL_MACHINE_STATE: MachineState = {
	mode: "hidden",
	activeKey: null,
	pendingCreation: false,
};

function machineReducer(
	state: MachineState,
	event: MachineEvent,
): MachineState {
	switch (event.type) {
		case "LINK_SESSION_CHANGED": {
			const { activeKey } = event;
			if (state.mode === "creating") return state;
			if (!activeKey) {
				if (state.pendingCreation && state.activeKey === null) {
					// No text typed yet — keep waiting for first character
					return state;
				}
				return INITIAL_MACHINE_STATE;
			}
			if (state.activeKey !== activeKey) {
				return {
					mode: "preview",
					activeKey,
					pendingCreation: state.pendingCreation,
				};
			}
			return { ...state, activeKey };
		}
		case "EXPAND_REQUESTED": {
			if (state.mode === "creating") return state;
			if (!state.activeKey) return state;
			return { ...state, mode: "actions" };
		}
		case "TOGGLE_ACTIONS_REQUESTED": {
			if (!state.activeKey) return state;
			if (state.mode === "preview") return { ...state, mode: "actions" };
			if (state.mode === "actions") return { ...state, mode: "preview" };
			return state;
		}
		case "ESCAPE_REQUESTED": {
			if (state.mode === "creating") return INITIAL_MACHINE_STATE;
			if (state.mode === "actions") return { ...state, mode: "preview" };
			if (state.mode === "preview") {
				if (state.pendingCreation) {
					return { ...INITIAL_MACHINE_STATE };
				}
				return { ...state, mode: "hidden" };
			}
			return state;
		}
		case "CREATION_REQUESTED": {
			return {
				mode: "creating",
				activeKey: null,
				pendingCreation: false,
			};
		}
		case "CREATION_CONFIRMED": {
			return { ...INITIAL_MACHINE_STATE };
		}
		case "TITLE_INPUT_REQUESTED": {
			return { mode: "preview", activeKey: null, pendingCreation: true };
		}
		default:
			return state;
	}
}

function getCursorModeForMachineState(
	state: MachineState,
): VirtualCursorMode | null {
	return state.mode === "actions" || state.pendingCreation ? "solid" : null;
}

function getLinkSession(editor: Editor) {
	const link = getActiveLinkRange(editor.state);
	return {
		link,
		activeKey: link ? `${link.from}:${link.to}` : null,
	};
}

// ── Anchor state ────────────────────────────────────────────────────
// The popover is "anchored" to a link once it has entered the link AND
// its floating position has been computed at least once. CSS transitions
// are only applied while anchored — this prevents jarring motion when
// jumping between links (keyboard or mouse) or clicking around with the
// pointer. The anchor detaches on any pointer-driven selection and on
// keyboard moves that land on a different link; it re-anchors after the
// first position compute on the new link.

type LinkAnchorState = {
	// The link the cursor is currently inside.
	activeKey: string | null;
	// The link the popover has been positioned over at least once.
	// When anchoredKey === activeKey, transitions are enabled.
	anchoredKey: string | null;
};

type LinkAnchorEvent =
	| {
			// Fired on every editor update; carries the new active link and
			// whether this change should detach the anchor.
			type: "LINK_SYNCED";
			activeKey: string | null;
			shouldDetach: boolean;
	  }
	| {
			// Fired after floating-ui resolves the popover position, marking
			// the popover as fully anchored to activeKey.
			type: "POSITIONED";
			activeKey: string | null;
	  };

const INITIAL_LINK_ANCHOR_STATE: LinkAnchorState = {
	activeKey: null,
	anchoredKey: null,
};

function linkAnchorReducer(
	state: LinkAnchorState,
	event: LinkAnchorEvent,
): LinkAnchorState {
	switch (event.type) {
		case "LINK_SYNCED": {
			const { activeKey, shouldDetach } = event;
			if (!activeKey) return INITIAL_LINK_ANCHOR_STATE;
			// Detach (drop anchoredKey) when moving to a new link or when the
			// caller signals the move should suppress animation.
			if (shouldDetach || state.activeKey !== activeKey) {
				return { activeKey, anchoredKey: null };
			}
			return { ...state, activeKey };
		}
		case "POSITIONED": {
			const { activeKey } = event;
			// Only anchor if the position resolves for the link we're tracking.
			if (!activeKey || state.activeKey !== activeKey) return state;
			return { activeKey, anchoredKey: activeKey };
		}
		default:
			return state;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

async function copyLinkToClipboard(
	href: string,
	onMessage?: (message: string, kind: "success" | "error") => void,
) {
	try {
		await navigator.clipboard.writeText(href);
		onMessage?.("Link copied", "success");
	} catch {
		onMessage?.("Failed to copy link", "error");
	}
}

function linkClipboardText(link: ActiveLink) {
	return link.kind === "wiki" ? (link.target ?? link.href) : link.href;
}

function linkPreviewText(href: string) {
	return href.replace(/^https?:\/\//i, "");
}

function removeActiveLink(editor: Editor, from: number, to: number) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	if (from === to) {
		// Zero-width links live in stored marks, so removal updates stored marks.
		const marks = (
			editor.state.storedMarks ?? editor.state.selection.$from.marks()
		).filter((mark) => mark.type !== linkType);
		const tr = editor.state.tr.setStoredMarks(
			marks.length === 0 ? null : marks,
		);
		editor.view.dispatch(tr);
		editor.commands.focus(undefined, { scrollIntoView: false });
		return;
	}
	const tr = editor.state.tr.removeMark(from, to, linkType);
	editor.view.dispatch(tr);
	editor.commands.focus(undefined, { scrollIntoView: false });
}

function insertLinkedText(editor: Editor, pos: number, href: string) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const textNode = editor.state.schema.text(href, [linkType.create({ href })]);
	const tr = editor.state.tr.insert(pos, textNode);
	editor.view.dispatch(tr);
}

function insertWikiLinkedText(
	editor: Editor,
	pos: number,
	text: string,
	href: string,
	target: string,
) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const textNode = editor.state.schema.text(text, [
		linkType.create({ href, kind: "wiki", target }),
	]);
	const tr = editor.state.tr.insert(pos, textNode);
	editor.view.dispatch(tr);
}

function applyLinkMarkAtPos(editor: Editor, pos: number, href: string) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const tr = editor.state.tr;
	tr.setSelection(TextSelection.create(tr.doc, pos));
	tr.setStoredMarks([linkType.create({ href, kind: "url", target: null })]);
	editor.view.dispatch(tr);
}

function clearGhostText(editor: Editor) {
	const current = linkCreationGhostKey.getState(editor.state);
	if (current) {
		editor.view.dispatch(editor.state.tr.setMeta(linkCreationGhostKey, null));
	}
}

async function visitLink(
	href: string,
	onOpenExternalLink: (href: string) => void | Promise<void>,
	onMessage?: (message: string, kind: "success" | "error") => void,
) {
	if (classifyHref(href) === "external") {
		try {
			const parsed = new URL(href);
			const protocol = parsed.protocol.toLowerCase();
			if (protocol !== "http:" && protocol !== "https:") {
				onMessage?.("Only http(s) links can be opened", "error");
				return;
			}
			await onOpenExternalLink(href);
		} catch {
			onMessage?.("Invalid link URL", "error");
		}
		return;
	}
	try {
		await onOpenExternalLink(href);
	} catch (error) {
		if (error instanceof Error) onMessage?.(error.message, "error");
		else onMessage?.("Could not open link", "error");
	}
}

function canAutofillLinkFromClipboard(href: string) {
	if (classifyHref(href) === "relative-file") {
		return (
			href.startsWith("./") || href.startsWith("../") || href.startsWith("/")
		);
	}
	try {
		const protocol = new URL(href).protocol.toLowerCase();
		if (protocol !== "http:" && protocol !== "https:") return false;
	} catch {
		return false;
	}
	return true;
}
function updateLinkMark(editor: Editor, link: ActiveLink, href: string) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const attrs = linkAttrsForHref(href);
	if (link.from === link.to) {
		// Zero-width links edit stored marks because there is no text range yet.
		const marks = (
			editor.state.storedMarks ?? editor.state.selection.$from.marks()
		).filter((mark) => mark.type !== linkType);
		const tr = editor.state.tr.setStoredMarks([
			...marks,
			linkType.create(attrs),
		]);
		editor.view.dispatch(tr);
		return;
	}
	const tr = editor.state.tr.removeMark(link.from, link.to, linkType);
	tr.addMark(link.from, link.to, linkType.create(attrs));
	editor.view.dispatch(tr);
}

async function visitActiveLink(
	link: { href: string; kind: "url" | "wiki"; target: string | null },
	onOpenExternalLink: (href: string) => void | Promise<void>,
	onOpenWikiLink: (target: string) => void | Promise<void>,
	onMessage?: (message: string, kind: "success" | "error") => void,
) {
	if (link.kind === "wiki") {
		if (!link.target) {
			console.warn("Skipping wiki link without target", { href: link.href });
			onMessage?.("Cannot open wiki link without a target", "error");
			return;
		}
		await onOpenWikiLink(withMarkdownExtension(link.target));
		return;
	}
	await visitLink(link.href, onOpenExternalLink, onMessage);
}

function normalizedSearchValue(value: string) {
	return value.trim().toLocaleLowerCase();
}

// ── Positioning ─────────────────────────────────────────────────────
type PositionUpdateReason =
	| "selection"
	| "transaction"
	| "focus"
	| "blur"
	| "resize"
	| "scroll"
	| "layout";

const PREVIEW_SHELL_INLINE_SIZE = 250;
const PREVIEW_INLINE_SIZE_START = 100;
const PREVIEW_INLINE_SIZE_END = 174;
const PREVIEW_HORIZONTAL_OVERFLOW =
	(PREVIEW_SHELL_INLINE_SIZE - PREVIEW_INLINE_SIZE_END) / 2;
const PREVIEW_REVEAL_DURATION_MS = 180;
const ACTION_POPOVER_PLACEMENT = "top";

// Returns true when a selection change should detach the anchor,
// suppressing position transitions on the next update.
// Detaches when:
//   - the user moved with the pointer (mouse/trackpad click)
//   - the cursor jumped to a different link via keyboard
function shouldDetachAnchor({
	reason,
	inputMode,
	activeKey,
	previousSelectionActiveKey,
}: {
	reason: PositionUpdateReason;
	inputMode: "pointer" | "keyboard";
	activeKey: string | null;
	previousSelectionActiveKey: string | null;
}) {
	if (!activeKey || reason !== "selection") return false;
	if (inputMode === "pointer") return true;
	return previousSelectionActiveKey !== activeKey;
}

function updateFloatingPosition(
	editor: Editor,
	viewport: HTMLDivElement,
	floatingEl: HTMLDivElement,
	pos: number,
	mode: PopoverMode,
	setX: (x: number) => void,
	setY: (y: number) => void,
) {
	const boundaryPadding = {
		top: 8,
		right: mode === "preview" ? -PREVIEW_HORIZONTAL_OVERFLOW : 0,
		bottom: 8,
		left: mode === "preview" ? -PREVIEW_HORIZONTAL_OVERFLOW : 0,
	};
	const reference: VirtualElement = {
		contextElement: viewport,
		getBoundingClientRect() {
			const coords = editor.view.coordsAtPos(pos);
			return {
				x: coords.left,
				y: coords.top,
				left: coords.left,
				top: coords.top,
				right: coords.right,
				bottom: coords.bottom,
				width: coords.right - coords.left,
				height: coords.bottom - coords.top,
				toJSON() {
					return this;
				},
			};
		},
	};

	return computePosition(reference, floatingEl, {
		strategy: "absolute",
		placement: mode === "preview" ? "top" : ACTION_POPOVER_PLACEMENT,
		middleware: [
			offset(4),
			flip({
				boundary: viewport,
				fallbackPlacements: ["bottom"],
				padding: boundaryPadding,
			}),
			shift({
				boundary: viewport,
				padding: boundaryPadding,
			}),
		],
	}).then(({ x, y }) => {
		setX(x);
		setY(y);
	});
}

function playPreviewRevealAnimation(previewButton: HTMLDivElement) {
	const easing =
		getComputedStyle(previewButton).getPropertyValue("--ease-snappy").trim() ||
		"ease-out";
	return previewButton.animate(
		[
			{
				inlineSize: `${PREVIEW_INLINE_SIZE_START}px`,
				opacity: 0.82,
				transform: "translateY(2px) scale(0.985)",
			},
			{
				inlineSize: `${PREVIEW_INLINE_SIZE_END}px`,
				opacity: 1,
				transform: "translateY(0) scale(1)",
			},
		],
		{
			duration: PREVIEW_REVEAL_DURATION_MS,
			easing,
		},
	);
}

function usePreviewRevealAnimation({
	mode,
	activeKey,
	inputMode,
	positionUpdateRef,
}: {
	mode: PopoverMode;
	activeKey: string | null;
	inputMode: "pointer" | "keyboard";
	positionUpdateRef: RefObject<
		((reason?: PositionUpdateReason) => void) | null
	>;
}) {
	const previewButtonRef = useRef<HTMLDivElement | null>(null);
	const previewRevealAnimationRef = useRef<Animation | null>(null);
	const previousPopoverModeRef = useRef<PopoverMode>(mode);
	const previousPreviewKeyRef = useRef<string | null>(activeKey);

	const playPreviewReveal = () => {
		const previewButton = previewButtonRef.current;
		if (!previewButton) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		previewRevealAnimationRef.current?.cancel();
		const animation = playPreviewRevealAnimation(previewButton);
		previewRevealAnimationRef.current = animation;
		animation.addEventListener(
			"finish",
			() => {
				if (previewRevealAnimationRef.current === animation) {
					previewRevealAnimationRef.current = null;
				}
				positionUpdateRef.current?.("layout");
			},
			{ once: true },
		);
		animation.addEventListener(
			"cancel",
			() => {
				if (previewRevealAnimationRef.current === animation) {
					previewRevealAnimationRef.current = null;
				}
			},
			{ once: true },
		);
	};

	useEffect(() => {
		return () => {
			previewRevealAnimationRef.current?.cancel();
		};
	}, []);

	useEffect(
		() => {
			const previousMode = previousPopoverModeRef.current;
			const previousPreviewKey = previousPreviewKeyRef.current;
			const shouldRevealFromHidden =
				previousMode === "hidden" && mode === "preview";
			const shouldReplayPreviewReveal =
				previousMode === "preview" &&
				mode === "preview" &&
				inputMode === "pointer" &&
				previousPreviewKey !== null &&
				activeKey !== null &&
				previousPreviewKey !== activeKey;

			if (shouldRevealFromHidden || shouldReplayPreviewReveal) {
				playPreviewReveal();
			}

			previousPopoverModeRef.current = mode;
			previousPreviewKeyRef.current = activeKey;
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes the render-local callback.
		[mode, activeKey, inputMode, playPreviewReveal],
	);

	return previewButtonRef;
}

function PreviewLabel({ text }: { text: string }) {
	const textRef = useRef<HTMLSpanElement | null>(null);
	const [overflows, setOverflows] = useState(false);

	const measureOverflow = () => {
		const element = textRef.current;
		setOverflows(
			Boolean(element && element.scrollWidth > element.clientWidth + 1),
		);
	};

	useLayoutEffect(
		() => {
			const element = textRef.current;
			if (!element) {
				setOverflows(false);
				return;
			}
			measureOverflow();
			// CSS cannot tell us whether the text is actually clipped. Measure overflow
			// so the fade mask only appears when there is hidden text to fade out.
			// Hover padding and reveal animation also change the available label width.
			const observer = new ResizeObserver(measureOverflow);
			observer.observe(element);
			return () => observer.disconnect();
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes the render-local callback.
		[measureOverflow],
	);

	return (
		<span
			ref={textRef}
			className={cn(
				"block min-w-0 flex-1 overflow-hidden whitespace-nowrap",
				overflows && styles.previewText,
			)}
		>
			{text}
		</span>
	);
}

// ── Component ───────────────────────────────────────────────────────
// Desktop still carries a local copy while it owns desktop-only stores, toasts,
// and filesystem navigation. Keep preview UI changes in sync until that copy can
// be removed.

export function LinkPopover({
	editor,
	containerRef,
	viewportRef,
	wikiTargets,
	onOpenExternalLink,
	onOpenWikiLink,
	onMessage,
	onCursorModeChange,
}: {
	editor: Editor | null;
	containerRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLDivElement | null>;
	wikiTargets: WikiTarget[];
	onOpenExternalLink: (href: string) => void | Promise<void>;
	onOpenWikiLink: (target: string) => void | Promise<void>;
	onMessage?: (message: string, kind: "success" | "error") => void;
	onCursorModeChange?: (mode: VirtualCursorMode | null) => void;
}) {
	const [floatingX, setFloatingX] = useState(0);
	const [floatingY, setFloatingY] = useState(0);
	const [hrefValue, setHrefValue] = useState("");
	const [activeLink, setActiveLink] = useState<ActiveLink | null>(null);
	const [machineState, dispatch] = useReducer(
		machineReducer,
		INITIAL_MACHINE_STATE,
	);
	const { inputMode } = useEditorInputMode({ editor, containerRef });
	const inputRef = useRef<HTMLInputElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const positionUpdateRef = useRef<
		((reason?: PositionUpdateReason) => void) | null
	>(null);
	const machineStateRef = useRef(machineState);
	const anchorRef = useRef(INITIAL_LINK_ANCHOR_STATE);
	const lastSelectionActiveKeyRef = useRef<string | null>(null);
	const expandNextLinkSessionRef = useRef(false);
	const originalWikiTargetRef = useRef<{
		activeKey: string;
		target: string;
	} | null>(null);
	const positionRequestIdRef = useRef(0);
	const [animatePosition, setAnimatePosition] = useState(false);
	const previewButtonRef = usePreviewRevealAnimation({
		mode: machineState.mode,
		activeKey: machineState.activeKey,
		inputMode,
		positionUpdateRef,
	});

	// Creation-mode state
	const [creationCursorPos, setCreationCursorPos] = useState<number | null>(
		null,
	);
	const [creationHref, setCreationHref] = useState("");
	const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
	const wikiQuery = machineState.mode === "creating" ? creationHref : hrefValue;
	const wikiSuggestionQuery = normalizedSearchValue(wikiQuery);
	const wikiSuggestions = wikiTargets
		.filter((file) => {
			if (!wikiSuggestionQuery) return true;
			const haystack = `${file.title} ${file.target}`.toLocaleLowerCase();
			return haystack.includes(wikiSuggestionQuery);
		})
		.sort((a, b) => a.title.localeCompare(b.title))
		.slice(0, 6);
	const boundedActiveSuggestionIndex =
		wikiSuggestions.length === 0
			? 0
			: Math.min(activeSuggestionIndex, wikiSuggestions.length - 1);
	const wikiSuggestionCount = wikiSuggestions.length;

	useEffect(() => {
		machineStateRef.current = machineState;
	}, [machineState]);
	// Reposition when the suggestion list appears, disappears, or changes height.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the count change is the layout signal.
	useLayoutEffect(() => {
		positionUpdateRef.current?.("layout");
	}, [wikiSuggestionCount]);
	useLayoutEffect(() => {
		if (machineState.mode !== "creating" && machineState.mode !== "actions")
			return;
		positionUpdateRef.current?.("layout");
	}, [machineState.mode]);

	const dispatchMachineEvent = (event: MachineEvent) => {
		const previousState = machineStateRef.current;
		const nextState = machineReducer(previousState, event);
		machineStateRef.current = nextState;
		onCursorModeChange?.(getCursorModeForMachineState(nextState));
		dispatch(event);
	};
	const setAnchorState = (event: LinkAnchorEvent) => {
		anchorRef.current = linkAnchorReducer(anchorRef.current, event);
	};
	const openCreationTitleInput = () => {
		if (!editor || creationCursorPos === null) return;
		clearGhostText(editor);
		if (creationHref) {
			applyLinkMarkAtPos(editor, creationCursorPos, creationHref);
		}
		dispatchMachineEvent({ type: "TITLE_INPUT_REQUESTED" });
		editor.commands.focus(undefined, { scrollIntoView: false });
	};
	const applyWikiSuggestionToExistingLink = (
		suggestion: (typeof wikiSuggestions)[number],
	) => {
		if (!editor || !activeLink) return;
		const linkType = editor.state.schema.marks.link;
		if (!linkType) return;

		const nextLink = {
			...activeLink,
			href: suggestion.path,
			kind: "wiki" as const,
			target: suggestion.target,
		};
		const attrs = {
			href: suggestion.path,
			kind: "wiki",
			target: suggestion.target,
		};
		if (activeLink.from === activeLink.to) {
			const marks = (
				editor.state.storedMarks ?? editor.state.selection.$from.marks()
			).filter((mark) => mark.type !== linkType);
			editor.view.dispatch(
				editor.state.tr.setStoredMarks([...marks, linkType.create(attrs)]),
			);
		} else {
			const currentText = editor.state.doc.textBetween(
				activeLink.from,
				activeLink.to,
				"",
			);
			// Update inline text only when it still matches the linked file name.
			const oldTarget =
				originalWikiTargetRef.current?.activeKey ===
				machineStateRef.current.activeKey
					? originalWikiTargetRef.current.target
					: activeLink.target || activeLink.href;
			const oldAutoTitle = wikiDisplayNameForTarget(oldTarget);
			if (currentText === oldAutoTitle) {
				const tr = editor.state.tr.replaceWith(
					activeLink.from,
					activeLink.to,
					editor.state.schema.text(suggestion.title, [linkType.create(attrs)]),
				);
				editor.view.dispatch(tr);
			} else {
				const tr = editor.state.tr.removeMark(
					activeLink.from,
					activeLink.to,
					linkType,
				);
				tr.addMark(activeLink.from, activeLink.to, linkType.create(attrs));
				editor.view.dispatch(tr);
			}
		}
		// Edits can close before selection sync runs, so keep preview/open state
		// aligned with the transaction we just dispatched.
		setActiveLink(nextLink);
		setHrefValue(suggestion.target);
		dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
	};
	const applyWikiSuggestion = (
		suggestion: (typeof wikiSuggestions)[number],
	) => {
		if (!editor) return;
		if (machineStateRef.current.mode === "creating") {
			if (creationCursorPos === null) return;
			clearGhostText(editor);
			insertWikiLinkedText(
				editor,
				creationCursorPos,
				suggestion.title,
				suggestion.path,
				suggestion.target,
			);
			dispatchMachineEvent({ type: "CREATION_CONFIRMED" });
			editor.commands.focus(undefined, { scrollIntoView: false });
			return;
		}
		applyWikiSuggestionToExistingLink(suggestion);
	};
	const moveSuggestion = (delta: 1 | -1) => {
		const count = wikiSuggestions.length;
		if (count === 0) return;
		setActiveSuggestionIndex((index) => {
			const boundedIndex = Math.min(index, count - 1);
			return (boundedIndex + delta + count) % count;
		});
	};

	// ── Link detection + positioning for existing links ─────────────
	useEffect(() => {
		if (!editor) return;
		const update = (reason: PositionUpdateReason = "layout") => {
			const { link, activeKey } = getLinkSession(editor);
			if (!link || !activeKey || link.kind !== "wiki") {
				originalWikiTargetRef.current = null;
			} else if (originalWikiTargetRef.current?.activeKey !== activeKey) {
				originalWikiTargetRef.current = {
					activeKey,
					target: link.target || link.href,
				};
			}
			setActiveLink(link);
			if (link)
				setHrefValue(link.kind === "wiki" ? (link.target ?? "") : link.href);
			dispatchMachineEvent({
				type: "LINK_SESSION_CHANGED",
				activeKey,
			});
			if (expandNextLinkSessionRef.current && activeKey) {
				expandNextLinkSessionRef.current = false;
				dispatchMachineEvent({ type: "EXPAND_REQUESTED" });
			}

			const viewport = viewportRef.current;
			const floatingEl = popoverRef.current;
			const isCreating =
				machineStateRef.current.mode === "creating" &&
				creationCursorPos !== null;
			const shouldPosition = Boolean(
				link || machineStateRef.current.pendingCreation || isCreating,
			);
			// Transitions are allowed only when the popover is already anchored
			// to this exact link. Read the ref before advancing so we can compare
			// against the previous anchor state.
			const isAnchored =
				activeKey !== null &&
				anchorRef.current.activeKey === activeKey &&
				anchorRef.current.anchoredKey === activeKey;
			const shouldDetach = shouldDetachAnchor({
				reason,
				inputMode,
				activeKey,
				previousSelectionActiveKey: lastSelectionActiveKeyRef.current,
			});

			setAnchorState({
				type: "LINK_SYNCED",
				activeKey,
				shouldDetach,
			});
			setAnimatePosition(isAnchored && reason === "selection" && !shouldDetach);
			if (reason === "selection") {
				lastSelectionActiveKeyRef.current = activeKey;
			}
			if (!viewport || !floatingEl || !shouldPosition) return;
			const requestId = ++positionRequestIdRef.current;
			void updateFloatingPosition(
				editor,
				viewport,
				floatingEl,
				isCreating ? creationCursorPos : editor.state.selection.from,
				machineStateRef.current.mode,
				setFloatingX,
				setFloatingY,
			).then(() => {
				if (requestId !== positionRequestIdRef.current) return;
				setAnchorState({ type: "POSITIONED", activeKey });
			});
		};
		positionUpdateRef.current = update;
		update();

		const handleSelectionUpdate = () => update("selection");
		const handleTransaction = () => update("transaction");
		const handleFocus = () => update("focus");
		const handleBlur = () => update("blur");
		const handleResize = () => update("resize");
		const handleScroll = () => update("scroll");

		editor.on("selectionUpdate", handleSelectionUpdate);
		editor.on("transaction", handleTransaction);
		editor.on("focus", handleFocus);
		editor.on("blur", handleBlur);
		window.addEventListener("resize", handleResize);
		viewportRef.current?.addEventListener("scroll", handleScroll, {
			passive: true,
		});

		return () => {
			positionUpdateRef.current = null;
			editor.off("selectionUpdate", handleSelectionUpdate);
			editor.off("transaction", handleTransaction);
			editor.off("focus", handleFocus);
			editor.off("blur", handleBlur);
			window.removeEventListener("resize", handleResize);
			viewportRef.current?.removeEventListener("scroll", handleScroll);
		};
	}, [
		editor,
		viewportRef,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		dispatchMachineEvent,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		setAnchorState,
		creationCursorPos,
		inputMode,
	]);

	// ── Listen for FOCUS_LINK_POPOVER_EVENT (selection-based flow) ──
	useEffect(
		() => {
			const onFocusRequest = () => {
				expandNextLinkSessionRef.current = true;
				dispatchMachineEvent({ type: "EXPAND_REQUESTED" });
				// SmartLinkExtension fires this right after dispatching a transaction
				// that may create an empty link. Read the session after that state lands.
				queueMicrotask(() => {
					if (!editor) return;
					const { link } = getLinkSession(editor);
					if (!link || link.href) return;
					void navigator.clipboard
						.readText()
						.then((clipboardValue) => {
							const href = clipboardValue.trim();
							if (!canAutofillLinkFromClipboard(href)) return;
							updateLinkMark(editor, link, href);
							setHrefValue(href);
							setActiveLink({ ...link, ...linkAttrsForHref(href) });
							dispatchMachineEvent({ type: "EXPAND_REQUESTED" });
						})
						.catch(() => {});
				});
			};
			window.addEventListener(
				FOCUS_LINK_POPOVER_EVENT,
				onFocusRequest as EventListener,
			);
			return () => {
				window.removeEventListener(
					FOCUS_LINK_POPOVER_EVENT,
					onFocusRequest as EventListener,
				);
			};
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes the render-local callback.
		[editor, dispatchMachineEvent],
	);

	// ── Listen for LINK_CREATION_REQUESTED_EVENT (empty-selection Cmd+K) ──
	useEffect(
		() => {
			const onCreationRequested = (event: Event) => {
				const pos = (event as CustomEvent<{ pos: number }>).detail.pos;
				setCreationCursorPos(pos);
				setCreationHref("");
				dispatchMachineEvent({ type: "CREATION_REQUESTED" });
			};
			window.addEventListener(
				LINK_CREATION_REQUESTED_EVENT,
				onCreationRequested,
			);
			return () => {
				window.removeEventListener(
					LINK_CREATION_REQUESTED_EVENT,
					onCreationRequested,
				);
			};
		},
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes the render-local callback.
		[dispatchMachineEvent],
	);

	// ── Focus input when entering creating or actions mode ──────────
	useEffect(() => {
		positionUpdateRef.current?.("layout");
		if (machineState.mode !== "actions" && machineState.mode !== "creating")
			return;
		queueMicrotask(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [machineState.mode]);

	// ── Ghost text decoration management ────────────────────────────
	useEffect(() => {
		if (!editor) return;
		if (
			machineState.mode === "creating" &&
			creationCursorPos !== null &&
			creationHref
		) {
			editor.view.dispatch(
				editor.state.tr.setMeta(linkCreationGhostKey, {
					pos: creationCursorPos,
					text: creationHref,
				}),
			);
		} else if (machineState.mode !== "creating") {
			clearGhostText(editor);
		}
	}, [editor, machineState.mode, creationCursorPos, creationHref]);

	// ── Pointer: creating mode ──────────────────────────────────────
	useEffect(() => {
		if (!editor || machineState.mode !== "creating") return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (popoverRef.current?.contains(target)) return;

			requestAnimationFrame(() => {
				const clickedCreationCursor =
					creationCursorPos !== null &&
					editor.view.dom.contains(target) &&
					editor.state.selection.empty &&
					editor.state.selection.from === creationCursorPos;

				if (clickedCreationCursor) {
					openCreationTitleInput();
					return;
				}

				clearGhostText(editor);
				const { link, activeKey } = getLinkSession(editor);
				setActiveLink(link);
				if (link)
					setHrefValue(link.kind === "wiki" ? (link.target ?? "") : link.href);
				// Clicking anywhere else should behave like Escape: exit creation
				// mode, then recompute visibility from the editor's real selection.
				dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
				dispatchMachineEvent({ type: "LINK_SESSION_CHANGED", activeKey });
			});
		};

		window.addEventListener("pointerdown", onPointerDown, true);
		return () => window.removeEventListener("pointerdown", onPointerDown, true);
	}, [
		editor,
		machineState.mode,
		creationCursorPos,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		openCreationTitleInput,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		dispatchMachineEvent,
	]);

	// ── Keyboard: creating mode ─────────────────────────────────────
	useEffect(() => {
		if (!editor || machineState.mode !== "creating") return;
		const onKeyDown = (event: KeyboardEvent) => {
			const isInputFocused = document.activeElement === inputRef.current;

			if (
				isInputFocused &&
				(event.key === "ArrowDown" || event.key === "ArrowUp") &&
				wikiSuggestions.length > 0
			) {
				event.preventDefault();
				event.stopPropagation();
				moveSuggestion(event.key === "ArrowDown" ? 1 : -1);
				return;
			}

			if (isInputFocused && keymatch(event, "Enter")) {
				event.preventDefault();
				event.stopPropagation();
				const suggestion = wikiSuggestions[boundedActiveSuggestionIndex];
				if (suggestion) {
					applyWikiSuggestion(suggestion);
					return;
				}
				if (creationHref && creationCursorPos !== null) {
					clearGhostText(editor);
					insertLinkedText(editor, creationCursorPos, creationHref);
				}
				dispatchMachineEvent({ type: "CREATION_CONFIRMED" });
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if (isInputFocused && event.key === "Tab") {
				event.preventDefault();
				event.stopPropagation();
				openCreationTitleInput();
				return;
			}

			if (keymatch(event, "Escape")) {
				event.preventDefault();
				event.stopPropagation();
				clearGhostText(editor);
				dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if (keymatch(event, "CmdOrCtrl+K")) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [
		editor,
		machineState.mode,
		creationHref,
		creationCursorPos,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		dispatchMachineEvent,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		openCreationTitleInput,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		applyWikiSuggestion,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		moveSuggestion,
		wikiSuggestions,
		boundedActiveSuggestionIndex,
	]);

	// ── Keyboard: existing link (preview / actions) ─────────────────
	useEffect(() => {
		if (!editor || !activeLink) return;
		if (machineState.mode === "creating") return;
		const onKeyDown = (event: KeyboardEvent) => {
			const isInputFocused = document.activeElement === inputRef.current;
			const isVisible =
				machineState.mode !== "hidden" || machineState.pendingCreation;

			if (
				isInputFocused &&
				(event.key === "ArrowDown" || event.key === "ArrowUp") &&
				wikiSuggestions.length > 0
			) {
				event.preventDefault();
				event.stopPropagation();
				moveSuggestion(event.key === "ArrowDown" ? 1 : -1);
				return;
			}

			if (
				isInputFocused &&
				keymatch(event, "Enter") &&
				wikiSuggestions.length > 0
			) {
				event.preventDefault();
				event.stopPropagation();
				const suggestion = wikiSuggestions[boundedActiveSuggestionIndex];
				if (suggestion) {
					applyWikiSuggestion(suggestion);
					queueMicrotask(() => {
						editor.commands.focus(undefined, { scrollIntoView: false });
					});
				}
				return;
			}

			if (
				isInputFocused &&
				hrefValue.length === 0 &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				event.preventDefault();
				event.stopPropagation();
				removeActiveLink(editor, activeLink.from, activeLink.to);
				return;
			}

			if (isInputFocused && keymatch(event, "Enter")) {
				event.preventDefault();
				dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if ((isVisible || editor.isFocused) && keymatch(event, "Escape")) {
				event.preventDefault();
				const shouldReturnFocusToEditor =
					machineState.mode === "preview" || machineState.mode === "actions";
				queueMicrotask(() => {
					dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
					if (shouldReturnFocusToEditor) {
						editor.commands.focus(undefined, {
							scrollIntoView: false,
						});
					}
				});
				return;
			}

			if (keymatch(event, "CmdOrCtrl+K")) {
				if (!isVisible) return;
				event.preventDefault();
				event.stopPropagation();
				dispatchMachineEvent({ type: "TOGGLE_ACTIONS_REQUESTED" });
				return;
			}
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [
		editor,
		activeLink,
		machineState.mode,
		machineState.pendingCreation,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		dispatchMachineEvent,
		hrefValue,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		applyWikiSuggestion,
		// biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes this render-local callback.
		moveSuggestion,
		wikiSuggestions,
		boundedActiveSuggestionIndex,
	]);

	const activeLinkTarget =
		activeLink?.kind === "wiki" ? (activeLink.target ?? activeLink.href) : null;
	const previewText = activeLink
		? activeLink.kind === "wiki"
			? wikiDisplayNameForTarget(activeLinkTarget ?? activeLink.href)
			: linkPreviewText(activeLink.href)
		: linkPreviewText(creationHref);
	const previewTitle = activeLink
		? activeLink.kind === "wiki"
			? (activeLinkTarget ?? activeLink.href)
			: activeLink.href
		: creationHref;
	// ── Early return: nothing visible ───────────────────────────────
	if (!editor) return null;
	if (machineState.mode === "creating") {
		// Render creating UI below (no activeLink needed)
	} else if (machineState.mode === "hidden") {
		return null;
	} else if (!activeLink && !machineState.pendingCreation) {
		return null;
	}

	// ── Handlers ────────────────────────────────────────────────────
	const handleExistingLinkInput = (href: string) => {
		if (!activeLink) return;
		setHrefValue(href);
		updateLinkMark(editor, activeLink, href);
	};

	// ── Render ──────────────────────────────────────────────────────
	const actionButtonClass =
		"h-auto flex-1 justify-center gap-1.5 rounded-none border-0 px-2 text-foreground shadow-none inset-shadow-none hover:bg-muted [&_svg]:size-3";
	const suggestionList =
		wikiSuggestions.length > 0 ? (
			<div
				role="listbox"
				className="max-h-40 overflow-y-auto border-b border-border/90 p-1"
			>
				{wikiSuggestions.map((suggestion, index) => {
					const isActive = index === activeSuggestionIndex;
					return (
						<button
							key={suggestion.path}
							type="button"
							role="option"
							aria-selected={isActive}
							className={cn(
								"flex w-full min-w-0 flex-col rounded-[var(--radius-inner)] border-0 bg-transparent px-2 py-1 text-start text-[11px] leading-[15px] text-popover-foreground hover:bg-accent",
								isActive && "bg-muted text-foreground",
							)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => applyWikiSuggestion(suggestion)}
						>
							<span className="w-full truncate">{suggestion.title}</span>
							<span className="w-full truncate text-[10px] leading-[13px] text-muted-foreground">
								{suggestion.target}
							</span>
						</button>
					);
				})}
			</div>
		) : null;

	return (
		<div
			ref={popoverRef}
			className={cn(
				"absolute z-[4] w-[250px]",
				animatePosition &&
					"transition-[inset-inline-start,inset-block-start] motion-reduce:transition-none duration-[var(--cursor-motion-duration)] ease-cursor-motion",
			)}
			style={{
				insetInlineStart: `${floatingX}px`,
				insetBlockStart: `${floatingY}px`,
			}}
		>
			{machineState.mode === "creating" ? (
				<div className="w-full overflow-hidden rounded-[var(--radius-popover)] border border-border bg-popover shadow-overlay">
					{suggestionList}
					<div className="p-1">
						<Input
							ref={inputRef}
							type="text"
							value={creationHref}
							placeholder="Paste or type a link"
							onChange={(event) => {
								setCreationHref(event.target.value);
								setActiveSuggestionIndex(0);
							}}
							className="h-7 rounded-sm border-border bg-background px-2 py-[5px] text-[11px] leading-[16px]"
						/>
					</div>
					<div className="flex h-6 items-center px-2 text-[9px] leading-[14px] tracking-[0.12em] text-muted-foreground/85">
						<span>⇥ to set title</span>
					</div>
				</div>
			) : machineState.mode === "preview" ? (
				<div className="flex justify-center">
					<div
						ref={previewButtonRef}
						className={cn(
							"group flex h-7 min-w-0 overflow-hidden rounded-[var(--radius-popover)] border border-border bg-card shadow-xs",
							styles.previewButton,
						)}
					>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							title={previewTitle}
							className="group/preview-label relative h-full min-w-0 flex-1 justify-start rounded-none border-0 py-[5px] ps-2 pe-0 text-left text-[11px] leading-[16px] text-foreground shadow-none inset-shadow-none transition-[padding] duration-[var(--default-transition-duration)] ease-snappy hover:bg-muted group-hover/preview-label:pe-8"
							onClick={() => dispatchMachineEvent({ type: "EXPAND_REQUESTED" })}
						>
							<PreviewLabel key={previewText} text={previewText} />
							<span
								aria-hidden="true"
								className="pointer-events-none absolute inset-block-0 end-0 z-20 flex w-8 items-center justify-center bg-linear-to-l from-card via-card/95 to-transparent text-muted-foreground opacity-0 transition-opacity duration-[var(--default-transition-duration)] ease-snappy group-hover/preview-label:from-muted group-hover/preview-label:via-muted/95 group-hover/preview-label:opacity-100"
							>
								<MingcutePencilFill
									aria-hidden="true"
									className="h-3 w-3 shrink-0"
								/>
							</span>
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Copy link"
							title="Copy link"
							className="relative z-20 flex h-full w-7 shrink-0 items-center justify-center border-0 bg-card p-0 text-muted-foreground transition-colors duration-[var(--default-transition-duration)] ease-snappy hover:bg-muted hover:text-foreground"
							onClick={() => {
								if (!activeLink) return;
								void copyLinkToClipboard(
									linkClipboardText(activeLink),
									onMessage,
								);
							}}
						>
							<MingcuteCopy2Line aria-hidden="true" className="size-3" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Open link"
							className="h-full w-9 shrink-0 rounded-none border-0 bg-primary px-0 text-primary-foreground shadow-none inset-shadow-none hover:bg-primary/90 hover:text-primary-foreground"
							onClick={() => {
								if (!activeLink) return;
								void visitActiveLink(
									activeLink,
									onOpenExternalLink,
									onOpenWikiLink,
									onMessage,
								);
							}}
						>
							{activeLink?.kind === "wiki" ? (
								<MingcuteArrowRightLine
									aria-hidden="true"
									className="size-3.5"
								/>
							) : (
								<span aria-hidden="true">↗</span>
							)}
						</Button>
					</div>
				</div>
			) : (
				<div className="w-full overflow-hidden rounded-[var(--radius-popover)] border border-border bg-popover shadow-overlay">
					{suggestionList}
					<div className="p-1">
						<Input
							ref={inputRef}
							type="text"
							value={hrefValue}
							placeholder="⌫ to remove link"
							onChange={(event) => {
								handleExistingLinkInput(event.target.value);
								setActiveSuggestionIndex(0);
							}}
							className="h-7 rounded-sm border-border bg-background px-2 py-[5px] text-[11px] leading-[16px]"
						/>
					</div>
					<Separator className="bg-border/90" />
					<div className="flex h-8 items-stretch text-[11px] leading-[16px]">
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className={actionButtonClass}
							onClick={() => {
								if (!activeLink) return;
								removeActiveLink(editor, activeLink.from, activeLink.to);
							}}
							aria-label="Remove link"
							title="Remove link"
						>
							<MingcuteDelete2Line aria-hidden="true" />
							<span>Remove</span>
						</Button>
						<Separator
							orientation="vertical"
							className="self-stretch bg-border/90"
						/>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className={actionButtonClass}
							onClick={() => {
								if (!activeLink) return;
								void copyLinkToClipboard(
									linkClipboardText(activeLink),
									onMessage,
								);
							}}
							aria-label="Copy link"
							title="Copy link"
						>
							<MingcuteCopy2Line aria-hidden="true" />
							<span>Copy</span>
						</Button>
						<Separator
							orientation="vertical"
							className="self-stretch bg-border/90"
						/>
						<Button
							type="button"
							variant="default"
							size="xs"
							className="h-auto flex-1 justify-center gap-1.5 rounded-none border-0 px-2 text-primary-foreground shadow-none inset-shadow-none hover:brightness-105"
							onClick={() => {
								dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
							}}
							aria-label="Done"
							title="Done"
						>
							<MingcuteCheckLine aria-hidden="true" className="size-3" />
							<span>Done</span>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
