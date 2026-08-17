import fs from "node:fs/promises";
import path from "node:path";
import type {
	MaterializeTemplateInput,
	MaterializeTemplateOutput,
} from "../src/desktopApi/types";
import { markdownAssetFolderPath } from "../src/lib/filePath";
import { rebaseCopiedMarkdown } from "../src/lib/markdownLinkRewrite";

type AssetPlan = {
	bytes: Buffer;
	fromPath: string;
	toPath: string;
	write: boolean;
};

async function existsAsDirectory(filePath: string) {
	try {
		return (await fs.stat(filePath)).isDirectory();
	} catch {
		return false;
	}
}

async function readFileIfPresent(filePath: string) {
	try {
		return await fs.readFile(filePath);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return null;
		throw error;
	}
}

async function listFiles(root: string, current = root): Promise<string[]> {
	const entries = await fs.readdir(current, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(root, entryPath)));
		else if (entry.isFile()) files.push(entryPath);
	}
	return files;
}

function collisionPath(filePath: string, index: number) {
	const extension = path.extname(filePath);
	const stem = path.basename(filePath, extension);
	return path.join(path.dirname(filePath), `${stem}-${index}${extension}`);
}

async function destinationForAsset(candidate: string, bytes: Buffer) {
	let nextPath = candidate;
	let index = 2;
	while (true) {
		const existing = await readFileIfPresent(nextPath);
		if (!existing) return { path: nextPath, write: true };
		if (Buffer.compare(existing, bytes) === 0) {
			return { path: nextPath, write: false };
		}
		nextPath = collisionPath(candidate, index);
		index += 1;
	}
}

async function planAssets(sourcePath: string, targetPath: string) {
	const sourceAssets = markdownAssetFolderPath(sourcePath);
	const targetAssets = markdownAssetFolderPath(targetPath);
	if (
		!sourceAssets ||
		!targetAssets ||
		!(await existsAsDirectory(sourceAssets))
	) {
		return [];
	}
	const plans: AssetPlan[] = [];
	for (const fromPath of await listFiles(sourceAssets)) {
		const bytes = await fs.readFile(fromPath);
		const candidate = path.join(
			targetAssets,
			path.relative(sourceAssets, fromPath),
		);
		const destination = await destinationForAsset(candidate, bytes);
		plans.push({
			bytes,
			fromPath,
			toPath: destination.path,
			write: destination.write,
		});
	}
	return plans;
}

async function removeEmptyParents(paths: string[]) {
	const assetRoots = paths
		.map((filePath) => {
			let current = path.dirname(filePath);
			while (path.basename(current).endsWith(".assets") === false) {
				const parent = path.dirname(current);
				if (parent === current) return null;
				current = parent;
			}
			return current;
		})
		.filter((root): root is string => root !== null);
	const directories = new Set(paths.map((filePath) => path.dirname(filePath)));
	for (const directory of [...directories].sort(
		(a, b) => b.length - a.length,
	)) {
		const assetRoot = assetRoots.find(
			(root) =>
				directory === root || directory.startsWith(`${root}${path.sep}`),
		);
		if (!assetRoot) continue;
		let current = directory;
		while (true) {
			try {
				await fs.rmdir(current);
			} catch {
				break;
			}
			if (current === assetRoot) break;
			const parent = path.dirname(current);
			current = parent;
		}
	}
}

export async function rollbackMaterializedAssets(createdPaths: string[]) {
	for (const createdPath of [...createdPaths].reverse()) {
		try {
			await fs.unlink(createdPath);
		} catch (error) {
			if (
				!error ||
				typeof error !== "object" ||
				!("code" in error) ||
				error.code !== "ENOENT"
			)
				throw error;
		}
	}
	await removeEmptyParents(createdPaths);
}

/** Copies a Markdown file's associated Asset bundle and optionally creates it. */
export async function materializeTemplateBundle(
	input: MaterializeTemplateInput,
): Promise<MaterializeTemplateOutput & { createdPaths: string[] }> {
	const plans = await planAssets(input.sourcePath, input.targetPath);
	const content = rebaseCopiedMarkdown({
		content: input.content,
		fromPath: input.sourcePath,
		toPath: input.targetPath,
		copiedAssets: plans.map((plan) => ({
			fromPath: plan.fromPath,
			toPath: plan.toPath,
		})),
	});
	const createdPaths: string[] = [];
	try {
		for (const plan of plans) {
			if (!plan.write) continue;
			await fs.mkdir(path.dirname(plan.toPath), { recursive: true });
			await fs.writeFile(plan.toPath, plan.bytes, { flag: "wx" });
			createdPaths.push(plan.toPath);
		}
		if (input.mode === "create") {
			await fs.mkdir(path.dirname(input.targetPath), { recursive: true });
			await fs.writeFile(input.targetPath, content, { flag: "wx" });
		}
		return { content, createdPaths };
	} catch (error) {
		await rollbackMaterializedAssets(createdPaths);
		throw error;
	}
}
