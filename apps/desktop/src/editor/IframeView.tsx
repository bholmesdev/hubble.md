import { hasMarkdownExtension, withMarkdownExtension } from "@hubble.md/editor";
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod/v4";
import { desktopApi } from "../desktopApi";
import {
	absoluteWorkspacePath,
	dirname,
	normalizePath,
	pathEquals,
} from "../lib/filePath";
import {
	assertPathInWorkspace,
	relativePathWithin,
	resolveWorkspaceFilePath,
} from "../lib/workspacePath";
import {
	deleteMarkdownFile,
	loadPath,
	refreshFiles,
	touchFile,
} from "../store/actions";
import { cleanFileState, getBaseline, viewerStore } from "../store/state";
import {
	applyPatchToMarkdown,
	type HtmlAppFilePatch,
	parseMarkdownFile,
} from "./htmlAppFileApi";

type HtmlAppRequest = {
	type?: unknown;
	id?: unknown;
	method?: unknown;
	params?: unknown;
	token?: unknown;
};

type IframeViewProps = {
	src: string;
	title: string;
	htmlAppPath: string;
	workspacePath: string | null;
	className: string;
	style?: CSSProperties;
	onError?: (message: string | null) => void;
	onHeightChange?: (height: number) => void;
};

const propertyValueSchema = z.union([
	z.string(),
	z.number().finite(),
	z.boolean(),
	z.array(z.string()),
	z.null(),
]);
const propertiesSchema = z.record(z.string(), propertyValueSchema);
const fileReferenceSchema = z
	.string()
	.refine(
		isSafeFileReference,
		"File path must be workspace-relative or start with ./ or ../.",
	);
const markdownPathSchema = fileReferenceSchema.refine(
	hasMarkdownExtension,
	"File path must point to a Markdown file.",
);
const createInputSchema = z
	.object({
		path: fileReferenceSchema.transform(withMarkdownExtension),
		body: z.string().optional().default(""),
		properties: propertiesSchema.optional(),
		open: z.boolean().optional(),
	})
	.strict();
const filePatchSchema = z
	.object({
		body: z.string().optional(),
		properties: propertiesSchema.optional(),
	})
	.strict()
	.refine(
		(patch) => patch.body !== undefined || patch.properties !== undefined,
		{
			message: "Pass body, properties, or both.",
		},
	);

type CreateFileInput = z.infer<typeof createInputSchema>;

export const MIN_IFRAME_HEIGHT = 80;
export const MAX_IFRAME_HEIGHT = 4000;
export const IFRAME_PADDING = 2;

export function IframeView({
	src,
	title,
	htmlAppPath,
	workspacePath,
	className,
	style,
	onError,
	onHeightChange,
}: IframeViewProps) {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const recordedUseRef = useRef(false);
	const [token] = useState(() => crypto.randomUUID());
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		onError?.(error);
	}, [error, onError]);

	useEffect(() => {
		// Runtime height messages resize inline embeds. Full-page apps ignore the
		// height but still use the message as proof that their runtime booted.
		const onMessage = (event: MessageEvent) => {
			const data = event.data as {
				type?: unknown;
				height?: unknown;
				token?: unknown;
			} | null;
			if (!isMessageForHtmlApp(data, iframeRef.current)) return;
			if (!data || data.type !== "hubble:html-app-height") return;
			// This runtime message proves the injected HTML App booted. iframe load
			// events alone also fire for browser error documents.
			if (!recordedUseRef.current) {
				recordedUseRef.current = true;
				void desktopApi.recordTelemetryActivity({ usedHtmlApp: true });
			}
			if (!onHeightChange) return;
			const height = Number(data.height);
			if (!Number.isFinite(height)) return;
			const clamped = Math.max(
				MIN_IFRAME_HEIGHT,
				Math.min(MAX_IFRAME_HEIGHT, Math.ceil(height) + IFRAME_PADDING),
			);
			onHeightChange?.(clamped);
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [onHeightChange]);

	useLayoutEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const request = event.data as HtmlAppRequest | null;
			if (!isMessageForHtmlApp(request, iframeRef.current)) return;
			if (!request || request.type !== "hubble:request") return;
			void handleHtmlAppRequest(request, workspacePath, htmlAppPath).then(
				(response) => {
					if (!isWindowProxy(event.source)) return;
					event.source.postMessage(
						{ ...response, id: request.id, type: "hubble:response" },
						"*",
					);
				},
			);
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [htmlAppPath, workspacePath]);

	if (error) return null;

	return (
		<iframe
			ref={iframeRef}
			className={className}
			name={token}
			scrolling="auto"
			title={title}
			sandbox="allow-scripts allow-forms"
			src={src}
			style={style}
			width="100%"
			onError={() => setError("Failed to load iframe.")}
			onLoad={() => setError(null)}
		/>
	);
}

