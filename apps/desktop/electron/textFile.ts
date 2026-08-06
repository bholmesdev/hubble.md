import fs from "node:fs/promises";

type TextEncoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

export async function readTextFile(filePath: string): Promise<string> {
	return decodeText(await fs.readFile(filePath));
}

export async function writeTextFile(
	filePath: string,
	utf8Bytes: Uint8Array,
): Promise<void> {
	let encoding: TextEncoding = "utf8";
	try {
		encoding = detectEncoding(await fs.readFile(filePath));
	} catch (error) {
		if (!isMissingFile(error)) throw error;
	}
	const content = Buffer.from(utf8Bytes).toString("utf8");
	await fs.writeFile(filePath, encodeText(content, encoding));
}

export function decodeText(bytes: Uint8Array): string {
	const encoding = detectEncoding(bytes);
	const content = Buffer.from(bytes);
	if (encoding === "utf16be") {
		return swapBytes(content.subarray(2)).toString("utf16le");
	}
	if (encoding === "utf16le") {
		return content.subarray(2).toString("utf16le");
	}
	if (encoding === "utf8-bom") {
		return content.subarray(3).toString("utf8");
	}
	return content.toString("utf8");
}

function detectEncoding(bytes: Uint8Array): TextEncoding {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf16le";
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf16be";
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
		return "utf8-bom";
	return "utf8";
}

function encodeText(content: string, encoding: TextEncoding): Buffer {
	const bytes = Buffer.from(
		content,
		encoding.startsWith("utf16") ? "utf16le" : "utf8",
	);
	if (encoding === "utf16be") {
		return Buffer.concat([Buffer.from([0xfe, 0xff]), swapBytes(bytes)]);
	}
	if (encoding === "utf16le") {
		return Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]);
	}
	if (encoding === "utf8-bom") {
		return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
	}
	return bytes;
}

function swapBytes(bytes: Uint8Array): Buffer {
	const swapped = Buffer.from(bytes);
	for (let index = 0; index + 1 < swapped.length; index += 2) {
		[swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
	}
	return swapped;
}

function isMissingFile(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
