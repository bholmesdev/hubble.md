import { Extension } from "@tiptap/core";
import { ListItem } from "@tiptap/extension-list";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
import { isSelectionAtStartOfNode, nearestSharedParentOfType } from "./utils";

const LIST_NODE_NAMES = ["bulletList", "orderedList"];

export const ListItemExtension = ListItem.extend({
	addAttributes() {
		return {
			checked: {
				default: null,
				keepOnSplit: true,
				parseHTML: (element) => {
					const dataChecked = element.getAttribute("data-checked");
					if (dataChecked === null) return null;
					return dataChecked === "" || dataChecked === "true";
				},
				renderHTML: (attributes) =>
					attributes.checked !== null
						? { "data-checked": attributes.checked }
						: {},
			},
		};
	},
	addNodeView() {
		return ({ node, HTMLAttributes, getPos, editor }) => {
			const listItem = document.createElement("li");
			const checkboxWrapper = document.createElement("label");
			const checkboxStyler = document.createElement("span");
			const checkbox = document.createElement("input");

			checkboxWrapper.className = "pm-task-checkbox";
			checkboxStyler.className = "pm-task-checkbox-box";
			const content = document.createElement("div");

			const updateA11Y = (currentNode: PMNode) => {
				checkbox.ariaLabel = `Task item checkbox for ${currentNode.textContent || "empty task item"}`;
			};

			updateA11Y(node);

			checkboxWrapper.contentEditable = "false";
			checkbox.type = "checkbox";
			checkbox.addEventListener("mousedown", (event) => event.preventDefault());
			checkbox.addEventListener("change", (event) => {
				// if the editor isn't editable and we don't have a handler for
				// readonly checks we have to undo the latest change
				if (!editor.isEditable) {
					checkbox.checked = !checkbox.checked;

					return;
				}

				const { checked } = event.target as HTMLInputElement;

				if (editor.isEditable && typeof getPos === "function") {
					editor
						.chain()
						.focus(undefined, { scrollIntoView: false })
						.command(({ tr }) => {
							const position = getPos();

							if (typeof position !== "number") {
								return false;
							}
							const currentNode = tr.doc.nodeAt(position);

							tr.setNodeMarkup(position, undefined, {
								...currentNode?.attrs,
								checked,
							});

							return true;
						})
						.run();
				}
				if (!editor.isEditable) {
					checkbox.checked = !checkbox.checked;
				}
			});

			Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
				listItem.setAttribute(key, value);
			});

			if (isTaskItem(node)) {
				listItem.dataset.checked = node.attrs.checked.toString();
				checkbox.checked = node.attrs.checked;
				checkbox.hidden = false;
			} else {
				listItem.removeAttribute("data-checked");
				checkbox.hidden = true;
			}

			checkboxWrapper.append(checkbox, checkboxStyler);
			listItem.append(checkboxWrapper, content);

			Object.entries(HTMLAttributes).forEach(([key, value]) => {
				listItem.setAttribute(key, value);
			});

			return {
				dom: listItem,
				contentDOM: content,
				update: (updatedNode) => {
					if (updatedNode.type !== this.type) {
						return false;
					}

					if (isTaskItem(updatedNode)) {
						listItem.dataset.checked = updatedNode.attrs.checked.toString();
						checkbox.checked = updatedNode.attrs.checked;
						checkbox.hidden = false;
					} else {
						listItem.removeAttribute("data-checked");
						checkbox.hidden = true;
					}
					updateA11Y(updatedNode);

					return true;
				},
			};
		};
	},
});

