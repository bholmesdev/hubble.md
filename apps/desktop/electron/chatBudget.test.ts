import { expect, it } from "vitest";
import { withinChatTokenBudget } from "./chatBudget";

it("counts a large valid input without blocking the event loop", async () => {
	let finished = false;
	const result = withinChatTokenBudget([
		{ role: "user", content: "a".repeat(1_500_000) },
	]).then((fits) => {
		finished = true;
		return fits;
	});
	await new Promise((resolve) => setImmediate(resolve));
	expect(finished).toBe(false);
	expect(await result).toBe(true);
}, 10_000);

it("rejects input over the token budget and treats special-token text as document data", async () => {
	expect(
		await withinChatTokenBudget([
			{ role: "user", content: " word".repeat(210_000) },
		]),
	).toBe(false);
	expect(
		await withinChatTokenBudget([
			{ role: "user", content: "<|endoftext|><|im_start|>" },
		]),
	).toBe(true);
});