export function toAssetUrl(path: string): string {
	const normalized = path.split("\\").join("/");
	const absolutePath = normalized.startsWith("/")
		? normalized
		: `/${normalized}`;
	const encodedPath = absolutePath
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
	const pathWithEncodedRoot = encodedPath.startsWith("/")
		? `%2F${encodedPath.slice(1)}`
		: encodedPath;
	return `hubble-asset://local/${pathWithEncodedRoot}`;
}

async function handleHtmlAppRequest(
	request: HtmlAppRequest,
	workspacePath: string | null,
	htmlAppPath: string,
) {
	try {
		if (!workspacePath) {
			throw new Error("Open a workspace to query files.");
		}
		const params =
			request.params && typeof request.params === "object"
				? (request.params as Record<string, unknown>)
				: {};
		const resolveFilePath = (path: string, mustExist: boolean) => {
			const basePath = isDotRelative(path)
				? dirname(htmlAppPath)
				: workspacePath;
			if (!basePath) throw new Error("Could not resolve the HTML app folder.");
			return resolveWorkspaceFilePath({
				workspacePath,
				basePath,
				path,
				mustExist,
			});
		};
		if (request.method === "files.list") {
			const glob = typeof params.glob === "string" ? params.glob : "**/*";
			const workspaceGlob = await resolveHtmlAppGlob(
				workspacePath,
				htmlAppPath,
				glob,
			);
			return {
				ok: true,
				value: await desktopApi.listHtmlAppFiles(workspacePath, workspaceGlob),
			};
		}
		if (request.method === "files.read") {
			const path = await resolveFilePath(
				parseInput(markdownPathSchema, params.path),
				true,
			);
			return {
				ok: true,
				value: await readMarkdownFile(workspacePath, path),
			};
		}
		if (request.method === "files.open") {
			const path = await resolveFilePath(
				parseInput(markdownPathSchema, params.path),
				true,
			);
			await openMarkdownFile(workspacePath, path);
			return {
				ok: true,
				value: { path },
			};
		}
		if (request.method === "files.create") {
			const input =
				params.input && typeof params.input === "object"
					? (params.input as Record<string, unknown>)
					: params;
			const createInput = parseInput(createInputSchema, input);
			const path = await resolveFilePath(createInput.path, false);
			return {
				ok: true,
				value: await createMarkdownFile(workspacePath, {
					...createInput,
					path,
				}),
			};
		}
		if (request.method === "files.update") {
			const path = await resolveFilePath(
				parseInput(markdownPathSchema, params.path),
				true,
			);
			const patch = parseInput(filePatchSchema, params.patch);
			const absolutePath = await resolveWorkspaceFile(workspacePath, path, {
				exists: true,
			});
			const markdown = await applyMarkdownPatch(absolutePath, patch);
			await refreshFiles(workspacePath);
			return {
				ok: true,
				value: parseMarkdownFile(path, markdown),
			};
		}
		if (request.method === "files.remove") {
			const path = await resolveFilePath(
				parseInput(markdownPathSchema, params.path),
				true,
			);
			await removeMarkdownFile(workspacePath, path);
			return {
				ok: true,
				value: { path },
			};
		}
		throw new Error(
			`Unknown Hubble HTML app method: ${String(request.method)}`,
		);
	} catch (error) {
		return {
			ok: false,
			error: {
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

/** Converts app-relative globs to paths from the workspace root. */
export async function resolveHtmlAppGlob(
	workspacePath: string,
	htmlAppPath: string,
	glob: string,
) {
	if (!isDotRelative(glob)) return glob.replace(/\\/g, "/");
	const appDirectory = dirname(htmlAppPath);
	if (!appDirectory) throw new Error("Could not resolve the HTML app folder.");
	const [absoluteWorkspace, absoluteAppDirectory] = await Promise.all([
		desktopApi.resolvePath(workspacePath),
		desktopApi.resolvePath(appDirectory),
	]);
	const appDirectoryPath = relativePathWithin(
		absoluteWorkspace,
		absoluteAppDirectory,
	);
	if (appDirectoryPath === null) {
		throw new Error("File path must stay inside the workspace.");
	}
	await assertPathInWorkspace(workspacePath, absoluteAppDirectory, {
		mustExist: true,
	});
	const workspaceGlob = normalizePath(
		`${appDirectoryPath ? `${appDirectoryPath}/` : ""}${glob}`,
	);
	if (
		!workspaceGlob ||
		workspaceGlob === ".." ||
		workspaceGlob.startsWith("../")
	) {
		throw new Error("File path must stay inside the workspace.");
	}
	return workspaceGlob;
}

/**
 * Reads a workspace Markdown file and returns the app-facing shape: body plus
 * supported front matter properties.
 */
async function readMarkdownFile(workspacePath: string, path: string) {
	const absolutePath = await resolveWorkspaceFile(workspacePath, path, {
		exists: true,
	});
	return parseMarkdownFile(path, await desktopApi.readFileText(absolutePath));
}

/**
 * Opens a workspace Markdown file in Hubble after proving the app stayed inside
 * the current workspace.
 */
async function openMarkdownFile(workspacePath: string, path: string) {
	const absolutePath = await resolveWorkspaceFile(workspacePath, path, {
		exists: true,
	});
	await loadPath(absolutePath);
}

/**
 * Creates a Markdown file from the app API input, then returns the same parsed
 * shape that `files.read()` would return for it. Missing parent folders are
 * created by the desktop write API after we validate the nearest existing
 * ancestor is still inside the workspace.
 */
async function createMarkdownFile(
	workspacePath: string,
	input: CreateFileInput,
) {
	const path = input.path;
	const absolutePath = await resolveWorkspaceFile(workspacePath, path, {
		exists: false,
	});
	if (await desktopApi.pathExists(absolutePath)) {
		throw new Error(`File already exists: ${path}`);
	}
	const patch: HtmlAppFilePatch = {
		body: input.body,
	};
	if (input.properties !== undefined) {
		patch.properties = input.properties;
	}
	const markdown = applyPatchToMarkdown("", patch);
	await desktopApi.writeFileText(absolutePath, markdown);
	touchFile(absolutePath);
	await refreshFiles(workspacePath);
	if (input.open === true) {
		await loadPath(absolutePath);
	}
	return parseMarkdownFile(path, markdown);
}

/**
 * Applies a patch from an HTML app to a Markdown file. If the file is already
 * open, use the editor state so we do not overwrite unsaved user edits.
 */
async function applyMarkdownPatch(
	absolutePath: string,
	patch: HtmlAppFilePatch,
) {
	const current = viewerStore.get();
	const isCurrent = current.currentPath
		? pathEquals(current.currentPath, absolutePath)
		: false;
	const hasBody = hasOwn(patch, "body");

	if (isCurrent) {
		const isDirty =
			current.content !== getBaseline(current) ||
			current.externalChange.kind === "conflict";
		if (hasBody && isDirty) {
			throw new Error(
				"Cannot update body while the open file has unsaved edits.",
			);
		}
		const markdown = applyPatchToMarkdown(current.content, patch);
		await desktopApi.writeFileText(absolutePath, markdown);
		touchFile(absolutePath);
		viewerStore.set((state) => {
			if (state.currentPath !== absolutePath) return state;
			if (state.content === current.content) {
				return { ...state, ...cleanFileState(markdown) };
			}
			return {
				...state,
				diskContent: markdown,
				externalChange: { kind: "none" },
				status: "ready",
				error: null,
			};
		});
		return markdown;
	}

	const markdown = await desktopApi.readFileText(absolutePath);
	const nextMarkdown = applyPatchToMarkdown(markdown, patch);
	await desktopApi.writeFileText(absolutePath, nextMarkdown);
	touchFile(absolutePath);
	return nextMarkdown;
}

/**
 * Deletes a workspace Markdown file after the user confirms the app-triggered
 * deletion.
 */
async function removeMarkdownFile(workspacePath: string, path: string) {
	const absolutePath = await resolveWorkspaceFile(workspacePath, path, {
		exists: true,
	});
	if (!window.confirm(`Delete ${path}?`)) {
		throw new Error("File deletion was cancelled.");
	}
	await deleteMarkdownFile(absolutePath, { throwOnError: true });
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (result.success) return result.data;
	throw new Error(result.error.issues[0]?.message ?? "Invalid input");
}

async function resolveWorkspaceFile(
	workspacePath: string,
	path: string,
	options: { exists: boolean },
) {
	const absolutePath = await desktopApi.resolvePath(
		absoluteWorkspacePath(path, workspacePath),
	);
	await assertPathInWorkspace(workspacePath, absolutePath, {
		mustExist: options.exists,
	});
	return absolutePath;
}

function isWindowProxy(source: MessageEventSource | null): source is Window {
	return Boolean(source && "postMessage" in source);
}

function isMessageForHtmlApp(
	data: { token?: unknown } | null,
	iframe: HTMLIFrameElement | null,
): boolean {
	return typeof data?.token === "string" && data.token === iframe?.name;
}

function hasOwn(object: object, key: string) {
	return Object.keys(object).includes(key);
}

function isSafeFileReference(path: string): boolean {
	if (
		!path ||
		path.startsWith("/") ||
		path.startsWith("\\") ||
		path.includes(":")
	) {
		return false;
	}
	if (isDotRelative(path)) {
		const normalized = normalizePath(path);
		return normalized !== "" && normalized !== "." && normalized !== "..";
	}
	return !path
		.split(/[\\/]+/)
		.some((part) => part === "" || part === "." || part === "..");
}

function isDotRelative(path: string) {
	return /^(?:\.\.?)[\\/]/.test(path);
}
