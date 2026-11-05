#!/usr/bin/env node
// Reads, completes, and checks Hubble diagrams (.tldr files) with the same
// tldraw version Hubble ships, so a file that passes here opens in Hubble.
//
//   node diagram.mjs summary <file>   shapes, labels, and arrows at a glance
//   node diagram.mjs fix <file>       fill defaults, bind arrows, validate, save
//   node diagram.mjs check <file>     validate and lint without writing

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// Keep in step with the tldraw version in Hubble's apps/desktop/package.json.
// A file saved by a newer tldraw schema will not open in an older Hubble.
const TLDRAW_VERSION = "5.5.2";
const FILE_FORMAT_VERSION = 1;
// tldraw's label font sizes; widths are a conservative average per character.
const LABEL_FONT_SIZE = { s: 18, m: 22, l: 26, xl: 32 };

const [command, file] = process.argv.slice(2);
if (!["summary", "fix", "check"].includes(command) || !file) {
	console.error("Usage: node diagram.mjs <summary|fix|check> <file.tldr>");
	process.exit(2);
}

const tl = loadTldraw();
const schema = tl.createTLStore({
	shapeUtils: tl.defaultShapeUtils,
	bindingUtils: tl.defaultBindingUtils,
}).schema;

if (command === "summary") summary(readFile(file));
else if (command === "fix") fix(file);
else process.exitCode = check(readFile(file)) ? 0 : 1;
// tldraw leaves timers running after import.
process.exit(process.exitCode ?? 0);

/** Installs tldraw once into a cache outside the user's project. */
function loadTldraw() {
	const cache = path.join(
		process.env.HUBBLE_SKILLS_CACHE ??
			path.join(os.homedir(), ".cache", "hubble-skills"),
		`tldraw-${TLDRAW_VERSION}`,
	);
	const require = createRequire(path.join(cache, "index.js"));
	try {
		return require("tldraw");
	} catch {
		console.error(`Installing tldraw ${TLDRAW_VERSION} into ${cache}...`);
		fs.mkdirSync(cache, { recursive: true });
		execFileSync(
			"npm",
			[
				"install",
				"--prefix",
				cache,
				"--no-audit",
				"--no-fund",
				"--loglevel=error",
				`tldraw@${TLDRAW_VERSION}`,
				"react@19",
				"react-dom@19",
			],
			{ stdio: ["ignore", "ignore", "inherit"] },
		);
		return require("tldraw");
	}
}

function readFile(filePath) {
	const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
	// Hubble opens an empty file as a new, blank diagram.
	if (text.trim() === "") return { records: [] };
	try {
		return JSON.parse(text);
	} catch (error) {
		console.error(`${filePath} is not valid JSON: ${error.message}`);
		process.exit(1);
	}
}

/** Loads records exactly as Hubble does when it opens the file. */
function load(data) {
	const json = JSON.stringify({
		tldrawFileFormatVersion:
			data.tldrawFileFormatVersion ?? FILE_FORMAT_VERSION,
		schema: data.schema ?? schema.serialize(),
		records: data.records ?? [],
	});
	const result = tl.parseTldrawJsonFile({ json, schema });
	if (result.ok) return { store: result.value };
	const cause = result.error.cause;
	return {
		error: cause?.message ?? `${result.error.type}`,
	};
}

// ---------------------------------------------------------------- summary

function summary(data) {
	const records = data.records ?? [];
	const shapes = records.filter((r) => r.typeName === "shape");
	const byId = new Map(shapes.map((s) => [s.id, s]));
	const ends = arrowEnds(records);
	for (const page of records.filter((r) => r.typeName === "page")) {
		console.log(`${page.id} "${page.name}"`);
	}
	for (const shape of shapes) {
		const p = shape.props ?? {};
		const kind =
			shape.type === "geo" ? `geo/${p.geo ?? "rectangle"}` : shape.type;
		const label = labelText(p);
		const parent = byId.has(shape.parentId) ? ` in ${shape.parentId}` : "";
		if (shape.type === "arrow") {
			const { start, end } = ends.get(shape.id) ?? {};
			console.log(
				`${shape.id} arrow ${start ?? "(unbound)"} -> ${end ?? "(unbound)"}${label ? ` "${label}"` : ""}`,
			);
			continue;
		}
		const size =
			p.w !== undefined && p.h !== undefined
				? ` ${round(p.w)}x${round(p.h)}`
				: "";
		console.log(
			`${shape.id} ${kind} at ${round(shape.x)},${round(shape.y)}${size}${parent}${label ? ` "${label}"` : ""}${p.name ? ` "${p.name}"` : ""}`,
		);
	}
	if (shapes.length === 0) console.log("(no shapes)");
}

