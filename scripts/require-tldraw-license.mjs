if (!process.env.VITE_TLDRAW_LICENSE_KEY?.trim()) {
	console.error(
		"TLDRAW_LICENSE_KEY is required for desktop releases. Add it to the repository's Actions secrets.",
	);
	process.exitCode = 1;
}
