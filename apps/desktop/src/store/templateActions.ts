import {
	combineMarkdownFrontMatter,
	DEFAULT_TEMPLATE_PROPERTY_KEY,
	type FileProperty,
	mergeTemplateFrontMatter,
	parseMarkdownFrontMatter,
	readDefaultTemplateDirective,
	serializeFrontMatter,
} from "@hubble.md/editor";
import { toast } from "sonner";
import { desktopApi } from "../desktopApi";
import {
	basename,
	joinPath,
	pathEquals,
	relativeWorkspacePath,
} from "../lib/filePath";
import {
	discoverTemplateChoices,
	owningTemplateLibraryPath,
	resolveDefaultTemplateChoice,
	type TemplateChoice,
} from "../lib/templates";
import { viewerStore, workspaceStore } from "./state";

export type TemplateEditorChoice = {
	id: string;
	title: string;
	description?: string;
	library?: string;
	path?: string;
	isDefault?: boolean;
	keywords?: string[];
};

export type TemplateApplicationContext = {
	targetPath: string;
	targetMarkdown: string;
};

export type PreparedTemplateApplication = {
	body: string;
	frontMatter: string;
	cleanupToken?: string;
};

class ShownTemplateError extends Error {
	readonly reported = true;
}

export function templateFileStem(parentPath: string) {
	return owningTemplateLibraryPath(parentPath) ? "new-template" : "new-file";
}

export async function materializeNewMarkdownFile(
	parentPath: string,
	targetPath: string,
) {
	if (owningTemplateLibraryPath(parentPath)) {
		const content = combineMarkdownFrontMatter("default-template: false", "");
		await desktopApi.writeFileText(targetPath, content);
		return { content, startsBlankTitleSession: false };
	}

	const defaultPath = await resolveDefaultTemplatePath(parentPath);
	if (!defaultPath) {
		await desktopApi.writeFileText(targetPath, "");
		return { content: "", startsBlankTitleSession: true };
	}

	const templateContent = await desktopApi.readFileText(defaultPath);
	const preparedContent = stripDefaultTemplateDirective(templateContent);
	const materialized = await desktopApi.materializeTemplate({
		sourcePath: defaultPath,
		targetPath,
		content: preparedContent,
		mode: "create",
	});
	return { content: materialized.content, startsBlankTitleSession: false };
}

export async function prepareTemplateApplication(
	choice: TemplateEditorChoice,
	context: TemplateApplicationContext,
	options?: { openTemplate?: (path: string) => void | Promise<void> },
): Promise<PreparedTemplateApplication> {
	const templatePath = choice.path;
	if (!templatePath) throw new Error("Template unavailable");
	const before = viewerStore.get();
	if (before.currentPath !== context.targetPath) {
		throw new Error("Template cancelled");
	}

	let templateContent: string;
	try {
		templateContent = await desktopApi.readFileText(templatePath);
	} catch (error) {
		toast.error("Failed to read template", { description: message(error) });
		throw new ShownTemplateError("Template unavailable");
	}

	const template = parseMarkdownFrontMatter(templateContent);
	const merged = mergeTemplateFrontMatter(
		templateContent,
		context.targetMarkdown,
	);
	if (merged.type === "invalid-template") {
		toast.error("Invalid template front matter", {
			description: merged.error,
			action: options?.openTemplate
				? {
						label: "Edit template",
						onClick: () => void options.openTemplate?.(templatePath),
					}
				: undefined,
		});
		throw new ShownTemplateError("Template properties are invalid");
	}
	if (merged.type === "invalid-target") {
		toast.error("Invalid note front matter", { description: merged.error });
		throw new ShownTemplateError("Current note properties are invalid");
	}

	let materialized: { content: string; cleanupToken?: string };
	try {
		materialized = await desktopApi.materializeTemplate({
			sourcePath: templatePath,
			targetPath: context.targetPath,
			content: template.body,
			mode: "existing",
		});
	} catch (error) {
		toast.error("Failed to apply template", { description: message(error) });
		throw new ShownTemplateError("Template unavailable");
	}

	const after = viewerStore.get();
	if (
		after.currentPath !== context.targetPath ||
		after.content !== before.content
	) {
		if (materialized.cleanupToken) {
			await rollbackTemplateMaterialization(materialized.cleanupToken);
		}
		throw new Error("Template cancelled");
	}

	return {
		body: materialized.content,
		frontMatter: merged.frontMatter,
		cleanupToken: materialized.cleanupToken,
	};
}

export async function rollbackTemplateMaterialization(token: string) {
	try {
		await desktopApi.rollbackTemplateMaterialization(token);
	} catch (error) {
		toast.error("Failed to clean up template assets", {
			description: message(error),
		});
	}
}