// -------------------------------------------------------------------- fix

function fix(filePath) {
	const data = readFile(filePath);
	const records = complete(data.records ?? []);
	const loaded = load({ ...data, records });
	if (loaded.error) {
		console.error(`Not saved. tldraw rejected a record:\n  ${loaded.error}`);
		process.exit(1);
	}
	fs.writeFileSync(
		filePath,
		JSON.stringify({
			tldrawFileFormatVersion: FILE_FORMAT_VERSION,
			schema: schema.serialize(),
			records: loaded.store.allRecords(),
		}),
	);
	console.log(`Saved ${filePath}.`);
	check(readFile(filePath));
}

/**
 * Fills what an agent can leave out: base shape fields, default props, a
 * page, fractional indexes, `text` shorthand for rich text labels, and
 * arrow bindings from `props.from` / `props.to`.
 */
function complete(input) {
	const records = input.map((r) => structuredClone(r));
	const has = (typeName) => records.some((r) => r.typeName === typeName);
	if (!has("document")) {
		records.push(tl.DocumentRecordType.create({ id: tl.TLDOCUMENT_ID }));
	}
	if (!has("page")) {
		records.push(
			tl.PageRecordType.create({
				id: "page:page",
				name: "Page 1",
				index: "a1",
			}),
		);
	}
	const pageId = records.find((r) => r.typeName === "page").id;
	const shapeUtils = new Map(tl.defaultShapeUtils.map((U) => [U.type, U]));
	const bindingUtils = new Map(tl.defaultBindingUtils.map((U) => [U.type, U]));

	const shapes = records.filter((r) => r.typeName === "shape");
	const lastIndex = new Map();
	for (const shape of shapes) {
		if (!shape.index) continue;
		const parent = shape.parentId ?? pageId;
		const last = lastIndex.get(parent);
		if (!last || shape.index > last) lastIndex.set(parent, shape.index);
	}

	for (const shape of shapes) {
		const Util = shapeUtils.get(shape.type);
		if (!Util) continue;
		shape.parentId ??= pageId;
		if (!shape.index) {
			const index = tl.getIndexAbove(lastIndex.get(shape.parentId));
			shape.index = index;
			lastIndex.set(shape.parentId, index);
		}
		Object.assign(shape, {
			x: shape.x ?? 0,
			y: shape.y ?? 0,
			rotation: shape.rotation ?? 0,
			isLocked: shape.isLocked ?? false,
			opacity: shape.opacity ?? 1,
			meta: shape.meta ?? {},
		});
		const { text, from, to, ...props } = shape.props ?? {};
		if (typeof text === "string") props.richText = tl.toRichText(text);
		shape.props = { ...new Util({}).getDefaultProps(), ...props };
		if (shape.type === "arrow") bindArrow(shape, from, to, records);
	}

	for (const binding of records.filter((r) => r.typeName === "binding")) {
		binding.type ??= "arrow";
		binding.meta ??= {};
		const Util = bindingUtils.get(binding.type);
		if (Util)
			binding.props = { ...new Util({}).getDefaultProps(), ...binding.props };
	}
	return records;
}

function bindArrow(arrow, from, to, records) {
	const shapeById = new Map(
		records.filter((r) => r.typeName === "shape").map((r) => [r.id, r]),
	);
	for (const [terminal, targetId] of [
		["start", from],
		["end", to],
	]) {
		if (!targetId) continue;
		const target = shapeById.get(targetId);
		if (!target) {
			console.error(
				`${arrow.id}: ${terminal} target ${targetId} does not exist.`,
			);
			process.exit(1);
		}
		const id = `binding:${arrow.id.slice("shape:".length)}-${terminal}`;
		const existing = records.findIndex((r) => r.id === id);
		const binding = {
			id,
			typeName: "binding",
			type: "arrow",
			fromId: arrow.id,
			toId: targetId,
			meta: {},
			props: { terminal },
		};
		if (existing === -1) records.push(binding);
		else records[existing] = binding;
	}
	// The bindings decide where each end is drawn; the stored points only
	// need to be sensible, so run the arrow between the targets' centers.
	const a = shapeById.get(from);
	const b = shapeById.get(to);
	if (a && b && arrow.x === 0 && arrow.y === 0) {
		const [ax, ay] = center(a);
		const [bx, by] = center(b);
		arrow.x = ax;
		arrow.y = ay;
		arrow.props.start = { x: 0, y: 0 };
		arrow.props.end = { x: bx - ax, y: by - ay };
	}
}

// ------------------------------------------------------------------ check

