import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useEffect, useState } from "react";
import { desktopApi } from "../desktopApi";
import { IframeView, MIN_IFRAME_HEIGHT, toAssetUrl } from "./IframeView";
import "./EmbedExtension.css";

type EmbedAttrs = {
	kind?: "iframe";
	src?: string;
};

type EmbedExtensionOptions = {
	workspacePath: string | null;
	filePath: string;
};

export function createEmbedExtension(options: EmbedExtensionOptions) {
	return Node.create({
		name: "embed",
		group: "block",
		atom: true,
		selectable: true,
		draggable: true,

		addAttributes() {
			return {
				kind: { default: "iframe" },
				src: { default: "" },
			};
		},

		renderHTML({ node }) {
			const attrs = node.attrs as EmbedAttrs;
			return ["iframe", { src: attrs.src ?? "" }];
		},

		addNodeView() {
			return ReactNodeViewRenderer((props) => (
				<IframeEmbedNodeView
					attrs={props.node.attrs as EmbedAttrs}
					filePath={options.filePath}
					workspacePath={options.workspacePath}
				/>
			));
		},
	});
}

function IframeEmbedNodeView({
	attrs,
	filePath,
	workspacePath,
}: {
	attrs: EmbedAttrs;
	filePath: string;
	workspacePath: string | null;
}) {
	const [error, setError] = useState<string | null>(null);
	const [height, setHeight] = useState(MIN_IFRAME_HEIGHT);
	const [resolvedEmbed, setResolvedEmbed] = useState<{
		path: string;
		suffix: string;
	} | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const src = attrs.src ?? "";

	useEffect(() => {
		let cancelled = false;
		setResolvedEmbed(null);
		setError(null);
		setHeight(MIN_IFRAME_HEIGHT);
		setReloadKey(0);

		if (!isValidIframeSrc(src)) {
			setError("Iframe embed src must be a local .html path.");
			return;
		}

		const { path, suffix } = splitIframeSrc(src);
		const htmlPath = joinPath(dirname(filePath), path);
		const rootPath = workspacePath ?? dirname(filePath);
		void desktopApi
			.resolvePath(htmlPath)
			.then(async (absolutePath) => {
				const absoluteRootPath = await desktopApi.resolvePath(rootPath);
				if (!isPathWithin(absoluteRootPath, absolutePath)) {
					throw new Error("Iframe embed src must stay inside the workspace.");
				}
				return { path: absolutePath, suffix };
			})
			.then((resolvedEmbed) => {
				if (!cancelled) setResolvedEmbed(resolvedEmbed);
			})
			.catch((error) => {
				if (!cancelled) {
					setError(error instanceof Error ? error.message : String(error));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [filePath, src, workspacePath]);

	useEffect(() => {
		if (!resolvedEmbed) return;
		let disposed = false;
		let unwatch: null | (() => void) = null;

		const setup = async () => {
			unwatch = await desktopApi.watchPath(
				resolvedEmbed.path,
				{ recursive: false },
				(paths) => {
					if (!paths.includes(resolvedEmbed.path)) return;
					setReloadKey((current) => current + 1);
				},
			);
			if (disposed) unwatch();
		};

		void setup();
		return () => {
			disposed = true;
			if (unwatch) unwatch();
		};
	}, [resolvedEmbed]);

	return (
		<NodeViewWrapper className="hubble-embed">
			{error ? (
				<p className="hubble-embed-error">{error}</p>
			) : (
				<IframeView
					className="hubble-iframe-embed"
					htmlAppPath={resolvedEmbed?.path ?? ""}
					onError={setError}
					onHeightChange={(nextHeight) =>
						setHeight((current) =>
							current === nextHeight ? current : nextHeight,
						)
					}
					src={
						resolvedEmbed
							? embedAssetUrl(
									resolvedEmbed.path,
									resolvedEmbed.suffix,
									reloadKey,
								)
							: ""
					}
					style={{ blockSize: `${height}px` }}
					title={src || "Hubble iframe embed"}
					workspacePath={workspacePath}
				/>
			)}
		</NodeViewWrapper>
	);
}

function joinPath(root: string, ...parts: string[]) {
	const normalizedRoot = root.replace(/[\\/]+$/, "");
	return [normalizedRoot, ...parts].join("/");
}

function dirname(filePath: string): string {
	const normalized = filePath.split("\\").join("/");
	const idx = normalized.lastIndexOf("/");
	if (idx <= 0) return normalized;
	return normalized.slice(0, idx);
}

const BLOCKED_IFRAME_SCHEME = /^(file:|data:|javascript:|hubble-asset:)/i;
const LOCAL_IFRAME_SRC = /^(\.{1,2}\/|[^:/\\]+(?:\/|$)).*\.html(?:[?#].*)?$/i;

/**
 * Iframe embeds may point to workspace-local .html files only. Paths resolve
 * relative to the Markdown file; remote URLs, app-internal schemes, inline code,
 * and local absolute paths are rejected.
 */
function isValidIframeSrc(src: string): boolean {
	if (!src.trim()) return false;
	if (BLOCKED_IFRAME_SCHEME.test(src)) {
		return false;
	}
	if (src.startsWith("/") || src.startsWith("\\") || src.startsWith("//")) {
		return false;
	}
	return LOCAL_IFRAME_SRC.test(src);
}

function embedAssetUrl(path: string, suffix: string, reloadKey: number) {
	if (reloadKey === 0) return `${toAssetUrl(path)}${suffix}`;

	const hashIndex = suffix.indexOf("#");
	const query = hashIndex === -1 ? suffix : suffix.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : suffix.slice(hashIndex);
	const separator = query.includes("?") ? "&" : "?";
	return `${toAssetUrl(path)}${query}${separator}hubble-reload=${reloadKey}${hash}`;
}

function splitIframeSrc(src: string): { path: string; suffix: string } {
	const suffixIndex = src.search(/[?#]/);
	if (suffixIndex === -1) return { path: src, suffix: "" };
	return {
		path: src.slice(0, suffixIndex),
		suffix: src.slice(suffixIndex),
	};
}

function isPathWithin(rootPath: string, path: string): boolean {
	const root = normalizePath(rootPath);
	const candidate = normalizePath(path);
	return candidate === root || candidate.startsWith(`${root}/`);
}

function normalizePath(path: string): string {
	const normalized = path.split("\\").join("/").replace(/\/+$/, "");
	return normalized || "/";
}
