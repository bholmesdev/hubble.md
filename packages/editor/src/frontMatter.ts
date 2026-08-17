import {
	isMap,
	isScalar,
	isSeq,
	parseDocument,
	type Scalar,
	stringify,
	type YAMLMap,
	type YAMLSeq,
} from "yaml";

export type FilePropertyType =
	| "text"
	| "number"
	| "checkbox"
	| "date"
	| "tags"
	| "unsupported";

export type SupportedFileProperty =
	| { key: string; type: "text"; value: string }
	| { key: string; type: "number"; value: number }
	| { key: string; type: "checkbox"; value: boolean }
	| { key: string; type: "date"; value: string }
	| { key: string; type: "tags"; value: string[] };

export type UnsupportedFileProperty = {
	key: string;
	type: "unsupported";
	raw: string;
};

export type FileProperty = SupportedFileProperty | UnsupportedFileProperty;

export type ParsedFrontMatter =
	| { type: "none"; body: string }
	| { type: "invalid"; raw: string; body: string; error: string }
	| { type: "valid"; raw: string; body: string; properties: FileProperty[] };

export const DEFAULT_TEMPLATE_PROPERTY_KEY = "default-template";

export function parseMarkdownFrontMatter(markdown: string): ParsedFrontMatter {
	const split = splitFrontMatter(markdown);
	if (!split) return { type: "none", body: markdown };

	const doc = parseDocument(split.raw, {
		schema: "core",
		uniqueKeys: true,
	});
	if (doc.errors.length > 0) {
		return {
			type: "invalid",
			raw: split.raw,
			body: split.body,
			error: doc.errors[0]?.message ?? "Invalid front matter",
		};
	}
	if (!isMap(doc.contents)) {
		return {
			type: "invalid",
			raw: split.raw,
			body: split.body,
			error: "Front matter must be a plain object",
		};
	}

	return {
		type: "valid",
		raw: split.raw,
		body: split.body,
		properties: mapToProperties(doc.contents),
	};
}

export function readDefaultTemplateDirective(
	frontMatter: ParsedFrontMatter,
): boolean | null {
	if (frontMatter.type !== "valid") return null;
	const property = frontMatter.properties.find(
		(candidate) => candidate.key === DEFAULT_TEMPLATE_PROPERTY_KEY,
	);
	if (!property || property.type !== "checkbox") return null;
	return property.value;
}

export function removeDefaultTemplateProperty(
	properties: FileProperty[],
): FileProperty[] {
	return properties.filter(
		(property) => property.key !== DEFAULT_TEMPLATE_PROPERTY_KEY,
	);
}

export type MergeTemplateFrontMatterResult =
	| { type: "valid"; frontMatter: string; properties: FileProperty[] }
	| { type: "invalid-template"; error: string }
	| { type: "invalid-target"; error: string };

export function mergeTemplateFrontMatter(
	templateMarkdown: string,
	targetMarkdown: string,
): MergeTemplateFrontMatterResult {
	const template = parseMarkdownFrontMatter(templateMarkdown);
	if (template.type === "invalid") {
		return { type: "invalid-template", error: template.error };
	}
	const target = parseMarkdownFrontMatter(targetMarkdown);
	if (target.type === "invalid") {
		return { type: "invalid-target", error: target.error };
	}
	const targetProperties = target.type === "valid" ? target.properties : [];
	const templateProperties =
		template.type === "valid"
			? removeDefaultTemplateProperty(template.properties)
			: [];
	const existingKeys = new Set(
		targetProperties.map((property) => property.key),
	);
	const missingTemplateProperties = templateProperties.filter(
		(property) => !existingKeys.has(property.key),
	);
	const properties = [...targetProperties, ...missingTemplateProperties];
	return {
		type: "valid",
		frontMatter: serializeFrontMatter(properties),
		properties,
	};
}

export function serializeFrontMatter(properties: FileProperty[]): string {
	if (properties.length === 0) return "";
	const lines: string[] = [];
	for (const property of properties) {
		if (!isSimplePropertyKey(property.key)) continue;
		if (property.type === "unsupported") {
			lines.push(property.raw.trimEnd());
			continue;
		}
		if (property.type === "text") {
			lines.push(
				`${property.key}: ${stringify(property.value, {
					defaultStringType: "QUOTE_DOUBLE",
				}).trimEnd()}`,
			);
			continue;
		}
		lines.push(stringify({ [property.key]: property.value }).trimEnd());
	}
	return lines.join("\n");
}

