import { describe, expect, it } from "vitest";
import {
	groupCommands,
	isCommandQuery,
	type PaletteCommand,
	rankCommands,
	scoreCommand,
	stripCommandPrefix,
} from "./paletteCommand";

function command(
	id: string,
	label: string,
	group = "App",
	keywords?: string[],
): PaletteCommand {
	return { id, label, group, keywords, run: () => {} };
}

describe("isCommandQuery / stripCommandPrefix", () => {
	it("treats a leading slash as command mode", () => {
		expect(isCommandQuery("/")).toBe(true);
		expect(isCommandQuery("/bold")).toBe(true);
		expect(isCommandQuery("bold")).toBe(false);
		expect(isCommandQuery("")).toBe(false);
	});

	it("only strips a leading prefix", () => {
		expect(stripCommandPrefix("/bold")).toBe("bold");
		// A path segment mid-query is content, not a mode switch.
		expect(stripCommandPrefix("notes/todo")).toBe("notes/todo");
	});

	it("strips only the first slash, so nested paths survive", () => {
		expect(stripCommandPrefix("/notes/todo")).toBe("notes/todo");
	});
});

describe("scoreCommand", () => {
	it("ranks a label hit above a keyword hit", () => {
		const label = command("a", "New Note");
		const keyword = command("b", "Create Folder", "File", ["new"]);
		expect(scoreCommand("new", label)).toBeGreaterThan(
			scoreCommand("new", keyword),
		);
	});

	it("ranks a keyword hit above a group-name hit", () => {
		const keyword = command("a", "Toggle Theme", "View", ["dark mode"]);
		const group = command("b", "Zoom In", "dark mode");
		expect(scoreCommand("dark mode", keyword)).toBeGreaterThan(
			scoreCommand("dark mode", group),
		);
	});

	it("finds a command through a synonym its label never uses", () => {
		const reveal = command("a", "Reveal in File Manager", "File", ["finder"]);
		expect(scoreCommand("finder", reveal)).toBeGreaterThan(0);
	});

	it("does not match a subsequence spanning two separate keywords", () => {
		// "ax" would match if keywords were joined into one searchable string.
		const spanning = command("a", "Unrelated", "App", ["alpha", "xray"]);
		expect(scoreCommand("ax", spanning)).toBe(0);
	});
});

describe("rankCommands", () => {
	const commands = [
		command("a", "Bold"),
		command("b", "Bulleted List"),
		command("c", "Zoom In"),
	];

	it("drops commands that do not match", () => {
		const ranked = rankCommands("bold", commands);
		expect(ranked.map((entry) => entry.id)).toEqual(["a"]);
	});

	it("orders an empty query purely by recency", () => {
		const ranked = rankCommands("", commands, ["c", "b"]);
		expect(ranked.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
	});

	it("never floats a recent command above a stronger text match", () => {
		// "Bold" is an exact hit; "Bulleted List" only a prefix hit, even though
		// it was used more recently.
		const ranked = rankCommands("bold", [...commands], ["b"]);
		expect(ranked[0].id).toBe("a");
	});

	it("breaks ties by recency before falling back to alphabetical", () => {
		const tied = [command("a", "Copy Path"), command("b", "Copy Path")];
		expect(rankCommands("copy path", tied, ["b"])[0].id).toBe("b");
		expect(rankCommands("copy path", tied)[0].id).toBe("a");
	});
});

describe("groupCommands", () => {
	it("orders groups by their best-scoring member, not alphabetically", () => {
		const ranked = [
			command("a", "Zoom In", "View"),
			command("b", "New Note", "File"),
			command("c", "Zoom Out", "View"),
		];
		expect(groupCommands(ranked).map((entry) => entry.group)).toEqual([
			"View",
			"File",
		]);
	});

	it("keeps every command in exactly one group", () => {
		const ranked = [
			command("a", "Bold", "Editor"),
			command("b", "New Note", "File"),
			command("c", "Italic", "Editor"),
		];
		const grouped = groupCommands(ranked);
		expect(grouped.flatMap((entry) => entry.commands.map((c) => c.id))).toEqual(
			["a", "c", "b"],
		);
	});
});
