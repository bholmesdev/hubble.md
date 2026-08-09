import { Select } from "@base-ui/react/select";
import {
	detectFilePropertyType,
	type FileProperty,
	type FilePropertyType,
	isSimplePropertyKey,
	parseDateInput,
	parseMarkdownFrontMatter,
	serializeFrontMatter,
} from "@hubble.md/editor";
import { type FocusEvent, useEffect, useRef, useState } from "react";
import MingcuteAddLine from "~icons/mingcute/add-line";
import MingcuteCalendarLine from "~icons/mingcute/calendar-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteCloseLine from "~icons/mingcute/close-line";
import MingcuteDeleteLine from "~icons/mingcute/delete-line";
import MingcuteHashtagLine from "~icons/mingcute/hashtag-line";
import MingcuteListCheckLine from "~icons/mingcute/list-check-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import MingcuteTextLine from "~icons/mingcute/text-line";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";

type DraftFileProperty = FileProperty & { draftId?: string };

type FrontMatterState =
	| { type: "none"; properties: DraftFileProperty[] }
	| { type: "valid"; properties: DraftFileProperty[] }
	| { type: "invalid"; raw: string; error: string };

const typeOverrides = new Map<string, FilePropertyType>();
const ghostBoxClass =
	"border-transparent bg-transparent shadow-none inset-shadow-none";

export function frontMatterStateFromMarkdown(
	markdown: string,
): FrontMatterState {
	const parsed = parseMarkdownFrontMatter(markdown);
	if (parsed.type === "invalid") {
		return { type: "invalid", raw: parsed.raw, error: parsed.error };
	}
	if (parsed.type === "valid") {
		return { type: "valid", properties: parsed.properties.map(withDraftId) };
	}
	return { type: "none", properties: [] };
}

export function FilePropertiesPanel({
	path,
	state,
	onChange,
}: {
	path: string;
	state: FrontMatterState;
	onChange: (state: FrontMatterState, frontMatter: string) => void;
}) {
	const addButtonRef = useRef<HTMLButtonElement>(null);
	const [focusDraftId, setFocusDraftId] = useState<string | null>(null);
	const properties = state.type === "invalid" ? [] : state.properties;

	if (state.type === "invalid") {
		return <InvalidFrontMatter state={state} onChange={onChange} />;
	}

	return (
		<div className="editorPropertiesPanel">
			<div className="flex flex-col gap-1.5">
				{properties.map((property, index) => (
					<PropertyRow
						key={property.draftId ?? property.key}
						rowId={property.draftId ?? property.key}
						path={path}
						property={property}
						autoFocusName={property.draftId === focusDraftId}
						onNameAutoFocused={() => {
							if (property.draftId === focusDraftId) {
								setFocusDraftId(null);
							}
						}}
						onChange={(next) => {
							const nextProperties = properties.map((current, currentIndex) =>
								currentIndex === index ? next : current,
							);
							emitProperties(nextProperties, onChange);
						}}
						onDelete={(options) => {
							if (options?.focusAdd) {
								addButtonRef.current?.focus();
							}
							const nextProperties = properties.filter((_, i) => i !== index);
							emitProperties(nextProperties, onChange);
						}}
					/>
				))}
				<button
					ref={addButtonRef}
					type="button"
					className="grid h-7 grid-cols-[minmax(7rem,0.75fr)_2fr] items-center gap-2 text-muted-foreground text-xs transition-colors hover:text-foreground"
					onClick={() => {
						const draftId = crypto.randomUUID();
						setFocusDraftId(draftId);
						emitProperties(
							[
								...properties,
								{
									draftId,
									key: "",
									type: "text",
									value: "",
								},
							],
							onChange,
						);
					}}
				>
					<span className="flex min-w-0 items-center gap-1">
						<span className="inline-flex size-7 items-center justify-center">
							<MingcuteAddLine className="size-3.5" />
						</span>
						<span>Add property</span>
					</span>
				</button>
			</div>
		</div>
	);
}

