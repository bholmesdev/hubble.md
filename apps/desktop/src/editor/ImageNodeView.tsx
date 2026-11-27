import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { type CSSProperties, useEffect, useState } from "react";
import { toast } from "sonner";
import MingcuteLoading3Line from "~icons/mingcute/loading-3-line";
import { desktopApi } from "../desktopApi";
import { persistPastedImage } from "./handleImagePaste";

const uploads = new Map<string, Promise<string>>();

export function ImageNodeView({
	node,
	filePath,
	selected,
	updateAttributes,
}: NodeViewProps & { filePath: string }) {
	const rawSrc = String(node.attrs.src ?? "");
	const uploadId =
		typeof node.attrs.uploadId === "string" ? node.attrs.uploadId : null;
	const uploadFile =
		node.attrs.uploadFile instanceof File ? node.attrs.uploadFile : null;
	const width = typeof node.attrs.width === "number" ? node.attrs.width : 640;
	const height =
		typeof node.attrs.height === "number" ? node.attrs.height : 360;
	const localPath =
		rawSrc.trim().length > 0 && isResolvableLocalPath(rawSrc)
			? joinPath(dirname(filePath), rawSrc)
			: null;
	const [resolved, setResolved] = useState<{
		path: string;
		src: string;
	} | null>(null);
	const resolvedSrc = localPath
		? resolved?.path === localPath
			? resolved.src
			: null
		: rawSrc;
	const hasMeasuredFrame =
		typeof node.attrs.width === "number" &&
		typeof node.attrs.height === "number";
	const frameStyle = hasMeasuredFrame
		? ({
				inlineSize: `${width}px`,
				aspectRatio: `${width} / ${height}`,
			} satisfies CSSProperties)
		: undefined;

	useEffect(() => {
		if (!uploadId || !uploadFile || rawSrc) return;
		let cancelled = false;
		void uploadOnce(uploadId, filePath, uploadFile)
			.then((src) => {
				if (cancelled) return;
				updateAttributes({
					src,
					uploadId: null,
					uploadStatus: null,
					uploadFile: null,
				});
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				toast.error("Failed to paste image", { description: message });
				if (!cancelled) {
					updateAttributes({
						uploadId: null,
						uploadStatus: "error",
						uploadFile: null,
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [filePath, rawSrc, updateAttributes, uploadFile, uploadId]);

	useEffect(() => {
		if (!localPath) return;
		let cancelled = false;
		// Resolving a local path is not an image failure. Keep that state separate.
		void desktopApi
			.resolvePath(localPath)
			.then((absolutePath) => {
				if (!cancelled)
					setResolved({
						path: localPath,
						src: desktopApi.toAssetUrl(absolutePath),
					});
			})
			.catch(() => {
				if (!cancelled) setResolved({ path: localPath, src: "" });
			});
		return () => {
			cancelled = true;
		};
	}, [localPath]);

	return (
		<NodeViewWrapper as="div" data-drag-handle>
			<div
				className={
					hasMeasuredFrame
						? "pm-image-frame pm-image-frame-measured"
						: "pm-image-frame"
				}
				style={frameStyle}
			>
				{uploadId && rawSrc.length === 0 ? (
					<UploadPlaceholder />
				) : resolvedSrc === null ? null : resolvedSrc.length > 0 ? (
					<img
						src={resolvedSrc}
						alt={node.attrs.alt || ""}
						title={node.attrs.title || ""}
						className={selected ? "outline-2 outline-blue-400" : ""}
					/>
				) : (
					<div className="pm-image-missing">Image unavailable</div>
				)}
			</div>
		</NodeViewWrapper>
	);
}

function uploadOnce(id: string, filePath: string, file: File): Promise<string> {
	const existing = uploads.get(id);
	if (existing) return existing;
	const upload = persistPastedImage({ filePath, imageFile: file }).finally(
		() => {
			uploads.delete(id);
		},
	);
	uploads.set(id, upload);
	return upload;
}

function UploadPlaceholder() {
	return (
		<div className="pm-image-upload-placeholder">
			<div className="pm-image-upload-placeholder-shimmer" />
			<MingcuteLoading3Line
				aria-label="Uploading image"
				className="pm-image-upload-spinner"
			/>
		</div>
	);
}

function dirname(filePath: string): string {
	const normalized = filePath.split("\\").join("/");
	const idx = normalized.lastIndexOf("/");
	if (idx <= 0) return normalized;
	return normalized.slice(0, idx);
}

function normalizePosixPath(path: string): string {
	const parts = path.split("/");
	const stack: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return `/${stack.join("/")}`;
}

function joinPath(baseDir: string, relativePath: string): string {
	const rel = safeDecodeUriComponent(relativePath).split("\\").join("/");
	if (rel === "~" || rel.startsWith("~/")) return rel;
	if (rel.startsWith("/")) return normalizePosixPath(rel);
	return normalizePosixPath(`${baseDir}/${rel}`);
}

function isResolvableLocalPath(src: string): boolean {
	return !/^(data:|https?:|file:|asset:|hubble-asset:)/i.test(src);
}

function safeDecodeUriComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