export const ListToggleExtension = Extension.create({
	name: "ListToggleExtension",
	priority: 2000,
	addCommands() {
		return {
			toggleParentBulletList:
				() =>
				({ tr, chain }) => {
					const { $from, $to } = tr.selection;
					const nearestListPos = nearestSharedParentOfType(
						$from,
						$to,
						LIST_NODE_NAMES,
					);

					if (nearestListPos === null) {
						return chain().toggleBulletList().run();
					}

					const hasChangedAny = setListItemType("item", tr, nearestListPos);
					if (!hasChangedAny) {
						return chain().toggleBulletList().run();
					}
					return true;
				},
			toggleParentOrderedList:
				() =>
				({ tr, chain }) => {
					const { $from, $to } = tr.selection;
					const nearestListPos = nearestSharedParentOfType(
						$from,
						$to,
						LIST_NODE_NAMES,
					);

					if (nearestListPos === null) {
						return chain().toggleOrderedList().run();
					}
					setListItemType("item", tr, nearestListPos);
					return chain().toggleOrderedList().run();
				},
			toggleParentTaskList:
				(nearestShouldBeBulletList?: boolean) =>
				({ tr, chain }) => {
					const { $from, $to } = tr.selection;
					const nearestListPos = nearestSharedParentOfType(
						$from,
						$to,
						LIST_NODE_NAMES,
					);
					if (nearestListPos === null) {
						if (nearestShouldBeBulletList) {
							throw new Error("FATAL: Bullet list should exist but does not");
						}
						return chain().toggleBulletList().toggleParentTaskList(true).run();
					}
					const nearestList = tr.doc.nodeAt(nearestListPos);
					if (!nearestList) return false;

					if (nearestList.type.name === "orderedList") {
						if (nearestShouldBeBulletList) {
							throw new Error(
								"FATAL: Bullet list should exist, but was still a numbered list",
							);
						}
						return chain().toggleBulletList().toggleParentTaskList(true).run();
					}
					return setListItemType(
						isTaskList(nearestList) ? "item" : "task",
						tr,
						nearestListPos,
					);
				},
		};
	},

	addKeyboardShortcuts() {
		return {
			"Mod-Shift-7": () => this.editor.commands.toggleParentOrderedList(),
			"Mod-Shift-8": () => this.editor.commands.toggleParentBulletList(),
			"Mod-Shift-9": () => this.editor.commands.toggleParentTaskList(),
			Backspace: ({ editor }) => {
				if (isSelectionAtStartOfNode(editor.view.state.selection)) {
					return editor.commands.liftListItem("listItem");
				}
				return false;
			},
			Enter: ({ editor }) => {
				const { selection } = editor.view.state;
				if (isSelectionAtStartOfNode(selection)) {
					return editor.commands.liftListItem("listItem");
				}
				// Splitting a task item should always start the new item unchecked
				const { $from } = selection;
				for (let depth = $from.depth; depth > 0; depth--) {
					if (isTaskItem($from.node(depth))) {
						return editor.commands.splitListItem("listItem", {
							checked: false,
						});
					}
				}
				return false;
			},
		};
	},

	addProseMirrorPlugins() {
		const key = new PluginKey("ClearTaskItemsForNumberedLists");

		return [
			new Plugin({
				key,
				appendTransaction(
					transactions: readonly Transaction[],
					_oldState: EditorState,
					newState: EditorState,
				) {
					const hasDocChanges = transactions.some((tr) => tr.docChanged);
					if (!hasDocChanges) return null;

					const tr = newState.tr;
					let modified = false;

					newState.doc.descendants((node: PMNode, pos: number) => {
						if (node.type.name === "orderedList") {
							node.forEach((child: PMNode, offset: number) => {
								if (isTaskItem(child)) {
									const childPos = pos + offset + 1;
									tr.setNodeMarkup(childPos, undefined, {
										...child.attrs,
										checked: null,
									});
									modified = true;
								}
							});
						}
					});

					return modified ? tr : null;
				},
			}),
		];
	},
});

