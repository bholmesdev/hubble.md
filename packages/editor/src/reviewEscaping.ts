/**
 * Review text survives two layers: remark's CommonMark escaping, then Hubble's
 * own. A comment body is opaque, so it escapes everything. A span's own content
 * must keep its Markdown live, so it only encodes CriticMarkup delimiters.
 */

// Each delimiter paired with the form written into the document, which hides it
// from the CriticMarkup parser until the span around it is recognized.
const DELIMITERS = [
	["{++", "{\\u002b+"],
	["++}", "++\\u007d"],
	["{--", "{\\u002d-"],
	["--}", "--\\u007d"],
	["{~~", "{\\u007e~"],
	["~>", "~\\u003e"],
	["~~}", "~\\u007e}"],
	["{==", "{\\u003d="],
	["==}", "==\\u007d"],
	["{>>", "{\\u003e>"],
	["<<}", "<<\\u007d"],
	["{#", "{\\u0023"],
] as const;

const MARKDOWN_PUNCTUATION = new Set([
	"*",
	"_",
	"`",
	"[",
	"]",
	"<",
	">",
	"&",
	"~",
]);

/** Escapes a comment body, which remark must read as literal text. */
export function escapeReviewBody(body: unknown): string {
	const value = typeof body === "string" ? body : "";
	let escaped = "";

	for (let index = 0; index < value.length; ) {
		const delimiter = DELIMITERS.find(([raw]) => value.startsWith(raw, index));
		if (delimiter) {
			escaped += `\\\\${delimiter[0]}`;
			index += delimiter[0].length;
			continue;
		}

		const character = value[index] ?? "";
		if (character === "\\") {
			escaped += "\\\\\\\\";
		} else if (character === "\n") {
			escaped += "\\\\n";
		} else if (MARKDOWN_PUNCTUATION.has(character)) {
			escaped += `\\${character}`;
		} else {
			escaped += character;
		}
		index += 1;
	}

	return escaped;
}

/** Escapes a span's own content, where Markdown formatting stays live. */
export function escapeReviewContent(content: unknown): string {
	const value = typeof content === "string" ? content : "";
	let escaped = "";

	for (let index = 0; index < value.length; ) {
		const delimiter = DELIMITERS.find(([raw]) => value.startsWith(raw, index));
		if (delimiter) {
			// The table holds the post-remark form, so double the slash on the way out.
			escaped += delimiter[1].replace("\\", "\\\\");
			index += delimiter[0].length;
			continue;
		}

		escaped += value[index] === "\\" ? "\\\\\\\\" : value[index];
		index += 1;
	}

	return escaped;
}

/** Inverse of both escapes, applied after remark has consumed its own layer. */
export function unescapeReviewText(text: string): string {
	let unescaped = "";

	for (let index = 0; index < text.length; ) {
		const encoded = DELIMITERS.find(([, form]) => text.startsWith(form, index));
		if (encoded) {
			unescaped += encoded[0];
			index += encoded[1].length;
			continue;
		}

		if (text.startsWith("\\\\", index)) {
			unescaped += "\\";
			index += 2;
			continue;
		}

		if (text[index] === "\\") {
			const delimiter = DELIMITERS.find(([raw]) =>
				text.startsWith(raw, index + 1),
			);
			if (delimiter) {
				unescaped += delimiter[0];
				index += delimiter[0].length + 1;
				continue;
			}

			const escaped = text[index + 1];
			if (escaped === "n") {
				unescaped += "\n";
				index += 2;
				continue;
			}
			if (escaped && MARKDOWN_PUNCTUATION.has(escaped)) {
				unescaped += escaped;
				index += 2;
				continue;
			}
		}

		unescaped += text[index];
		index += 1;
	}

	return unescaped;
}
