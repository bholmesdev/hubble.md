(() => {
	const hubbleToken = window.__hubbleHtmlAppToken || window.name;
	let nextHubbleRequestId = 0;
	const pendingHubbleRequests = new Map();
	const postHubbleRequest = (id, method, params) => {
		parent.postMessage(
			{ type: "hubble:request", id, method, params, token: hubbleToken },
			"*",
		);
	};
	const requestHubble = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++nextHubbleRequestId;
			const timeout = window.setTimeout(() => {
				pendingHubbleRequests.delete(id);
				reject(new Error("Hubble request timed out"));
			}, 10000);
			pendingHubbleRequests.set(id, { resolve, reject, timeout });
			postHubbleRequest(id, method, params);
		});
	const safeRequestHubble = (method, params) =>
		requestHubble(method, params)
			.then((value) => ({ ok: true, value }))
			.catch((error) => ({
				ok: false,
				error: {
					message: error instanceof Error ? error.message : String(error),
				},
			}));

	window.addEventListener("message", (event) => {
		const data = event.data;
		if (!data || data.type !== "hubble:response") return;
		const pending = pendingHubbleRequests.get(data.id);
		if (!pending) return;
		pendingHubbleRequests.delete(data.id);
		window.clearTimeout(pending.timeout);
		if (data.ok) pending.resolve(data.value);
		else if (data.error && typeof data.error.message === "string") {
			pending.reject(new Error(data.error.message));
		} else {
			pending.reject(new Error(data.error || "Hubble request failed"));
		}
	});

	window.hubble = {
		files: {
			list: (glob = "**/*") => requestHubble("files.list", { glob }),
			safeList: (glob = "**/*") => safeRequestHubble("files.list", { glob }),
			read: (path) => requestHubble("files.read", { path }),
			safeRead: (path) => safeRequestHubble("files.read", { path }),
			open: (path) => requestHubble("files.open", { path }),
			safeOpen: (path) => safeRequestHubble("files.open", { path }),
			create: (input) => requestHubble("files.create", { input }),
			safeCreate: (input) => safeRequestHubble("files.create", { input }),
			update: (path, patch) => requestHubble("files.update", { path, patch }),
			safeUpdate: (path, patch) =>
				safeRequestHubble("files.update", { path, patch }),
			remove: (path) => requestHubble("files.remove", { path }),
			safeRemove: (path) => safeRequestHubble("files.remove", { path }),
		},
		links: {
			open: (url) => requestHubble("links.open", { url }),
			safeOpen: (url) => safeRequestHubble("links.open", { url }),
		},
	};

	document.addEventListener("click", (event) => {
		if (event.defaultPrevented) return;
		const anchor =
			event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (!anchor || !/^https?:\/\//i.test(anchor.href)) return;
		event.preventDefault();
		safeRequestHubble("links.open", { url: anchor.href });
	});

	const send = () => {
		const body = document.body;
		const bodyTop = body ? body.getBoundingClientRect().top : 0;
		const bodyPaddingBlockEnd = body
			? Number.parseFloat(getComputedStyle(body).paddingBlockEnd) || 0
			: 0;
		const height = body
			? Array.from(body.children).reduce((max, child) => {
					if (!(child instanceof HTMLElement)) return max;
					if (child.tagName === "SCRIPT" || child.tagName === "STYLE")
						return max;
					return Math.max(max, child.getBoundingClientRect().bottom - bodyTop);
				}, 0) + bodyPaddingBlockEnd
			: 0;
		parent.postMessage(
			{ type: "hubble:html-app-height", height, token: hubbleToken },
			"*",
		);
	};
	const schedule = () => requestAnimationFrame(send);
	const resizeObserver = new ResizeObserver(schedule);
	let isObservingBody = false;
	const observeBody = () => {
		if (!document.body || isObservingBody) return;
		resizeObserver.observe(document.body);
		isObservingBody = true;
	};
	window.addEventListener("load", () => {
		observeBody();
		schedule();
	});
	resizeObserver.observe(document.documentElement);
	if (document.readyState === "loading") {
		document.addEventListener(
			"DOMContentLoaded",
			() => {
				observeBody();
				schedule();
			},
			{ once: true },
		);
	} else {
		observeBody();
	}
	schedule();
})();