/** Prints problems and returns whether the file opens cleanly. */
function check(data) {
	const loaded = load(data);
	if (loaded.error) {
		console.log(`error    Hubble cannot open this file: ${loaded.error}`);
		return false;
	}
	const records = loaded.store.allRecords();
	const problems = [...lint(records)];
	for (const { level, message } of problems)
		console.log(`${level.padEnd(9)}${message}`);
	const errors = problems.filter((p) => p.level === "error").length;
	const warnings = problems.length - errors;
	console.log(
		problems.length === 0
			? "ok       Opens in Hubble with no problems found."
			: `${errors} error(s), ${warnings} warning(s).`,
	);
	return errors === 0;
}

function* lint(records) {
	const shapes = records.filter((r) => r.typeName === "shape");
	const ids = new Set(records.map((r) => r.id));
	const ends = arrowEnds(records);

	for (const binding of records.filter((r) => r.typeName === "binding")) {
		for (const key of ["fromId", "toId"]) {
			if (!ids.has(binding[key])) {
				yield {
					level: "error",
					message: `${binding.id} points to missing ${binding[key]}.`,
				};
			}
		}
	}
	for (const shape of shapes) {
		if (!ids.has(shape.parentId)) {
			yield {
				level: "error",
				message: `${shape.id} has missing parent ${shape.parentId}.`,
			};
		}
		if (shape.type === "arrow" && !shape.meta?.decorative) {
			const { start, end } = ends.get(shape.id) ?? {};
			const loose = [!start && "start", !end && "end"].filter(Boolean);
			if (loose.length > 0) {
				yield {
					level: "error",
					message: `${shape.id} arrow has an unbound ${loose.join(" and ")}; it will not follow shapes when they move. Set props.from/props.to and run fix, or meta.decorative: true.`,
				};
			}
		}
	}

	// Boxes that partly overlap usually hide each other's labels. A box fully
	// inside another (a lane or container) is fine.
	const boxes = shapes.filter((s) => ["geo", "note", "frame"].includes(s.type));
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i];
			const b = boxes[j];
			if (a.parentId !== b.parentId) continue;
			const ra = rect(a);
			const rb = rect(b);
			if (intersects(ra, rb) && !contains(ra, rb) && !contains(rb, ra)) {
				yield {
					level: "warning",
					message: `${a.id} and ${b.id} partly overlap.`,
				};
			}
		}
	}

	for (const shape of shapes.filter((s) => s.type === "geo")) {
		const label = labelText(shape.props);
		if (label && !labelFits(label, shape.props)) {
			yield {
				level: "warning",
				message: `${shape.id} label may not fit its ${round(shape.props.w)}x${round(shape.props.h)} box; make it larger or shorten "${label.slice(0, 40)}".`,
			};
		}
	}
}

// ---------------------------------------------------------------- helpers

function arrowEnds(records) {
	const ends = new Map();
	for (const b of records.filter(
		(r) => r.typeName === "binding" && r.type === "arrow",
	)) {
		const entry = ends.get(b.fromId) ?? {};
		entry[b.props?.terminal] = b.toId;
		ends.set(b.fromId, entry);
	}
	return ends;
}

function labelText(props) {
	const doc = props?.richText;
	if (!doc?.content) return typeof props?.text === "string" ? props.text : "";
	const walk = (node) =>
		node.type === "text" ? node.text : (node.content ?? []).map(walk).join("");
	return doc.content.map(walk).join("\n").trim();
}

function labelFits(label, props) {
	const size = LABEL_FONT_SIZE[props.size] ?? 22;
	const scale = props.scale ?? 1;
	const charWidth = size * 0.55 * scale;
	const lineHeight = size * 1.35 * scale;
	const usableWidth = Math.max(props.w - 32 * scale, charWidth);
	const lines = label
		.split("\n")
		.reduce(
			(n, line) =>
				n + Math.max(1, Math.ceil((line.length * charWidth) / usableWidth)),
			0,
		);
	return lines * lineHeight + 32 * scale <= props.h + (props.growY ?? 0);
}

function rect(shape) {
	const w = shape.props.w ?? 200 * (shape.props.scale ?? 1);
	const h =
		(shape.props.h ?? 200 * (shape.props.scale ?? 1)) +
		(shape.props.growY ?? 0);
	return { x: shape.x, y: shape.y, w, h };
}

function center(shape) {
	const r = rect(shape);
	return [r.x + r.w / 2, r.y + r.h / 2];
}

function intersects(a, b) {
	return (
		a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
	);
}

function contains(outer, inner) {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.w <= outer.x + outer.w &&
		inner.y + inner.h <= outer.y + outer.h
	);
}

function round(n) {
	return Math.round(n ?? 0);
}
