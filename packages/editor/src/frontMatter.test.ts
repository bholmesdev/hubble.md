import { describe, expect, it } from "vitest";
import {
	combineMarkdownFrontMatter,
	detectFilePropertyType,
	mergeTemplateFrontMatter,
	parseDateInput,
	parseMarkdownFrontMatter,
	readDefaultTemplateDirective,
	removeDefaultTemplateProperty,
	serializeFrontMatter,
} from "./frontMatter.js";

describe("front matter", () => {
	it("splits valid front matter from the markdown body", () => {
		const parsed = parseMarkdownFrontMatter(`---
title: Hello
published: false
count: 3
date: 2026-06-03
tags:
  - work
  - draft
---
# Body`);

		expect(parsed).toMatchObject({
			type: "valid",
			body: "# Body",
			properties: [
				{ key: "title", type: "text", value: "Hello" },
				{ key: "published", type: "checkbox", value: false },
				{ key: "count", type: "number", value: 3 },
				{ key: "date", type: "date", value: "2026-06-03" },
				{ key: "tags", type: "tags", value: ["work", "draft"] },
			],
		});
	});

	it("uses YAML 1.2 scalar behavior", () => {
		const parsed = parseMarkdownFrontMatter(`---
yes_value: yes
no_value: no
on_value: on
off_value: off
true_value: true
---
Body`);

		expect(parsed.type).toBe("valid");
		if (parsed.type !== "valid") return;
		expect(parsed.properties).toEqual([
			{ key: "yes_value", type: "text", value: "yes" },
			{ key: "no_value", type: "text", value: "no" },
			{ key: "on_value", type: "text", value: "on" },
			{ key: "off_value", type: "text", value: "off" },
			{ key: "true_value", type: "checkbox", value: true },
		]);
	});

	it("preserves invalid front matter and keeps body editable", () => {
		const parsed = parseMarkdownFrontMatter(`---
title: Test
broken: [one, two
---
# Body`);

		expect(parsed.type).toBe("invalid");
		if (parsed.type !== "invalid") return;
		expect(parsed.raw).toContain("broken");
		expect(parsed.body).toBe("# Body");
	});

	it("marks unsupported properties without hiding supported properties", () => {
		const parsed = parseMarkdownFrontMatter(`---
title: Visible
nested:
  child: value
flags:
  - true
  - false
published: true
---
Body`);

		expect(parsed.type).toBe("valid");
		if (parsed.type !== "valid") return;
		expect(parsed.properties).toEqual([
			{ key: "title", type: "text", value: "Visible" },
			{
				key: "nested",
				type: "unsupported",
				raw: "nested:\n  child: value",
			},
			{ key: "flags", type: "unsupported", raw: "flags:\n  - true\n  - false" },
			{ key: "published", type: "checkbox", value: true },
		]);
	});

	it("serializes supported properties as normalized YAML", () => {
		const yaml = serializeFrontMatter([
			{ key: "description", type: "text", value: 'Long text with "quotes"' },
			{ key: "title", type: "text", value: "true" },
			{ key: "date_text", type: "text", value: "2026-06-03" },
			{ key: "count", type: "number", value: 3 },
			{ key: "published", type: "checkbox", value: false },
			{ key: "date", type: "date", value: "2026-06-03" },
			{ key: "tags", type: "tags", value: ["work", "draft"] },
		]);

		expect(yaml).toBe(`description: "Long text with \\"quotes\\""
title: "true"
date_text: "2026-06-03"
count: 3
published: false
date: 2026-06-03
tags:
  - work
  - draft`);
	});

	it("recombines front matter with a markdown body", () => {
		expect(combineMarkdownFrontMatter("title: Test", "# Body")).toBe(`---
title: Test
---
# Body`);
	});

	it("detects types only for complete stable values", () => {
		expect(detectFilePropertyType("2026-06-03")).toBe("date");
		expect(detectFilePropertyType("04/06/2025")).toBe("date");
		expect(detectFilePropertyType("2026-06-0")).toBe("text");
		expect(detectFilePropertyType("false")).toBe("checkbox");
		expect(detectFilePropertyType("123")).toBe("number");
		expect(detectFilePropertyType("yes")).toBe("text");
	});

	it("normalizes supported date input shapes", () => {
		expect(parseDateInput("2026-6-3")).toBe("2026-06-03");
		expect(parseDateInput("2026/06/03")).toBe("2026-06-03");
		expect(parseDateInput("04/06/2025")).toBe("2025-04-06");
		expect(parseDateInput("04-06-2025")).toBe("2025-04-06");
		expect(parseDateInput("13/40/2025")).toBeNull();
	});

	it("reads only boolean default-template directives", () => {
		expect(
			readDefaultTemplateDirective(
				parseMarkdownFrontMatter(`---
default-template: true
---
Body`),
			),
		).toBe(true);
		expect(
			readDefaultTemplateDirective(
				parseMarkdownFrontMatter(`---
default-template: false
---
Body`),
			),
		).toBe(false);
		expect(
			readDefaultTemplateDirective(
				parseMarkdownFrontMatter(`---
default-template: "true"
---
Body`),
			),
		).toBeNull();
	});

	it("removes default-template before applying template properties", () => {
		const parsed = parseMarkdownFrontMatter(`---
title: Template
default-template: true
---
Body`);
		expect(parsed.type).toBe("valid");
		if (parsed.type !== "valid") return;

		expect(removeDefaultTemplateProperty(parsed.properties)).toEqual([
			{ key: "title", type: "text", value: "Template" },
		]);
	});

	it("merges template properties target-first and case-sensitively", () => {
		const result = mergeTemplateFrontMatter(
			`---
title: Template
Title: Kept separately
tags:
  - template
nested:
  child: value
default-template: true
---
Template body`,
			`---
title: Target
tags:
  - target
---
Target body`,
		);

		expect(result.type).toBe("valid");
		if (result.type !== "valid") return;
		expect(result.properties).toEqual([
			{ key: "title", type: "text", value: "Target" },
			{ key: "tags", type: "tags", value: ["target"] },
			{ key: "Title", type: "text", value: "Kept separately" },
			{
				key: "nested",
				type: "unsupported",
				raw: "nested:\n  child: value",
			},
		]);
		expect(result.frontMatter).toBe(`title: "Target"
tags:
  - target
Title: "Kept separately"
nested:
  child: value`);
	});

	it("reports invalid template or target front matter without merging", () => {
		expect(
			mergeTemplateFrontMatter("---\nbroken: [one\n---\nBody", "Target"),
		).toMatchObject({ type: "invalid-template" });
		expect(
			mergeTemplateFrontMatter("Template", "---\nbroken: [one\n---\nBody"),
		).toMatchObject({ type: "invalid-target" });
	});
});
