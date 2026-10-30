import { describe, expect, it } from "vitest";
import { groupInboxItems, inboxGroupLabel } from "./inboxGroups";

const now = new Date(2026, 9, 11, 15, 0).getTime();
const at = (month: number, day: number, year = 2026) =>
	new Date(year, month, day, 9, 0).getTime();

describe("inboxGroupLabel", () => {
	it("buckets recent days, then months this year, then years", () => {
		expect(inboxGroupLabel(at(9, 11), now)).toBe("Today");
		expect(inboxGroupLabel(at(9, 10), now)).toBe("Yesterday");
		expect(inboxGroupLabel(at(9, 5), now)).toBe("Previous 7 Days");
		expect(inboxGroupLabel(at(8, 20), now)).toBe("Previous 30 Days");
		expect(inboxGroupLabel(at(7, 1), now)).toBe(
			new Date(at(7, 1)).toLocaleDateString(undefined, { month: "long" }),
		);
		expect(inboxGroupLabel(at(11, 1, 2025), now)).toBe("2025");
	});
});

describe("groupInboxItems", () => {
	it("keeps newest-first order within consecutive groups", () => {
		const groups = groupInboxItems(
			[at(9, 11), at(9, 11), at(9, 10), at(1, 1, 2024)],
			(time) => time,
			now,
		);
		expect(groups.map((group) => [group.label, group.items.length])).toEqual([
			["Today", 2],
			["Yesterday", 1],
			["2024", 1],
		]);
	});
});