export async function normalizeDefaultTemplateSiblings(
	path: string,
	previousContent: string,
	nextContent: string,
) {
	if (!isValidDefaultTransition(previousContent, nextContent)) return;
	const libraryPath = owningTemplateLibraryPath(path);
	if (!libraryPath) return;
	const files = workspaceStore
		.get()
		.files.filter(
			(file) =>
				!pathEquals(file.path, path) &&
				pathEquals(owningTemplateLibraryPath(file.path) ?? "", libraryPath),
		);
	for (const file of files) {
		try {
			const content = await desktopApi.readFileText(file.path);
			const parsed = parseMarkdownFrontMatter(content);
			if (readDefaultTemplateDirective(parsed) !== true) continue;
			await desktopApi.writeFileText(
				file.path,
				withDefaultTemplateDirective(content, false),
			);
		} catch (error) {
			toast.error("Failed to update template default", {
				description: message(error),
			});
		}
	}
}

export function contentWithDefaultTemplateFalse(markdown: string) {
	return withDefaultTemplateDirective(markdown, false);
}

export function templateChoiceStubsForPath(targetPath: string) {
	return templateChoices(targetPath).map((choice) =>
		editorChoice(choice, false),
	);
}

export async function templateChoicesForPath(targetPath: string) {
	const choices = templateChoices(targetPath);
	const defaultPaths = new Set(
		(await validDefaultChoices(choices)).map((choice) => choice.path),
	);
	return choices.map((choice) =>
		editorChoice(choice, defaultPaths.has(choice.path)),
	);
}

function templateChoices(targetPath: string) {
	const { files, workspacePath } = workspaceStore.get();
	return discoverTemplateChoices({
		files,
		targetPath,
		workspacePath,
		currentPath: targetPath,
	});
}

function editorChoice(choice: TemplateChoice, isDefault: boolean) {
	const workspacePath = workspaceStore.get().workspacePath;
	const owner = choice.ownerPath
		? relativeWorkspacePath(choice.ownerPath, workspacePath) ||
			basename(choice.ownerPath)
		: undefined;
	return {
		id: choice.path,
		title: basename(choice.label),
		description: choice.libraryRelativePath,
		library: owner,
		path: choice.path,
		isDefault,
		keywords: [choice.label, choice.libraryRelativePath, owner ?? ""],
	} satisfies TemplateEditorChoice;
}

async function resolveDefaultTemplatePath(targetFolderPath: string) {
	const { files, workspacePath } = workspaceStore.get();
	if (!workspacePath) return null;
	const choices = discoverTemplateChoices({
		files,
		targetPath: joinPath(targetFolderPath, "__new__.md"),
		workspacePath,
		currentPath: null,
	});
	return (
		resolveDefaultTemplateChoice(await validDefaultChoices(choices))?.path ??
		null
	);
}

async function validDefaultChoices(choices: readonly TemplateChoice[]) {
	const defaults: TemplateChoice[] = [];
	for (const choice of choices) {
		try {
			const content = await desktopApi.readFileText(choice.path);
			const directive = readDefaultTemplateDirective(
				parseMarkdownFrontMatter(content),
			);
			if (directive === true) defaults.push(choice);
		} catch {}
	}
	return defaults;
}

function isValidDefaultTransition(
	previousContent: string,
	nextContent: string,
) {
	const previous = readDefaultTemplateDirective(
		parseMarkdownFrontMatter(previousContent),
	);
	const next = readDefaultTemplateDirective(
		parseMarkdownFrontMatter(nextContent),
	);
	return previous === false && next === true;
}

function stripDefaultTemplateDirective(markdown: string) {
	const parsed = parseMarkdownFrontMatter(markdown);
	if (parsed.type === "invalid") throw new Error(parsed.error);
	if (parsed.type === "none") return markdown;
	const properties = parsed.properties.filter(
		(property) => property.key !== DEFAULT_TEMPLATE_PROPERTY_KEY,
	);
	return combineMarkdownFrontMatter(
		serializeFrontMatter(properties),
		parsed.body,
	);
}

function withDefaultTemplateDirective(markdown: string, value: boolean) {
	const parsed = parseMarkdownFrontMatter(markdown);
	if (parsed.type === "invalid") throw new Error(parsed.error);
	const properties =
		parsed.type === "valid"
			? parsed.properties.filter(
					(property) => property.key !== DEFAULT_TEMPLATE_PROPERTY_KEY,
				)
			: [];
	const nextProperties: FileProperty[] = [
		...properties,
		{ key: DEFAULT_TEMPLATE_PROPERTY_KEY, type: "checkbox", value },
	];
	return combineMarkdownFrontMatter(
		serializeFrontMatter(nextProperties),
		parsed.body,
	);
}

function message(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
