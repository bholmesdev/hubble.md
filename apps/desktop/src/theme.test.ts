// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initTheme, setThemePreference, subscribeTheme } from "./theme";

type ChangeListener = (event: { matches: boolean }) => void;

/**
 * Stubs `matchMedia` with a controllable MediaQueryList so a test can flip the
 * OS appearance via `emit()` and assert how this module reacts.
 */
function mockMatchMedia(initialMatches: boolean) {
	let matches = initialMatches;
	const listeners = new Set<ChangeListener>();
	const mql = {
		get matches() {
			return matches;
		},
		media: "(prefers-color-scheme: dark)",
		addEventListener: (_type: "change", listener: ChangeListener) => {
			listeners.add(listener);
		},
		removeEventListener: (_type: "change", listener: ChangeListener) => {
			listeners.delete(listener);
		},
	};
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => mql),
	);
	function set(next: boolean) {
		matches = next;
	}
	return {
		set,
		emit(next: boolean) {
			set(next);
			for (const listener of listeners) listener({ matches: next });
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.documentElement.classList.remove("dark");
});

describe("theme", () => {
	it("adds the dark class when the OS prefers dark", () => {
		mockMatchMedia(true);
		initTheme("system");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("reacts to the OS switching appearance at runtime", () => {
		const { emit } = mockMatchMedia(false);
		initTheme("system");
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		emit(true);
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		emit(false);
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("notifies subscribers when the resolved appearance changes", () => {
		const { emit } = mockMatchMedia(false);
		initTheme("system");
		const listener = vi.fn();
		const unsubscribe = subscribeTheme(listener);

		emit(true);
		expect(listener).toHaveBeenCalledOnce();

		unsubscribe();
		emit(false);
		expect(listener).toHaveBeenCalledOnce();
	});

	it("applies explicit light and dark preferences", () => {
		const { emit } = mockMatchMedia(true);
		initTheme("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		emit(false);
		setThemePreference("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("re-reads the OS appearance when switching back to system", () => {
		// Chromium reports the forced override until the main process drops it,
		// which happens here without any change event.
		const { set } = mockMatchMedia(true);
		initTheme("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		set(false);
		setThemePreference("system");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("drops the previous OS listener when re-initialized", () => {
		const first = mockMatchMedia(false);
		initTheme("system");
		const second = mockMatchMedia(false);
		initTheme("system");

		first.emit(true);
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		second.emit(true);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("ignores OS changes when the preference is explicit", () => {
		const { emit } = mockMatchMedia(false);
		initTheme("dark");

		emit(true);
		emit(false);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});
});
