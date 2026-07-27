const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdown)$/i;
const HTML_EXTENSION_RE = /\.html?$/i;
const TEXT_EXTENSION_RE = /\.(txt|text)$/i;
const PDF_EXTENSION_RE = /\.pdf$/i;
const IMAGE_EXTENSION_RE = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const CODE_EXTENSION_RE =
	/\.(astro|bash|c|cc|clj|cljs|cmake|coffee|cpp|cs|css|dart|diff|env|fish|go|graphql|h|hpp|ini|java|js|jsx|json|kt|kts|less|lua|m|mdx|mjs|mts|php|pl|prisma|properties|py|r|rb|rs|sass|scala|scss|sh|sql|svelte|swift|toml|ts|tsx|vue|xml|yaml|yml|zsh)$/i;
const CODE_FILE_NAMES = new Set([
	"cmakelists.txt",
	"dockerfile",
	"gemfile",
	"justfile",
	"makefile",
	"procfile",
	"rakefile",
	".editorconfig",
	".env",
	".eslintrc",
	".gitattributes",
	".gitignore",
	".npmrc",
	".nvmrc",
	".prettierrc",
]);
const SOURCE_LANGUAGE_ALIASES: Record<string, string> = {
	bash: "bash",
	cc: "cpp",
	clj: "clojure",
	cljs: "clojure",
	env: "bash",
	h: "c",
	hpp: "cpp",
	ini: "ini",
	jsx: "jsx",
	kt: "kotlin",
	kts: "kotlin",
	m: "objectivec",
	mdx: "md",
	mjs: "js",
	mts: "ts",
	properties: "ini",
	py: "python",
	rs: "rust",
	sh: "bash",
	toml: "ini",
	tsx: "tsx",
	yml: "yaml",
	zsh: "bash",
};

export type FileKind = "document" | "viewer" | "external";

export function dirname(filePath: string): string | null {
	const forwardSlash = filePath.lastIndexOf("/");
	const backSlash = filePath.lastIndexOf("\\");
	const separatorIndex = Math.max(forwardSlash, backSlash);
	if (separatorIndex < 0) return null;
	if (separatorIndex === 0) return filePath.slice(0, 1);
	// Keep the slash: on Windows, `C:` means the drive's current folder.
	if (separatorIndex === 2 && /^[A-Za-z]:[\\/]/.test(filePath)) {
		return filePath.slice(0, 3);
	}
	return filePath.slice(0, separatorIndex);
}

/** Gets the final folder or file name from a POSIX or Windows path. */
export function basename(filePath: string): string {
	return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** Finds folder or file names shared by more than one path. */
export function duplicateBasenames(paths: string[]): Set<string> {
	const counts = new Map<string, number>();
	for (const path of paths) {
		const name = basename(path);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return new Set(
		[...counts].filter(([, count]) => count > 1).map(([name]) => name),
	);
}

export function extname(filePath: string): string {
	const name = basename(filePath);
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot) : "";
}

export function hasMarkdownExtension(path: string): boolean {
	return MARKDOWN_EXTENSION_RE.test(path);
}

export function hasHtmlExtension(path: string): boolean {
	return HTML_EXTENSION_RE.test(path);
}

export function hasTextExtension(path: string): boolean {
	return TEXT_EXTENSION_RE.test(path);
}

export function hasPdfExtension(path: string): boolean {
	return PDF_EXTENSION_RE.test(path);
}

export function hasImageExtension(path: string): boolean {
	return IMAGE_EXTENSION_RE.test(path);
}

export function isCodeFile(path: string): boolean {
	return (
		CODE_EXTENSION_RE.test(path) ||
		CODE_FILE_NAMES.has(basename(path).toLowerCase())
	);
}

export function hasDocumentExtension(path: string): boolean {
	return hasMarkdownExtension(path) || hasHtmlExtension(path);
}

export function isEditableFile(path: string): boolean {
	return (
		hasDocumentExtension(path) || hasTextExtension(path) || isCodeFile(path)
	);
}

export function supportsSourceToggle(path: string): boolean {
	// Code files (including CMakeLists.txt) already live in the source editor.
	if (isCodeFile(path)) return false;
	return hasDocumentExtension(path) || hasTextExtension(path);
}

export function fileKindForPath(path: string): FileKind {
	if (isEditableFile(path)) return "document";
	if (hasPdfExtension(path) || hasImageExtension(path)) return "viewer";
	return "external";
}

export function sourceLanguageForPath(path: string): string {
	const name = basename(path).toLowerCase();
	if (name === "dockerfile" || name === ".env") return "bash";
	if (name === "makefile" || name === "justfile") return "makefile";
	if (name === "cmakelists.txt") return "cmake";
	const extension = extname(path).slice(1).toLowerCase();
	return SOURCE_LANGUAGE_ALIASES[extension] ?? (extension || "text");
}

export function isHiddenSidebarFolderName(name: string): boolean {
	return name === ".hubble" || name.endsWith(".assets");
}

export function isVisibleSidebarFileName(name: string): boolean {
	return !name.startsWith(".");
}

export function withMarkdownExtension(path: string): string {
	return hasMarkdownExtension(path) ? path : `${path}.md`;
}

export function markdownAssetFolderPath(path: string): string | null {
	const parent = dirname(path);
	if (!parent) return null;
	const extension = extname(path);
	const stem = extension
		? basename(path).slice(0, -extension.length)
		: basename(path);
	return joinPath(parent, `${stem}.assets`);
}

export function joinPath(parent: string, name: string): string {
	const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
	return parent.endsWith("/") || parent.endsWith("\\")
		? `${parent}${name}`
		: `${parent}${separator}${name}`;
}

export function normalizePath(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const isAbsolute = normalized.startsWith("/");
	const parts: string[] = [];
	for (const part of normalized.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
			else if (!isAbsolute) parts.push(part);
			continue;
		}
		parts.push(part);
	}
	return `${isAbsolute ? "/" : ""}${parts.join("/")}`;
}

export function pathEquals(a: string, b: string): boolean {
	return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export function pathInFolder(path: string, folderPath: string): boolean {
	const prefix =
		folderPath.endsWith("/") || folderPath.endsWith("\\")
			? folderPath
			: `${folderPath}/`;
	return path.startsWith(prefix);
}

export function replacePathPrefix(
	path: string,
	fromPath: string,
	toPath: string,
) {
	if (pathEquals(path, fromPath)) return toPath;
	if (!pathInFolder(path, fromPath)) return path;
	return joinPath(
		toPath,
		path.slice(fromPath.replace(/[\\/]+$/, "").length + 1),
	);
}

export function absoluteWorkspacePath(
	relativePath: string,
	workspacePath: string,
) {
	return workspacePath.endsWith("/")
		? `${workspacePath}${relativePath}`
		: `${workspacePath}/${relativePath}`;
}

export function relativeWorkspacePath(
	path: string,
	workspacePath: string | null,
) {
	if (!workspacePath) return path;
	if (path === workspacePath) return "";
	const prefix = workspacePath.endsWith("/")
		? workspacePath
		: `${workspacePath}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
