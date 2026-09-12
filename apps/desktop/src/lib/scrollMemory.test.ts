import { beforeEach, describe, expect, it } from "vitest";
import {
	captureScroll,
	forgetScrollPositions,
	recallScroll,
	rememberScroll,
	rewriteScrollMemory,
	setScrollContainer,
} from "./scrollMemory";

describe("scroll memory", () => {
	beforeEach(() => forgetScrollPositions());

	it("recalls a position per path", () => {
		rememberScroll("/w/a.md", 120);
		rememberScroll("/w/b.md", 40);

		expect(recallScroll("/w/a.md")).toBe(120);
		expect(recallScroll("/w/b.md")).toBe(40);
		expect(recallScroll("/w/never-opened.md")).toBeUndefined();
	});

	it("follows notes through a rename, using the caller's rule", () => {
		rememberScroll("/w/draft.md", 300);
		rememberScroll("/w/other.md", 80);

		rewriteScrollMemory((path) =>
			path === "/w/draft.md" ? "/w/final.md" : path,
		);

		expect(recallScroll("/w/final.md")).toBe(300);
		expect(recallScroll("/w/draft.md")).toBeUndefined();
		expect(recallScroll("/w/other.md")).toBe(80);
	});

	it("follows a whole folder when the caller rewrites prefixes", () => {
		rememberScroll("/w/old/a.md", 10);
		rememberScroll("/w/old/deep/b.md", 20);
		rememberScroll("/w/keep.md", 30);

		rewriteScrollMemory((path) =>
			path.startsWith("/w/old/") ? path.replace("/w/old/", "/w/new/") : path,
		);

		expect(recallScroll("/w/new/a.md")).toBe(10);
		expect(recallScroll("/w/new/deep/b.md")).toBe(20);
		expect(recallScroll("/w/keep.md")).toBe(30);
	});

	it("drops the least recently touched note past the cap", () => {
		for (let i = 0; i < 50; i++) rememberScroll(`/w/${i}.md`, i);
		// Touching the oldest entry again should save it from the next eviction.
		rememberScroll("/w/0.md", 999);
		rememberScroll("/w/overflow.md", 1);

		expect(recallScroll("/w/0.md")).toBe(999);
		expect(recallScroll("/w/1.md")).toBeUndefined();
		expect(recallScroll("/w/overflow.md")).toBe(1);
	});

	it("captures the live container position when leaving a note", () => {
		setScrollContainer({ scrollTop: 175 } as HTMLElement);

		captureScroll("/w/leaving.md");

		expect(recallScroll("/w/leaving.md")).toBe(175);
	});

	it("ignores a capture with no container or no path", () => {
		setScrollContainer(null);
		captureScroll("/w/detached.md");
		expect(recallScroll("/w/detached.md")).toBeUndefined();

		setScrollContainer({ scrollTop: 10 } as HTMLElement);
		captureScroll(null);
		expect(recallScroll("")).toBeUndefined();
	});

	it("forgets everything when the open folder changes", () => {
		rememberScroll("/w/a.md", 10);

		forgetScrollPositions();

		expect(recallScroll("/w/a.md")).toBeUndefined();
	});
});
