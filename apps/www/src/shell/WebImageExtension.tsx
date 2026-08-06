import { useStoreValue } from "@simplestack/store/react";
import Image from "@tiptap/extension-image";
import {
	type NodeViewProps,
	NodeViewWrapper,
	ReactNodeViewRenderer,
} from "@tiptap/react";
import { type CSSProperties, useEffect, useState } from "react";
import MingcuteLoading3Line from "~icons/mingcute/loading-3-line";
import { resolveAssetDownloadUrl, uploadAssetFile } from "../store/actions";
import { assetsStore, currentPathStore } from "../store/state";

const uploads = new Map<string, Promise<string>>();

export function createWebImageExtension() {
	return Image.extend({
		group: "block tableCellContent",
		addAttributes() {
			return {
				...this.parent?.(),
				uploadId: {
					default: null,
					renderHTML: () => ({}),
				},
				uploadStatus: {
					default: null,
					renderHTML: () => ({}),
				},
				uploadFile: {
					default: null,
					renderHTML: () => ({}),
				},
				width: {
					default: null,
					renderHTML: () => ({}),
				},
				height: {
					default: null,
					renderHTML: () => ({}),
				},
			};
		},
		addNodeView() {
			return ReactNodeViewRenderer(WebImageNodeView);
		},
	}).configure({
		inline: false,
		allowBase64: true,
	});
}

function WebImageNodeView({ node, selected, updateAttributes }: NodeViewProps) {
	const rawSrc = String(node.attrs.src ?? "");
	const uploadId =
		typeof node.attrs.uploadId === "string" ? node.attrs.uploadId : null;
	const uploadFile =
		node.attrs.uploadFile instanceof File ? node.attrs.uploadFile : null;
	const width = typeof node.attrs.width === "number" ? node.attrs.width : 640;
	const height =
		typeof node.attrs.height === "number" ? node.attrs.height : 360;
	const assets = useStoreValue(assetsStore);
	const path = useStoreValue(currentPathStore) ?? "";
	const assetKey = assets
		.map((asset) => `${asset.path}:${asset.storageId}:${asset.deleted}`)
		.join("|");
	const [resolvedSrc, setResolvedSrc] = useState(rawSrc);
	const [resolveFailed, setResolveFailed] = useState(false);
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
		void uploadOnce(uploadId, path, uploadFile)
			.then((src) => {
				if (cancelled) return;
				updateAttributes({
					src,
					uploadId: null,
					uploadStatus: null,
					uploadFile: null,
				});
			})
			.catch((err) => {
				console.error("image upload failed:", err);
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
	}, [path, rawSrc, updateAttributes, uploadFile, uploadId]);

	useEffect(() => {
		void assetKey;
		let cancelled = false;
		if (rawSrc.trim().length === 0) {
			setResolvedSrc("");
			setResolveFailed(false);
			return;
		}
		if (!isRelativeAssetPath(rawSrc)) {
			setResolvedSrc(rawSrc);
			setResolveFailed(false);
			return;
		}
		setResolveFailed(false);
		void resolveAssetDownloadUrl(path, rawSrc).then((url) => {
			if (cancelled) return;
			setResolvedSrc(url ?? "");
			setResolveFailed(!url);
		});
		return () => {
			cancelled = true;
		};
	}, [rawSrc, assetKey, path]);

	const isWaitingForResolvedSrc =
		rawSrc.trim().length > 0 && resolvedSrc.length === 0 && !resolveFailed;

	return (
		<NodeViewWrapper as="div" data-drag-handle data-hubble-image-src={rawSrc}>
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
				) : resolvedSrc.length > 0 ? (
					<img
						src={resolvedSrc}
						alt={node.attrs.alt || ""}
						title={node.attrs.title || ""}
						className={selected ? "outline-2 outline-blue-400" : ""}
					/>
				) : isWaitingForResolvedSrc ? (
					<UploadPlaceholder />
				) : (
					<div className="pm-image-missing">Image unavailable</div>
				)}
			</div>
		</NodeViewWrapper>
	);
}

function uploadOnce(id: string, path: string, file: File): Promise<string> {
	const existing = uploads.get(id);
	if (existing) return existing;
	const upload = uploadAssetFile({ path, file }).finally(() => {
		uploads.delete(id);
	});
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

function isRelativeAssetPath(src: string): boolean {
	return !/^(data:|https?:|file:|blob:)/i.test(src);
}
