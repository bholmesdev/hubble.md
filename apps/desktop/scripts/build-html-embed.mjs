#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);

const sourceArg = process.argv[2];
const outputArg = process.argv[3];
const callerCwd = process.env.INIT_CWD ?? process.cwd();

if (
	!sourceArg ||
	process.argv.includes("--help") ||
	process.argv.includes("-h")
) {
	console.log(`Usage: pnpm --filter @hubble.md/desktop build:html-embed <source.html> [output.html]

Builds a local HTML App or iframe Embed with Tailwind v4 utilities inlined.
Default output: <source>.dist.html`);
	process.exit(sourceArg ? 0 : 1);
}

const sourcePath = path.resolve(callerCwd, sourceArg);
const outputPath = outputArg
	? path.resolve(callerCwd, outputArg)
	: sourcePath.replace(/\.html$/i, ".dist.html");

if (sourcePath === outputPath) {
	throw new Error("Output path must differ from source path.");
}

const html = await readFile(sourcePath, "utf8");
const classNames = extractClassNames(html);
const compiler = await compile('@import "tailwindcss";', {
	base: path.dirname(sourcePath),
	loadStylesheet,
});
const css = compiler.build(classNames);
const builtHtml = injectBuiltCss(html, css, classNames.length);

await writeFile(outputPath, builtHtml);
console.log(`Built ${path.relative(process.cwd(), outputPath)}`);

function extractClassNames(html) {
	const classes = new Set();
	const attributePattern =
		/(?:class|:class|x-bind:class)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	for (const match of html.matchAll(attributePattern)) {
		const value = match[1] ?? match[2] ?? "";
		for (const token of value.matchAll(/[A-Za-z0-9_:/![\].%#()@-]+/g)) {
			const className = token[0];
			if (isTailwindCandidate(className)) classes.add(className);
		}
	}
	return [...classes].sort();
}

function isTailwindCandidate(value) {
	if (!value || value === "true" || value === "false") return false;
	if (/^\d+$/.test(value)) return false;
	return /[-:[\]/]/.test(value) || /^[mp][trblxyise]?-\d/.test(value);
}

async function loadStylesheet(id, base) {
	const filePath = stylesheetPath(id, base);
	return {
		content: await readFile(filePath, "utf8"),
		base: path.dirname(filePath),
	};
}

function stylesheetPath(id, base) {
	if (id === "tailwindcss") return require.resolve("tailwindcss/index.css");
	if (id.startsWith("tailwindcss/")) return require.resolve(id);
	return path.resolve(base, id);
}

function injectBuiltCss(html, css, classCount) {
	const withoutTailwindRuntime = html
		.replace(
			/<script\b[^>]*\bsrc=(["'])https:\/\/cdn\.tailwindcss\.com\/?\1[^>]*><\/script>\s*/gi,
			"",
		)
		.replace(
			/<script\b[^>]*\bsrc=(["'])https:\/\/unpkg\.com\/@tailwindcss\/browser[^>]*><\/script>\s*/gi,
			"",
		);
	const style = `<style data-hubble-built-tailwind="v4" data-hubble-tailwind-classes="${classCount}">
${css}
</style>`;
	if (/<\/head\s*>/i.test(withoutTailwindRuntime)) {
		return withoutTailwindRuntime.replace(
			/<\/head\s*>/i,
			`${style}\n\t</head>`,
		);
	}
	return `${style}\n${withoutTailwindRuntime}`;
}