function InvalidFrontMatter({
	state,
	onChange,
}: {
	state: Extract<FrontMatterState, { type: "invalid" }>;
	onChange: (state: FrontMatterState, frontMatter: string) => void;
}) {
	const [raw, setRaw] = useState(state.raw);
	return (
		<div className="editorPropertiesPanel border-b border-border/70">
			<div className="flex flex-col gap-2 text-[12px]">
				<p className="m-0 text-muted-foreground">Properties unavailable</p>
				<details className="rounded-sm border border-border bg-muted/30">
					<summary className="cursor-pointer px-2 py-1 text-[11px] text-muted-foreground">
						Raw front matter
					</summary>
					<textarea
						className="block min-h-28 w-full resize-y border-t border-border bg-transparent p-2 font-mono text-[11px] outline-none"
						value={raw}
						onChange={(event) => {
							const nextRaw = event.target.value;
							setRaw(nextRaw);
							onChange(
								{ type: "invalid", raw: nextRaw, error: state.error },
								nextRaw,
							);
						}}
						onBlur={() => {
							const parsed = parseMarkdownFrontMatter(`---\n${raw}\n---\n`);
							if (parsed.type === "valid") {
								onChange(
									{
										type: "valid",
										properties: parsed.properties.map(withDraftId),
									},
									serializeFrontMatter(parsed.properties),
								);
							}
						}}
					/>
				</details>
			</div>
		</div>
	);
}

function PropertyRow({
	rowId,
	path,
	property,
	autoFocusName,
	onNameAutoFocused,
	onChange,
	onDelete,
}: {
	rowId: string;
	path: string;
	property: DraftFileProperty;
	autoFocusName: boolean;
	onNameAutoFocused: () => void;
	onChange: (property: DraftFileProperty) => void;
	onDelete: (options?: { focusAdd?: boolean }) => void;
}) {
	const overrideKey = `${path}\u0000${rowId}`;
	const type = typeOverrides.get(overrideKey) ?? property.type;
	const rowRef = useRef<HTMLDivElement>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const removeEmptyIfLeavingRow = (event: FocusEvent<HTMLElement>) => {
		if (!isEmptyDraftProperty(property)) return;
		const nextFocus = event.relatedTarget;
		if (nextFocus instanceof Node && rowRef.current?.contains(nextFocus)) {
			return;
		}
		onDelete();
	};
	useEffect(() => {
		if (!autoFocusName) return;
		nameInputRef.current?.focus();
		onNameAutoFocused();
	}, [autoFocusName, onNameAutoFocused]);
	return (
		<div
			ref={rowRef}
			className="group/property grid grid-cols-[minmax(7rem,0.75fr)_2fr_auto] items-start gap-2"
		>
			<div className="flex min-w-0 items-center gap-1">
				<PropertyTypeSelect
					value={type}
					onDelete={onDelete}
					onChange={(nextType) => {
						typeOverrides.set(overrideKey, nextType);
						onChange(
							preserveDraftId(property, convertProperty(property, nextType)),
						);
					}}
				/>
				<Input
					ref={nameInputRef}
					value={property.key}
					placeholder="Property"
					variant="ghost"
					className="h-7 px-2"
					data-property-name
					aria-invalid={
						property.key.length > 0 && !isSimplePropertyKey(property.key)
					}
					onChange={(event) =>
						onChange({ ...property, key: event.target.value })
					}
					onBlur={removeEmptyIfLeavingRow}
					onKeyDown={(event) => {
						if (event.key === "Escape" && isEmptyDraftProperty(property)) {
							event.preventDefault();
							onDelete({ focusAdd: true });
						}
					}}
				/>
			</div>
			<div>
				<PropertyValue
					property={property}
					autoDetect={typeOverrides.get(overrideKey) !== "text"}
					onChange={(next) => {
						const override = typeOverrides.get(overrideKey);
						if (override === "text" && next.type === "number") {
							typeOverrides.delete(overrideKey);
						}
						if (override === "number" && next.type === "text") {
							typeOverrides.delete(overrideKey);
						}
						onChange(next);
					}}
					onRemoveEmpty={onDelete}
					onRemoveEmptyBlur={removeEmptyIfLeavingRow}
				/>
			</div>
			<button
				type="button"
				aria-label={`Delete ${property.key || "property"}`}
				title="Delete property"
				className="inline-flex size-7 items-center justify-center rounded-sm bg-muted/0 text-muted-foreground/45 opacity-0 outline-none transition-[background-color,color,opacity] duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:opacity-100 group-focus-within/property:opacity-100 group-hover/property:opacity-100"
				onClick={() => onDelete()}
			>
				<MingcuteCloseLine className="size-3.5" />
			</button>
		</div>
	);
}

