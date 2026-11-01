import { isChangelogPath } from "./changelogNote";

const NEW_TAB_PREFIX = "hubble://new-tab/";

/** Each blank tab needs its own path, since tabs dedupe by path. */
export function newTabPath(): string {
	return `${NEW_TAB_PREFIX}${crypto.randomUUID()}`;
}

export function isNewTabPath(path: string | null | undefined): boolean {
	return path?.startsWith(NEW_TAB_PREFIX) ?? false;
}

/** Virtual tabs have no file on disk: the changelog and new tab pages. */
export function isVirtualPath(path: string | null | undefined): boolean {
	return isChangelogPath(path) || isNewTabPath(path);
}
