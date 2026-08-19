// @vitest-environment happy-dom
// @vitest-environment-options {"url": "hubble-asset://local/%2Fvault/apps/project-dashboard/index.html", "settings": {"navigation": {"disableFallbackToSetURL": true}}}

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import runtimeGlobalSource from "../../../../packages/runtime/global.js?raw";

// The runtime package has no test setup, so desktop (which injects global.js
// into HTML App iframes) tests it here at a production-like hubble-asset://
// URL. disableFallbackToSetURL keeps happy-dom from rewriting that URL on click.

type RuntimeMessage = {
	type: string;
	method?: string;
	params?: { url?: string };
};

const brokerRequests: RuntimeMessage[] = [];

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeAll(() => {
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	vi.spyOn(window.parent, "postMessage").mockImplementation(
		(message: RuntimeMessage) => {
			if (message.type === "hubble:request") brokerRequests.push(message);
		},
	);
	new Function(runtimeGlobalSource)();
});

afterEach(() => {
	brokerRequests.length = 0;
	document.body.innerHTML = "";
});

const clickAnchor = (href: string) => {
	const anchor = document.createElement("a");
	anchor.setAttribute("href", href);
	anchor.textContent = "link";
	document.body.appendChild(anchor);
	const defaultPrevented = !anchor.dispatchEvent(
		new MouseEvent("click", { bubbles: true, cancelable: true }),
	);
	return { anchor, defaultPrevented };
};

describe("HTML app runtime anchor clicks", () => {
	it("routes absolute http(s) anchor clicks through links.open", () => {
		const { defaultPrevented } = clickAnchor("https://example.com/docs");
		expect(defaultPrevented).toBe(true);
		expect(brokerRequests).toMatchObject([
			{
				type: "hubble:request",
				method: "links.open",
				params: { url: "https://example.com/docs" },
			},
		]);
	});

	it("routes clicks on elements nested inside external anchors", () => {
		const anchor = document.createElement("a");
		anchor.setAttribute("href", "http://example.com");
		const span = document.createElement("span");
		span.textContent = "nested";
		anchor.appendChild(span);
		document.body.appendChild(anchor);
		span.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		expect(brokerRequests).toMatchObject([
			{ method: "links.open", params: { url: "http://example.com/" } },
		]);
	});

	it("leaves relative, in-page, and non-http links alone", () => {
		for (const href of ["#section", "./other.html", "javascript:void(0)"]) {
			const { defaultPrevented } = clickAnchor(href);
			expect(defaultPrevented).toBe(false);
		}
		expect(brokerRequests).toEqual([]);
	});

	it("lets app click handlers opt out with preventDefault", () => {
		const anchor = document.createElement("a");
		anchor.setAttribute("href", "https://example.com");
		document.body.appendChild(anchor);
		anchor.addEventListener("click", (event) => event.preventDefault());
		anchor.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		expect(brokerRequests).toEqual([]);
	});
});
