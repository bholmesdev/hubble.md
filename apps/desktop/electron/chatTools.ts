import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { NamespaceTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { isEditableFile } from "../src/lib/filePath";
import { listSidebarFiles, matchesGlob } from "./workspaceSidebar";

export type OpenFile = { text: string; diskContent: string };
export type FileBridge = {
	read(path: string): Promise<OpenFile | null>;
	write(path: string, before: string, after: string): Promise<boolean>;
};
const scope = {
	path: z.string().max(4096).optional(),
	glob: z.string().max(200).optional(),
};
const schemas = {
	list_files: z.object(scope),
	search_content: z.object({ ...scope, query: z.string().min(1).max(300) }),
	read_file: z.object({
		path: z.string(),
		start_line: z.number().int().min(1).optional(),
		end_line: z.number().int().min(1).optional(),
	}),
	apply_patch: z.object({
		patch: z.string().max(32_000),
		expected_version: z.string().min(1),
	}),
};
const descriptions = {
	list_files:
		"List workspace-relative file paths, filtered by path (folder) and glob. Respects sidebar ignore rules. Returns at most 100 paths.",
	search_content:
		"Search literal text, case-insensitively, in workspace text files. Optional path and glob filters. Returns at most 100 matching lines with line numbers.",
	read_file:
		"Read a workspace-relative text file, including unsaved editor text. Returns numbered range metadata and a full-file version. Default 200 lines; at most 12000 characters. Read before editing.",
	apply_patch:
		"Update one existing text file using Codex format: *** Begin Patch, *** Update File: relative/path, @@, context lines prefixed with space, removals with -, additions with +, *** End Patch. Supply expected_version from read_file. Context must match uniquely. No create, delete, or move operations.",
};
export const workspaceTool: NamespaceTool = {
	type: "namespace",
	name: "workspace",
	description:
		"Read and edit text files inside the current Hubble workspace only.",
	tools: Object.entries(schemas).map(([name, schema]) => ({
		type: "function",
		name,
		description: descriptions[name as keyof typeof descriptions],
		parameters: z.toJSONSchema(schema),
		strict: false,
	})),
};
const MAX_FILE_BYTES = 256_000;
const versionOf = (text: string) =>
	createHash("sha256").update(text).digest("hex");

/** Each request owns a workspace, read versions, and cancellation signal. */
export class WorkspaceTools {
	private realRoot?: string;
	private reads = new Map<
		string,
		{ text: string; diskContent: string; version: string }
	>();
	constructor(
		private root: string,
		private bridge: FileBridge,
		private signal: AbortSignal,
	) {}

	async run(name: string, args: unknown): Promise<Record<string, unknown>> {
		this.signal.throwIfAborted();
		switch (name) {
			case "list_files": {
				const input = schemas.list_files.parse(args);
				const files = await this.files(input);
				return { files: files.slice(0, 100), truncated: files.length > 100 };
			}
			case "search_content": {
				const input = schemas.search_content.parse(args);
				const files = await this.files(input);
				const matches: { path: string; line: number; text: string }[] = [];
				let skipped = 0;
				let scanned = 0;
				const query = input.query.toLowerCase();
				for (const file of files) {
					if (!isEditableFile(file)) continue;
					if (scanned++ === 500) return { matches, truncated: true, skipped };
					this.signal.throwIfAborted();
					let text: string;
					try {
						text = (await this.read(file)).text;
					} catch (error) {
						this.signal.throwIfAborted();
						if (error instanceof Error) {
							skipped++;
							continue;
						}
						throw error;
					}
					const lines = text.split(/\r?\n/);
					for (let index = 0; index < lines.length; index++) {
						if (!lines[index].toLowerCase().includes(query)) continue;
						if (matches.length === 100)
							return { matches, truncated: true, skipped };
						matches.push({
							path: file,
							line: index + 1,
							text: lines[index].slice(
								Math.max(0, lines[index].toLowerCase().indexOf(query) - 80),
								Math.max(0, lines[index].toLowerCase().indexOf(query) - 80) +
									300,
							),
						});
					}
				}
				return { matches, truncated: false, skipped };
			}
			case "read_file": {
				const input = schemas.read_file.parse(args);
				const read = await this.read(input.path);
				const lines = read.text.split(/\r?\n/);
				const start = input.start_line ?? 1;
				const end = Math.min(
					input.end_line ?? start + 199,
					start + 199,
					lines.length,
				);
				if (end < start)
					throw new Error("Requested line range is outside the file.");
				const text = lines.slice(start - 1, end).join("\n");
				return {
					path: input.path,
					version: read.version,
					start_line: start,
					end_line: end,
					total_lines: lines.length,
					text: text.slice(0, 12_000),
					truncated: end < lines.length || text.length > 12_000,
				};
			}
			case "apply_patch": {
				const input = schemas.apply_patch.parse(args);
				const file = patchPath(input.patch);
				const resolved = await this.resolve(file);
				if ((await fs.stat(resolved.real)).nlink !== 1)
					throw new Error("Editing hard-linked files is unsupported.");
				const previous = this.reads.get(file);
				const current = await this.read(file);
				if (
					!previous ||
					previous.version !== input.expected_version ||
					current.version !== previous.version ||
					current.diskContent !== previous.diskContent
				)
					throw new Error(
						"File changed or version is unknown. Read the file again before editing.",
					);
				const after = applyPatch(current.text, input.patch);
				if (Buffer.byteLength(after) > MAX_FILE_BYTES)
					throw new Error("Edited file exceeds the text size limit.");
				this.signal.throwIfAborted();
				if (
					!(await this.bridge.write(resolved.absolute, current.text, after))
				) {
					// Open the checked file itself; never follow a final symlink or truncate before comparing.
					const handle = await fs.open(
						resolved.real,
						constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
					);
					try {
						const stat = await handle.stat();
						if (stat.nlink !== 1)
							throw new Error("Editing hard-linked files is unsupported.");
						const disk = await handle.readFile("utf8");
						const checked = await this.resolve(file);
						const currentStat = await fs.stat(checked.real);
						this.signal.throwIfAborted();
						if (
							checked.real !== resolved.real ||
							currentStat.ino !== stat.ino ||
							currentStat.dev !== stat.dev ||
							disk !== current.text
						)
							throw new Error("File changed. Read it again before editing.");
						const bytes = Buffer.from(after);
						let offset = 0;
						while (offset < bytes.length) {
							const written = await handle.write(
								bytes,
								offset,
								bytes.length - offset,
								offset,
							);
							if (!written.bytesWritten)
								throw new Error("File write did not complete.");
							offset += written.bytesWritten;
						}
						await handle.truncate(Buffer.byteLength(after));
					} finally {
						await handle.close();
					}
				}
				this.reads.delete(file);
				return { path: file, status: "applied", version: versionOf(after) };
			}
			default:
				throw new Error(`Unknown workspace tool: ${name}`);
		}
	}

	private async resolve(relative: string) {
		this.signal.throwIfAborted();
		if (
			path.isAbsolute(relative) ||
			path.win32.isAbsolute(relative) ||
			relative.includes("\\") ||
			relative.split("/").includes("..")
		)
			throw new Error("Use a relative path inside the workspace.");
		const root = await fs.realpath(this.root);
		if (this.realRoot && root !== this.realRoot)
			throw new Error("Workspace changed.");
		this.realRoot = root;
		const absolute = path.resolve(this.root, relative);
		const real = await fs.realpath(absolute);
		const within = path.relative(root, real);
		if (
			within === ".." ||
			within.startsWith(`..${path.sep}`) ||
			path.isAbsolute(within)
		)
			throw new Error("Path leaves the workspace.");
		this.signal.throwIfAborted();
		return { absolute, real };
	}

	private async read(file: string) {
		const { absolute, real } = await this.resolve(file);
		if (!isEditableFile(file))
			throw new Error("Only text files are supported.");
		const stat = await fs.stat(real);
		if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
			throw new Error("Text file is unavailable or exceeds 256 KB.");
		const open = await this.bridge.read(absolute);
		const disk = await fs.readFile(real, "utf8");
		const text = open?.text ?? disk;
		if (text.includes("\0") || Buffer.byteLength(text) > MAX_FILE_BYTES)
			throw new Error("Only bounded text files are supported.");
		// A dirty editor must not hide a concurrent change on disk.
		if (open && open.diskContent !== disk)
			throw new Error(
				"File has an external change. Resolve it in the editor first.",
			);
		const read = { text, diskContent: disk, version: versionOf(text) };
		this.reads.set(file, read);
		return read;
	}

	private async files(input: { path?: string; glob?: string }) {
		const folder = input.path ?? ".";
		await this.resolve(folder);
		const listing = await listSidebarFiles(this.root);
		this.signal.throwIfAborted();
		return listing.files
			.map((file) =>
				path.relative(this.root, file.path).split(path.sep).join("/"),
			)
			.filter(
				(file) =>
					(folder === "." ||
						file.startsWith(`${folder.replace(/\/$/, "")}/`)) &&
					matchesGlob(file, input.glob ?? "**/*"),
			)
			.sort();
	}
}

function patchPath(patch: string) {
	const lines = patch.replace(/\r\n/g, "\n").trimEnd().split("\n");
	if (
		lines[0] !== "*** Begin Patch" ||
		lines[lines.length - 1] !== "*** End Patch" ||
		!lines[1]?.startsWith("*** Update File: ") ||
		lines.slice(2, -1).some((line) => line.startsWith("*** "))
	)
		throw new Error(
			"Use one Update File patch; create, delete, and move are unsupported.",
		);
	return lines[1].slice("*** Update File: ".length);
}

/** Reject fuzzy or ambiguous context rather than guessing where to edit a note. */
function applyPatch(text: string, patch: string) {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const source = text.split(/\r?\n/);
	const lines = patch.replace(/\r\n/g, "\n").trimEnd().split("\n").slice(2, -1);
	let cursor = 0;
	let index = 0;
	while (index < lines.length) {
		if (!lines[index].startsWith("@@"))
			throw new Error("Expected @@ before patch context.");
		index++;
		const before: string[] = [],
			after: string[] = [];
		while (index < lines.length && !lines[index].startsWith("@@")) {
			const line = lines[index++];
			if (line.startsWith(" ")) {
				before.push(line.slice(1));
				after.push(line.slice(1));
			} else if (line.startsWith("-")) before.push(line.slice(1));
			else if (line.startsWith("+")) after.push(line.slice(1));
			else throw new Error("Patch lines must start with space, +, or -.");
		}
		if (!before.length)
			throw new Error("Include existing context for every patch hunk.");
		const positions: number[] = [];
		for (let at = cursor; at <= source.length - before.length; at++)
			if (before.every((line, offset) => source[at + offset] === line))
				positions.push(at);
		if (positions.length !== 1)
			throw new Error(
				positions.length
					? "Patch context is ambiguous. Include more context."
					: "Patch context does not match. Read the file again.",
			);
		source.splice(positions[0], before.length, ...after);
		cursor = positions[0] + after.length;
	}
	return source.join(newline);
}
