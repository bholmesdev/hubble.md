import { type KeymatchOptions, keymatch, normalizedEventKey } from "keymatch";

let qwertyCommandKeys = false;

// The desktop shell supplies native layout information; browser apps use characters.
export function setQwertyCommandKeys(enabled: boolean) {
	qwertyCommandKeys = enabled;
}

function optionsForEvent(event: KeyboardEvent): KeymatchOptions {
	return {
		keyMode: qwertyCommandKeys && event.metaKey ? "physical" : "character",
	};
}

export function matchShortcut(event: KeyboardEvent, binding: string): boolean {
	return keymatch(event, binding, optionsForEvent(event));
}

export function shortcutKey(event: KeyboardEvent): string {
	return normalizedEventKey(event, optionsForEvent(event));
}
