# Contributing to Hubble

Thanks for your interest in Hubble. Contributions of any size are welcome. If you want help shaping an idea, scoping a change, or getting a PR over the finish line, open an issue and we'll work through it with you.

## TL;DR

- Open or comment on a GitHub issue before starting substantial work, so we can agree on the approach.
- Small fixes and docs updates can go straight to a PR.
- Install Node.js and pnpm, run `pnpm install`, then `pnpm dev:desktop`.
- Run `pnpm build` before opening a PR. If you changed editor behavior, also run the editor tests.
- Add a line to `CHANGELOG.md` under `[Unreleased]` for any user-facing change.

## Feature requests

We're open to feature requests of all kinds. If you have an idea for Hubble, we ask that you:

- **First open a GitHub issue** describing the problem you want to solve. If you already have a solution in mind, feel free to outline it too.
- For smaller fixes and documentation updates, you may open a PR to pair with your issue. We ask that discussion on the "why" be kept to the issue, so the PR stays focused on reviewing implementation.
- For all other fixes and feature requests, we should have consensus on an approach in an issue before a reviewable PR is opened. Draft PRs before consensus are okay.

**⚠️ We strongly discourage PRs for undiscussed feature work.** Let's talk through the UX and architecture up front so we can agree on what to build before we build it.

## Setup

### Prerequisites

Install:

- [Node.js](https://nodejs.org/en/download)
- [pnpm](https://pnpm.io/installation)
- macOS desktop builds: Xcode Command Line Tools via `xcode-select --install`

The desktop app is built with [Electron](https://www.electronjs.org/), so no extra native toolchain is required beyond the above.

### Run your first build

From the repo root:

```sh
pnpm install
pnpm bundle:desktop:mac
# or for linux:
pnpm bundle:desktop:linux
```

This creates a production desktop bundle under `apps/desktop/release/`. See [`apps/desktop/README.md`](./apps/desktop/README.md) for packaging and distribution detail.

### Development workflow

For the live desktop dev flow instead of a production bundle:

```sh
pnpm dev:desktop
```

To test the new-user welcome screen with a fresh profile and no playground, run `pnpm dev:desktop:fresh`. Each launch creates a separate profile and preserves your regular dev data.

The repo is a pnpm workspace. See the [repository structure](./README.md#repository-structure) in the README for what each app and package does, and [`CONTEXT.md`](./CONTEXT.md) for the shared glossary of project terms.

### Run the tests

The editor package uses Vitest:

```sh
pnpm --filter @hubble.md/editor test
```

## Before you open a PR

Run the full check:

```sh
pnpm build
```

This runs Biome, builds every package, and typechecks. If you changed editor behavior, also run:

```sh
pnpm --filter @hubble.md/editor test
```

## Changelog

We keep a running [`CHANGELOG.md`](./CHANGELOG.md) so release notes are written as work lands.

When working with coding agents, the `/changelog` skill adds a well-formed entry for you, and the `/done` skill records one as it wraps up a feature.

- For any user-facing change, add one bullet under `## [Unreleased]` in the matching subhead (`Added` / `Changed` / `Fixed`).
- Write it for someone reading release notes: one line, describing the effect rather than the implementation.
- Skip internal-only changes (refactors, deps, CI, tests) unless they change what users experience.

When a desktop version is cut, the `[Unreleased]` section is promoted to a version heading and attached to the GitHub Release automatically.

## PR checklist

When you open a PR, please:

- link the issue you're addressing when relevant
- explain what changed
- describe how you tested it
- add a `CHANGELOG.md` entry under `[Unreleased]` for user-facing changes

If the change affects editor behavior or rendering, tests are strongly encouraged.

## Code of Conduct

This project follows our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Reporting security issues

Please do not report security vulnerabilities through public issues. See our [security policy](./SECURITY.md) for how to report them privately.