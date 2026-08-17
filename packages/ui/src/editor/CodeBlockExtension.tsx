import { Select } from "@base-ui/react/select";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TextSelection } from "@tiptap/pm/state";
import {
	NodeViewContent,
	type NodeViewProps,
	NodeViewWrapper,
	ReactNodeViewRenderer,
} from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { useState } from "react";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import { Button } from "../primitives/button";

const DEFAULT_TAB_SIZE = 4;
const TWO_SPACE_LANGUAGES = new Set([
	"css",
	"html",
	"js",
	"json",
	"jsx",
	"md",
	"ts",
	"tsx",
]);
export const CODE_BLOCK_COPY_EVENT = "hubble:code-block-copy";

const lowlight = createLowlight(common);
lowlight.registerAlias({
	javascript: ["js", "jsx"],
	typescript: ["ts", "tsx"],
	xml: ["html"],
	bash: ["sh", "shell"],
	markdown: ["md"],
});

export const HubbleCodeBlock = CodeBlockLowlight.extend({
	addKeyboardShortcuts() {
		const { "Mod-Alt-c": _toggleCodeBlock, ...shortcuts } =
			this.parent?.() ?? {};
		return {
			...shortcuts,
			Tab: ({ editor }) => {
				const { state } = editor;
				const { selection } = state;
				const { $from, empty } = selection;
				if ($from.parent.type !== this.type) return false;

				const tabSize = tabSizeForLanguage($from.parent.attrs.language);
				const indent = " ".repeat(tabSize);

				if (empty) {
					return editor.commands.insertContent(indent);
				}

				return editor.commands.command(({ tr }) => {
					const { from, to } = selection;
					const text = state.doc.textBetween(from, to, "\n", "\n");
					const indentedText = text
						.split("\n")
						.map((line) => indent + line)
						.join("\n");
					tr.replaceWith(from, to, state.schema.text(indentedText));
					return true;
				});
			},
			Backspace: ({ editor }) => {
				const { state } = editor;
				const { selection } = state;
				if (!selection.empty) return false;

				const { $from } = selection;
				if ($from.parent.type !== this.type) return false;

				const blockStart = $from.start();
				const textBeforeCursor = state.doc.textBetween(
					blockStart,
					$from.pos,
					"\n",
					"\n",
				);
				const lineStart = textBeforeCursor.lastIndexOf("\n") + 1;
				const column = textBeforeCursor.length - lineStart;
				const linePrefix = textBeforeCursor.slice(lineStart);
				const tabSize = tabSizeForLanguage($from.parent.attrs.language);
				const previousSegment = linePrefix.slice(-tabSize);

				// Treat soft-tab spaces as one indentation unit at tab stops.
				if (
					column === 0 ||
					column % tabSize !== 0 ||
					previousSegment !== " ".repeat(tabSize)
				) {
					return false;
				}

				return editor.commands.command(({ tr }) => {
					const from = $from.pos - tabSize;
					tr.delete(from, $from.pos);
					tr.setSelection(TextSelection.create(tr.doc, from));
					return true;
				});
			},
		};
	},
	addNodeView() {
		return ReactNodeViewRenderer(CodeBlockView);
	},
}).configure({
	lowlight,
	enableTabIndentation: false,
	tabSize: DEFAULT_TAB_SIZE,
});

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
	const language =
		typeof node.attrs.language === "string" ? node.attrs.language : "";
	const [selectOpen, setSelectOpen] = useState(false);

	return (
		<NodeViewWrapper className="pm-code-block" as="div">
			<div
				className="pm-code-block-controls"
				contentEditable={false}
				data-select-open={selectOpen}
			>
				<Select.Root
					open={selectOpen}
					onOpenChange={setSelectOpen}
					value={language}
					onValueChange={(next) => updateAttributes({ language: next || null })}
				>
					<Select.Trigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="xs"
								aria-label="Code block language"
								title="Code block language"
								className="pm-code-block-language h-4"
							/>
						}
					>
						<Select.Value>
							{languageLabel(language) || "Plain text"}
						</Select.Value>
					</Select.Trigger>
					<Select.Portal>
						<Select.Positioner
							align="end"
							side="bottom"
							sideOffset={8}
							className="isolate z-50"
						>
							<Select.Popup className="z-50 w-40 origin-(--transform-origin) rounded-[var(--radius-popover)] border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-overlay outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
								{codeBlockLanguages.map((option) => (
									<Select.Item
										key={option.value}
										value={option.value}
										className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-start text-[11px] text-foreground outline-hidden select-none data-highlighted:bg-accent"
									>
										<Select.ItemIndicator className="inline-flex" keepMounted>
											<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
										</Select.ItemIndicator>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								))}
							</Select.Popup>
						</Select.Positioner>
					</Select.Portal>
				</Select.Root>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Copy code"
					title="Copy code"
					className="size-4"
					onClick={() => {
						void copyCodeBlock(node.textContent);
					}}
				>
					<MingcuteCopy2Line className="size-3.5" />
				</Button>
			</div>
			<pre>
				<NodeViewContent<"code">
					as="code"
					className={language ? `language-${language}` : undefined}
					style={{ whiteSpace: "inherit" }}
				/>
			</pre>
		</NodeViewWrapper>
	);
}

function languageLabel(value: string) {
	return codeBlockLanguages.find((option) => option.value === value)?.label;
}

function tabSizeForLanguage(language: unknown) {
	return typeof language === "string" && TWO_SPACE_LANGUAGES.has(language)
		? 2
		: DEFAULT_TAB_SIZE;
}

async function copyCodeBlock(text: string) {
	try {
		await navigator.clipboard.writeText(text);
		// TODO: Revisit if UI grows a shared toast store; this bridges TipTap's node view to EditorView's onMessage without adding app state here.
		window.dispatchEvent(
			new CustomEvent(CODE_BLOCK_COPY_EVENT, {
				detail: { message: "Code copied", type: "success" },
			}),
		);
	} catch {
		window.dispatchEvent(
			new CustomEvent(CODE_BLOCK_COPY_EVENT, {
				detail: { message: "Failed to copy code", type: "error" },
			}),
		);
	}
}

const codeBlockLanguages = [
	{ value: "", label: "Plain text" },
	{ value: "js", label: "JavaScript" },
	{ value: "ts", label: "TypeScript" },
	{ value: "jsx", label: "JSX" },
	{ value: "tsx", label: "TSX" },
	{ value: "json", label: "JSON" },
	{ value: "css", label: "CSS" },
	{ value: "html", label: "HTML" },
	{ value: "md", label: "Markdown" },
	{ value: "sh", label: "Shell" },
	{ value: "python", label: "Python" },
	{ value: "rust", label: "Rust" },
	{ value: "go", label: "Go" },
] as const;