function PropertyValue({
	property,
	autoDetect,
	onChange,
	onRemoveEmpty,
	onRemoveEmptyBlur,
}: {
	property: DraftFileProperty;
	autoDetect: boolean;
	onChange: (property: DraftFileProperty) => void;
	onRemoveEmpty: (options?: { focusAdd?: boolean }) => void;
	onRemoveEmptyBlur: (event: FocusEvent<HTMLElement>) => void;
}) {
	if (property.type === "unsupported") {
		return (
			<details className={cn("rounded-sm", ghostBoxClass)}>
				<summary className="cursor-pointer px-2 py-1 text-[11px] text-muted-foreground">
					Unsupported
				</summary>
				<pre className="m-0 overflow-auto border-t border-border p-2 font-mono text-[11px]">
					{property.raw}
				</pre>
			</details>
		);
	}
	if (property.type === "checkbox") {
		return (
			<label className="flex h-7 items-center text-[12px]">
				<input
					type="checkbox"
					checked={property.value}
					onChange={(event) =>
						onChange({ ...property, value: event.target.checked })
					}
				/>
			</label>
		);
	}
	if (property.type === "date") {
		return (
			<DateValue
				value={property.value}
				onChange={(value) => onChange({ ...property, value })}
			/>
		);
	}
	if (property.type === "tags") {
		return (
			<TagsValue
				values={property.value}
				onChange={(value) => onChange({ ...property, value })}
			/>
		);
	}
	return (
		<ScalarValue
			property={property}
			autoDetect={autoDetect}
			onChange={onChange}
			onRemoveEmpty={onRemoveEmpty}
			onRemoveEmptyBlur={onRemoveEmptyBlur}
		/>
	);
}

function ScalarValue({
	property,
	autoDetect,
	onChange,
	onRemoveEmpty,
	onRemoveEmptyBlur,
}: {
	property: Extract<DraftFileProperty, { type: "text" | "number" }>;
	autoDetect: boolean;
	onChange: (property: DraftFileProperty) => void;
	onRemoveEmpty: (options?: { focusAdd?: boolean }) => void;
	onRemoveEmptyBlur: (event: FocusEvent<HTMLElement>) => void;
}) {
	const [draft, setDraft] = useState(String(property.value));
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		setDraft(String(property.value));
		resizeTextarea(textareaRef.current);
	}, [property.value]);
	if (property.type === "number") {
		return (
			<Input
				type="number"
				value={draft}
				placeholder="Empty"
				variant="ghost"
				className="h-7 px-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={(event) => {
					const value = event.target.value.trim();
					if (value.length === 0 || !Number.isFinite(Number(value))) {
						onChange({
							draftId: property.draftId,
							key: property.key,
							type: "text",
							value: event.target.value,
						});
						if (property.key.trim().length === 0 && value.length === 0) {
							onRemoveEmptyBlur(event);
						}
						return;
					}
					onChange({
						draftId: property.draftId,
						key: property.key,
						type: "number",
						value: Number(value),
					});
				}}
			/>
		);
	}
	return (
		<textarea
			ref={textareaRef}
			value={draft}
			placeholder="Empty"
			className="block min-h-7 w-full resize-none overflow-hidden bg-transparent px-2 py-1 text-[11px] leading-5 outline-none placeholder:text-muted-foreground"
			rows={1}
			onChange={(event) => {
				setDraft(event.target.value);
				resizeTextarea(event.currentTarget);
			}}
			onKeyDown={(event) => {
				if (
					event.key === "Escape" &&
					property.key.trim().length === 0 &&
					draft.trim().length === 0
				) {
					event.preventDefault();
					onRemoveEmpty({ focusAdd: true });
				}
			}}
			onBlur={(event) => {
				const value = event.target.value.trim();
				if (property.key.trim().length === 0 && value.length === 0) {
					onRemoveEmptyBlur(event);
					return;
				}
				if (!autoDetect) {
					onChange({
						draftId: property.draftId,
						key: property.key,
						type: "text",
						value: event.target.value,
					});
					return;
				}
				const detected = detectFilePropertyType(value);
				if (detected === "checkbox") {
					onChange({
						draftId: property.draftId,
						key: property.key,
						type: "checkbox",
						value: value === "true",
					});
				} else if (detected === "date") {
					onChange({
						draftId: property.draftId,
						key: property.key,
						type: "date",
						value: parseDateInput(value) ?? value,
					});
				} else if (detected === "number") {
					onChange({
						draftId: property.draftId,
						key: property.key,
						type: "number",
						value: Number(value),
					});
				} else {
					onChange({
						draftId: property.draftId,
						key: property.key,
						type: "text",
						value: event.target.value,
					});
				}
			}}
		/>
	);
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
	requestAnimationFrame(() => {
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	});
}

