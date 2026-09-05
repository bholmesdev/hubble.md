import { describe, expect, it } from "vitest";
import {
	emptyTabs,
	nextActiveTabId,
	type TabsState,
	tabLabels,
	withBackgroundTab,
	withClosedTab,
	withOpenedTab,
	withoutTabsMatching,
	withRewrittenTabPaths,
} from "./tabs";

/** Fixed ids keep assertions readable; only `withOpenedTab` mints real ones. */
function strip(paths: Record<string, string>, activeTabId: string | null) {
	return {
		order: Object.keys(paths),
		activeTabId,
		byId: Object.fromEntries(
			Object.entries(paths).map(([id, path]) => [id, { path }]),
		),
	} satisfies TabsState;
}

describe("opening tabs", () => {
	it("replaces what the active tab shows by default", () => {
		const before = strip({ a: "/w/one.md" }, "a");

		const after = withOpenedTab(before, "/w/two.md");

		expect(after.order).toEqual(["a"]);
		expect(after.byId.a.path).toBe("/w/two.md");
	});

	it("opens a new tab directly right of the active one", () => {
		const before = strip({ a: "/w/one.md", b: "/w/two.md" }, "a");

		const after = withOpenedTab(before, "/w/three.md", "new");

		expect(after.order).toHaveLength(3);
		expect(after.order[1]).toBe(after.activeTabId);
		expect(after.order[2]).toBe("b");
	});

	it("opens a background tab to the right without focusing it", () => {
		const before = strip({ a: "/w/one.md", b: "/w/two.md" }, "a");

		const after = withBackgroundTab(before, "/w/three.md");

		expect(after.activeTabId).toBe("a");
		expect(after.order).toHaveLength(3);
		expect(after.order[1]).not.toBe("a");
		expect(after.order[1]).not.toBe("b");
		expect(after.byId[after.order[1] ?? ""]?.path).toBe("/w/three.md");
		expect(after.order[2]).toBe("b");
	});

	it("does not duplicate a path already open as a background tab", () => {
		const before = strip({ a: "/w/one.md", b: "/w/two.md" }, "a");

		expect(withBackgroundTab(before, "/w/two.md")).toBe(before);
	});

	it("mints a tab when the strip is empty or the target has closed", () => {
		expect(withOpenedTab(emptyTabs(), "/w/one.md").order).toHaveLength(1);

		const after = withOpenedTab(
			strip({ a: "/w/one.md" }, "a"),
			"/w/two.md",
			"gone",
		);

		// A stale target falls back to the active tab rather than vanishing.
		expect(after.order).toEqual(["a"]);
		expect(after.byId.a.path).toBe("/w/two.md");
	});
});

describe("closing tabs", () => {
	const three = strip({ a: "/w/a.md", b: "/w/b.md", c: "/w/c.md" }, "b");

	it("focuses the right neighbour, falling back to the left", () => {
		expect(nextActiveTabId(three, "b")).toBe("c");
		expect(nextActiveTabId(three, "c")).toBe("b");
		expect(nextActiveTabId(strip({ b: "/w/b.md" }, "b"), "b")).toBeNull();
	});

	it("removes the tab and moves focus off it", () => {
		const after = withClosedTab(three, "b");

		expect(after.order).toEqual(["a", "c"]);
		expect(after.activeTabId).toBe("c");
		expect(after.byId).not.toHaveProperty("b");
	});

	it("leaves focus alone when a background tab closes", () => {
		expect(withClosedTab(three, "a").activeTabId).toBe("b");
	});

	it("ignores a tab that is already gone", () => {
		expect(withClosedTab(three, "missing")).toBe(three);
	});

	it("closes every tab a predicate matches, keeping focus valid", () => {
		const after = withoutTabsMatching(three, (path) => path !== "/w/a.md");

		expect(after.order).toEqual(["a"]);
		expect(after.activeTabId).toBe("a");
	});
});

describe("rewriting tab paths", () => {
	it("moves every tab through the caller's rewrite", () => {
		const before = strip({ a: "/w/old/x.md", b: "/w/keep.md" }, "a");

		const after = withRewrittenTabPaths(before, (path) =>
			path.startsWith("/w/old/") ? path.replace("/w/old/", "/w/new/") : path,
		);

		expect(after.byId.a.path).toBe("/w/new/x.md");
		expect(after.byId.b.path).toBe("/w/keep.md");
		expect(after.order).toEqual(before.order);
	});
});

describe("tab labels", () => {
	it("qualifies a name only when another open tab shares it", () => {
		expect(
			tabLabels(
				strip(
					{
						a: "/w/notes/index.md",
						b: "/w/archive/index.md",
						c: "/w/plan.md",
					},
					"a",
				),
			),
		).toEqual({ a: "notes/index", b: "archive/index", c: "plan" });
	});

	it("drops the extension, since every note carries one", () => {
		expect(tabLabels(strip({ a: "/w/plan.md" }, "a"))).toEqual({ a: "plan" });
	});
});
