export const CHANGELOG_PATH = "hubble://changelog";

export function isChangelogPath(
	path: string | null | undefined,
): path is typeof CHANGELOG_PATH {
	return path === CHANGELOG_PATH;
}

export function prepareChangelogMarkdown(raw: string): string {
	const lines = raw.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
	const firstRelease = lines.findIndex((line) =>
		/^## \[\d+\.\d+\.\d+\]/.test(line),
	);
	// Unreleased is intentionally dropped so development entries never show in-app.
	const releasedLines = firstRelease === -1 ? lines : lines.slice(firstRelease);
	const content: string[] = [];
	let releaseIndex = 0;
	for (let index = 0; index < releasedLines.length; index++) {
		let line = releasedLines[index];
		if (/^## \[\d+\.\d+\.\d+\]/.test(line)) {
			if (releaseIndex === 0) {
				line = line.replace(/^## /, "## Latest — ");
			} else if (releaseIndex === 1) {
				content.push("---\n\n");
			}
			releaseIndex += 1;
		}
		if (/^### (Added|Changed|Fixed)\r?(?:\n|$)/.test(line)) {
			let next = index + 1;
			while (next < releasedLines.length && /^\s*$/.test(releasedLines[next])) {
				next += 1;
			}
			const isEmpty =
				next === releasedLines.length ||
				/^(## |### )/.test(releasedLines[next]);
			if (isEmpty) {
				// Drop the subhead with its blank lines; the next heading keeps its own.
				index = next - 1;
				continue;
			}
		}
		content.push(line);
	}

	return `# What's new in Hubble\n\n${content.join("")}`;
}