export function combineMarkdownFrontMatter(
	frontMatter: string,
	body: string,
): string {
	const trimmed = frontMatter.trim();
	if (trimmed.length === 0) return body;
	return `---\n${trimmed}\n---${body.startsWith("\n") ? "" : "\n"}${body}`;
}

export function setMarkdownFrontMatter(
	markdown: string,
	frontMatter: string,
): string {
	const parsed = parseMarkdownFrontMatter(markdown);
	return combineMarkdownFrontMatter(frontMatter, parsed.body);
}

export function detectFilePropertyType(value: string): FilePropertyType {
	const trimmed = value.trim();
	if (trimmed === "true" || trimmed === "false") return "checkbox";
	if (parseDateInput(trimmed)) return "date";
	if (isNumberString(trimmed)) return "number";
	return "text";
}

export function isDateString(value: string): boolean {
	return parseDateInput(value) === value;
}

// Accept explicit numeric dates only: YYYY-M-D or M-D-YYYY, with either
// dashes or slashes. Valid inputs are normalized to YYYY-MM-DD.
export function parseDateInput(value: string): string | null {
	const trimmed = value.trim();
	const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
	if (iso) return normalizedDate(iso[1], iso[2], iso[3]);
	const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
	if (us) return normalizedDate(us[3], us[1], us[2]);
	return null;
}

function normalizedDate(yearText: string, monthText: string, dayText: string) {
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(Date.UTC(year, month - 1, day));
	const valid =
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day;
	if (!valid) return null;
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isSimplePropertyKey(key: string): boolean {
	return /^[a-zA-Z0-9_-]+$/.test(key);
}

function splitFrontMatter(markdown: string) {
	const start = markdown.match(/^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/);
	if (!start) return null;
	const startLength = start[0].length;
	const rest = markdown.slice(startLength);
	const closing = rest.match(/(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/);
	if (!closing || closing.index === undefined) {
		return { raw: rest, body: "" };
	}
	const raw = rest.slice(0, closing.index);
	const closingText = closing[0];
	const bodyStart = startLength + closing.index + closingText.length;
	return { raw, body: markdown.slice(bodyStart) };
}

function mapToProperties(map: YAMLMap): FileProperty[] {
	return map.items.flatMap((item) => {
		const key = scalarValue(item.key);
		if (typeof key !== "string") return [];
		if (!isSimplePropertyKey(key)) {
			return [{ key, type: "unsupported", raw: pairToRaw(key, item.value) }];
		}
		const value = item.value;
		if (!value || (isScalar(value) && value.value == null)) {
			return [{ key, type: "text", value: "" }];
		}
		if (isScalar(value)) return scalarProperty(key, value);
		if (isSeq(value)) return seqProperty(key, value);
		return [{ key, type: "unsupported", raw: pairToRaw(key, value) }];
	});
}

function scalarProperty(key: string, scalar: Scalar): FileProperty[] {
	const value = scalar.value;
	if (typeof value === "boolean") return [{ key, type: "checkbox", value }];
	if (typeof value === "number") return [{ key, type: "number", value }];
	if (typeof value !== "string") {
		return [{ key, type: "unsupported", raw: pairToRaw(key, scalar) }];
	}
	if (isDateString(value)) return [{ key, type: "date", value }];
	return [{ key, type: "text", value }];
}

function seqProperty(key: string, seq: YAMLSeq): FileProperty[] {
	const values: string[] = [];
	for (const item of seq.items) {
		if (!isScalar(item) || typeof item.value !== "string") {
			return [{ key, type: "unsupported", raw: pairToRaw(key, seq) }];
		}
		values.push(item.value);
	}
	return [{ key, type: "tags", value: values }];
}

function scalarValue(node: unknown) {
	return isScalar(node) ? node.value : null;
}

function pairToRaw(key: string, value: unknown): string {
	return stringify({ [key]: valueToJs(value) }).trimEnd();
}

function valueToJs(value: unknown): unknown {
	if (isScalar(value)) return value.value;
	if (isSeq(value)) {
		return value.items.map(valueToJs);
	}
	if (isMap(value)) {
		return Object.fromEntries(
			value.items.map((item) => [
				String(scalarValue(item.key) ?? ""),
				valueToJs(item.value),
			]),
		);
	}
	return value;
}

function isNumberString(value: string): boolean {
	if (value.length === 0) return false;
	if (!/^-?(?:\d+|\d*\.\d+)$/.test(value)) return false;
	return Number.isFinite(Number(value));
}