function isEmptyDraftProperty(property: DraftFileProperty) {
	return (
		property.draftId !== undefined &&
		property.key.trim().length === 0 &&
		propertyToText(property).trim().length === 0
	);
}

function DateValue({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const [year, month, day] = value.split("-");
	const monthRef = useRef<HTMLInputElement>(null);
	const dayRef = useRef<HTMLInputElement>(null);
	const yearRef = useRef<HTMLInputElement>(null);
	const setPart = (part: "month" | "day" | "year", next: string) => {
		const clean = next.replace(/\D/g, "");
		const nextMonth = part === "month" ? clean.slice(0, 2) : month;
		const nextDay = part === "day" ? clean.slice(0, 2) : day;
		const nextYear = part === "year" ? clean.slice(0, 4) : year;
		const nextValue = `${nextYear}-${nextMonth}-${nextDay}`;
		onChange(nextValue);
		if (part === "month" && clean.length >= 2) dayRef.current?.focus();
		if (part === "day" && clean.length >= 2) yearRef.current?.focus();
	};
	return (
		<div
			className={cn(
				"flex h-7 w-fit items-center rounded-sm px-2 text-[12px]",
				ghostBoxClass,
			)}
		>
			<SegmentInput
				ref={monthRef}
				value={month ?? ""}
				onChange={(v) => setPart("month", v)}
			/>
			<span className="text-muted-foreground">/</span>
			<SegmentInput
				ref={dayRef}
				value={day ?? ""}
				onChange={(v) => setPart("day", v)}
			/>
			<span className="text-muted-foreground">/</span>
			<SegmentInput
				ref={yearRef}
				value={year ?? ""}
				className="w-10"
				onChange={(v) => setPart("year", v)}
			/>
		</div>
	);
}

function SegmentInput({
	value,
	onChange,
	className,
	ref,
	onBlur,
}: {
	value: string;
	onChange: (value: string) => void;
	className?: string;
	ref?: React.Ref<HTMLInputElement>;
	onBlur?: () => void;
}) {
	return (
		<input
			ref={ref}
			value={value}
			className={cn(
				"w-6 bg-transparent text-center outline-none focus:bg-ring/30",
				className,
			)}
			onFocus={(event) => event.currentTarget.select()}
			onClick={(event) => event.currentTarget.select()}
			onChange={(event) => onChange(event.target.value)}
			onBlur={onBlur}
		/>
	);
}

function TagsValue({
	values,
	onChange,
}: {
	values: string[];
	onChange: (values: string[]) => void;
}) {
	const [draft, setDraft] = useState("");
	const addDraft = () => {
		const next = draft
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		if (next.length === 0) return;
		onChange([...values, ...next]);
		setDraft("");
	};
	return (
		<div
			className={cn(
				"flex min-h-7 flex-wrap items-center gap-1 rounded-sm px-1.5 py-1",
				ghostBoxClass,
			)}
		>
			{values.map((value) => (
				<span
					key={value}
					className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[11px]"
				>
					{value}
					<button
						type="button"
						aria-label={`Remove ${value}`}
						onClick={() => onChange(values.filter((item) => item !== value))}
					>
						<MingcuteCloseLine className="size-3" />
					</button>
				</span>
			))}
			<input
				value={draft}
				placeholder={values.length === 0 ? "Empty" : ""}
				className="min-w-20 flex-1 bg-transparent text-[12px] outline-none"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={addDraft}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === ",") {
						event.preventDefault();
						addDraft();
					}
				}}
			/>
		</div>
	);
}