export const ListAutoJoinExtension = Extension.create({
	name: "ListAutoJoinExtension",

	addProseMirrorPlugins() {
		const key = new PluginKey("ListAutoJoinExtension");

		return [
			new Plugin({
				key,
				appendTransaction(transactions, _oldState, newState) {
					// Run only when the doc changed
					const docChanged = transactions.some((tr) => tr.docChanged);
					if (!docChanged) return null;

					let tr = newState.tr;
					let madeChange = false;

					// Helper to attempt one sweep of joins across the document
					const attemptJoinPass = (): boolean => {
						const boundaries: number[] = [];

						// Collect candidate boundaries: positions immediately after a list node
						newState.doc.descendants((node, pos) => {
							if (!LIST_NODE_NAMES.includes(node.type.name)) return true;
							const boundary = pos + node.nodeSize;
							const right = newState.doc.nodeAt(boundary);
							if (!right) return true;
							if (right.type.name === node.type.name) {
								boundaries.push(boundary);
							}
							return true;
						});

						if (boundaries.length === 0) return false;

						// Apply from end to start to keep positions stable
						for (let i = boundaries.length - 1; i >= 0; i--) {
							const boundary = boundaries[i];
							const $pos = tr.doc.resolve(boundary);
							const left = $pos.nodeBefore;
							const right = $pos.nodeAfter;
							if (!left || !right) continue;
							if (left.type.name !== right.type.name) continue;
							if (!LIST_NODE_NAMES.includes(left.type.name)) continue;

							// If ordered lists have differing attrs, normalize right to left attrs so join is allowed
							if (left.type.name === "orderedList") {
								const sameAttrs =
									JSON.stringify(left.attrs) === JSON.stringify(right.attrs);
								if (!sameAttrs) {
									// right node starts at `boundary`
									tr = tr.setNodeMarkup(boundary, right.type, left.attrs);
								}
							}

							// For task/bullet lists, attrs are typically identical or irrelevant for joins
							if (canJoin(tr.doc, boundary)) {
								const selectionFrom = tr.selection.from;
								const selectionTo = tr.selection.to;
								const stepsBefore = tr.steps.length;

								tr = tr.join(boundary);

								// Map the original selection through steps leading up to the join
								const mapping = tr.mapping.slice(stepsBefore);
								const mappedFrom = mapping.map(selectionFrom);
								const mappedTo = mapping.map(selectionTo);

								tr.setSelection(
									TextSelection.create(tr.doc, mappedFrom, mappedTo),
								);

								madeChange = true;
							}
						}

						return madeChange;
					};

					// Repeat until stable (at most a few passes)
					for (let pass = 0; pass < 4; pass++) {
						const changed = attemptJoinPass();
						if (!changed) break;
					}

					return madeChange ? tr : null;
				},
			}),
		];
	},
});

function isListItem(node: PMNode) {
	return node.type.name === "listItem";
}

function isTaskItem(node: PMNode) {
	return isListItem(node) && node.attrs.checked !== null;
}

function itemType(node: PMNode): "task" | "item" {
	return isTaskItem(node) ? "task" : "item";
}

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		ListToggleExtension: {
			/** Convert selected block items to taskList */
			toggleParentTaskList: (nearestShouldBeBulletList?: boolean) => ReturnType;
			toggleParentBulletList: (
				nearestShouldBeOrderedList?: boolean,
			) => ReturnType;
			toggleParentOrderedList: (
				nearestShouldBeOrderedList?: boolean,
			) => ReturnType;
		};
	}
}

function isTaskList(listNode: PMNode) {
	let allItemsAreTaskItems = true;
	listNode.forEach((node) => {
		if (isListItem(node) && !isTaskItem(node)) {
			allItemsAreTaskItems = false;
		}
	});
	return allItemsAreTaskItems;
}

function setListItemType(
	type: "task" | "item",
	tr: Transaction,
	nearestListPos: number,
): boolean {
	const $nearestListPos = tr.doc.resolve(nearestListPos);
	const nearestList = tr.doc.nodeAt(nearestListPos);
	if (!nearestList) return false;

	let hasChangedAny = false;

	tr.doc.nodesBetween(
		nearestListPos,
		nearestListPos + nearestList.nodeSize,
		(node, pos) => {
			const $pos = tr.doc.resolve(pos);
			if ($pos.depth <= $nearestListPos.depth) return true;
			hasChangedAny ||= itemType(node) !== type;
			tr.setNodeMarkup(pos, undefined, {
				checked: type === "task" ? false : null,
			});
			return false;
		},
	);
	return hasChangedAny;
}

export const listExtensions = [
	ListItemExtension,
	ListToggleExtension,
	ListAutoJoinExtension,
];
