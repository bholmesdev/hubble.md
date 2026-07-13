import { describe, expect, it } from "vitest";
import { prepareChangelogMarkdown } from "./changelogNote";

describe("prepareChangelogMarkdown", () => {
	it("drops the preamble, Unreleased, and empty subheads; keeps entries verbatim", () => {
		const raw = `# Changelog

All notable user-facing changes to Hubble.

## [Unreleased]

### Added

### Fixed

- Development-only fix.

## [0.1.19] - 2026-07-11

### Added

- Linux builds. Thanks [@ricardoraposo](https://github.com/ricardoraposo)! [#151](https://github.com/bholmesdev/hubble.md/pull/151)

### Changed

### Fixed

- Copying linked rich text. [#149](https://github.com/bholmesdev/hubble.md/issues/149)

## [0.1.18] - 2026-07-07

### Added

- Source mode.
`;

		expect(prepareChangelogMarkdown(raw)).toBe(`# What's new in Hubble

## Latest — [0.1.19] - 2026-07-11

### Added

- Linux builds. Thanks [@ricardoraposo](https://github.com/ricardoraposo)! [#151](https://github.com/bholmesdev/hubble.md/pull/151)

### Fixed

- Copying linked rich text. [#149](https://github.com/bholmesdev/hubble.md/issues/149)

---

## [0.1.18] - 2026-07-07

### Added

- Source mode.
`);
	});
});