function PropertyTypeSelect({
	value,
	onChange,
	onDelete,
}: {
	value: FilePropertyType;
	onChange: (value: FilePropertyType) => void;
	onDelete: () => void;
}) {
	return (
		<Select.Root
			value={value}
			onValueChange={(next) => next && onChange(next as FilePropertyType)}
		>
			<Select.Trigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Change property type"
						title="Change property type"
					/>
				}
			>
				<TypeIcon type={value} />
			</Select.Trigger>
			<Select.Portal>
				<Select.Positioner
					align="start"
					side="bottom"
					sideOffset={4}
					className="isolate z-50"
				>
					<Select.Popup className="z-50 w-36 origin-(--transform-origin) rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground outline-hidden">
						{propertyTypes.map((type) => (
							<Select.Item
								key={type}
								value={type}
								className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 outline-hidden data-highlighted:bg-accent"
							>
								<Select.ItemIndicator className="inline-flex" keepMounted>
									<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
								</Select.ItemIndicator>
								<TypeIcon type={type} />
								<Select.ItemText>{typeLabel(type)}</Select.ItemText>
							</Select.Item>
						))}
						<div className="my-1 h-px bg-border" />
						<button
							type="button"
							className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 outline-hidden hover:bg-accent"
							onClick={onDelete}
						>
							<span className="inline-flex w-3 justify-center">
								<MingcuteDeleteLine className="size-3" />
							</span>
							Delete
						</button>
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}

const propertyTypes: FilePropertyType[] = [
	"text",
	"number",
	"checkbox",
	"date",
	"tags",
];

function TypeIcon({ type }: { type: FilePropertyType }) {
	switch (type) {
		case "number":
			return <MingcuteHashtagLine className="size-3.5" />;
		case "checkbox":
			return <MingcuteCheckLine className="size-3.5" />;
		case "date":
			return <MingcuteCalendarLine className="size-3.5" />;
		case "tags":
			return <MingcuteListCheckLine className="size-3.5" />;
		case "unsupported":
			return <MingcuteMore2Line className="size-3.5" />;
		default:
			return <MingcuteTextLine className="size-3.5" />;
	}
}

function typeLabel(type: FilePropertyType) {
	switch (type) {
		case "checkbox":
			return "Checkbox";
		case "date":
			return "Date";
		case "number":
			return "Number";
		case "tags":
			return "Tags";
		case "unsupported":
			return "Unsupported";
		default:
			return "Text";
	}
}

function convertProperty(
	property: FileProperty,
	type: FilePropertyType,
): FileProperty {
	const key = property.key;
	const text = propertyToText(property);
	switch (type) {
		case "number":
			return {
				key,
				type: "number",
				value: Number.isFinite(Number(text)) ? Number(text) : 0,
			};
		case "checkbox":
			return { key, type: "checkbox", value: text === "true" };
		case "date":
			return {
				key,
				type: "date",
				value: parseDateInput(text) ?? todayDate(),
			};
		case "tags":
			return {
				key,
				type: "tags",
				value: text
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean),
			};
		case "text":
			return { key, type: "text", value: text };
		default:
			return property;
	}
}

function propertyToText(property: FileProperty) {
	if (property.type === "unsupported") return "";
	if (property.type === "tags") return property.value.join(", ");
	return String(property.value);
}

function todayDate() {
	return new Date().toISOString().slice(0, 10);
}

function emitProperties(
	properties: DraftFileProperty[],
	onChange: (state: FrontMatterState, frontMatter: string) => void,
) {
	const nextState: FrontMatterState =
		properties.length === 0
			? { type: "none", properties }
			: { type: "valid", properties };
	onChange(nextState, serializeFrontMatter(properties));
}

function preserveDraftId<T extends FileProperty>(
	current: DraftFileProperty,
	next: T,
): T & { draftId?: string } {
	return { ...next, draftId: current.draftId };
}

function withDraftId(property: FileProperty): DraftFileProperty {
	// Property keys are editable, so they cannot be used as stable ids. The
	// draft id keeps React from remounting the row while the name is typed and
	// gives session-only type overrides a stable property identifier.
	return { ...property, draftId: crypto.randomUUID() };
}
