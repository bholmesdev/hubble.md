# Hubble.md

**The best notepad for you and your agents.** Free, open source, backed by Markdown and HTML.

<p align="center">
  <a href="https://github.com/bholmesdev/hubble.md/releases/latest">Download</a>
  ·
  <a href="https://github.com/bholmesdev/hubble.md/releases">Releases</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
  ·
  <a href="https://twitter.com/bholmesdev">@bholmesdev</a>
</p>

## What is Hubble?

Hubble is a free, open-source notetaking app for you and your agents.

- **Feels familiar.** The same writing experience you're used to from Notion or Apple Notes, but for Markdown. `/` commands, Markdown shortcuts, and file properties / frontmatter are supported.
- **Agent ready.** Point your agent at your notes folder to start collaborating. Hubble will live-reloads as your agent edits.
- **Build any view.** Beyond Markdown, you can build and view HTML-based apps. [Install the skills](https://github.com/bholmesdev/hubble-skills) and tell your coding agent what to build. Turn a folder of notes into a table, a bookshelf, a map... anything you can think of.

## Download

Hubble ships as a desktop app. Install the latest build from the [releases page](https://github.com/bholmesdev/hubble.md/releases/latest).

macOS, Windows, and Linux are supported. macOS builds are signed and notarized; Windows and Linux builds are unsigned, so your OS may warn before the first launch.

## Compile from source

Want to build Hubble directly? First, install the prerequisites:

- [Node.js](https://nodejs.org/en/download)
- [pnpm](https://pnpm.io/installation)
- macOS desktop builds: Xcode Command Line Tools via `xcode-select --install`

Then from the repo root:

```sh
pnpm install
pnpm bundle:desktop:mac
# or for windows:
pnpm bundle:desktop:win
# or for linux:
pnpm bundle:desktop:linux
```

This creates a production desktop bundle under `apps/desktop/release/`. For the live dev flow and packaging detail, see [`apps/desktop/README.md`](./apps/desktop/README.md).

## Repository structure

This repo is a pnpm workspace:

```text
.
├── apps
│   ├── desktop  # Electron desktop app (the main Hubble app)
│   ├── web      # Astro landing page (hubble.md homepage)
│   └── www      # React + Convex web app (Hubble in the browser. HEAVILY WIP)
└── packages
    ├── editor         # Framework-agnostic Markdown editor core (Tiptap + Markdown conversion)
    ├── ui             # Shared React editor UI built on the editor core
    ├── runtime        # Runtime injected into HTML Apps and Embeds
    ├── sync           # Filesystem sync engine (HEAVILY WIP)
    ├── convex-client  # Convex client used by the sync engine
    ├── sync-backend   # Convex backend powering Cloud Sync
    └── cli            # `hubble` CLI for syncing a folder from the terminal
```

## Common commands

From the repo root:

```sh
pnpm install          # install dependencies
pnpm dev:desktop      # run the desktop app in dev
pnpm dev:www          # run the web app in dev
pnpm build            # check, build all packages, and typecheck
pnpm bundle:desktop:mac   # build a production desktop bundle for macOS
pnpm check            # run Biome
pnpm typecheck        # typecheck all packages
```

## Documentation

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) covers the contribution flow, local setup, and pre-PR checks.
- [`CONTEXT.md`](./CONTEXT.md) is the shared glossary for project terms (Workspace, HTML App, Embed, and more).
- [`apps/desktop/README.md`](./apps/desktop/README.md) covers desktop build, dev, and packaging.

## Powered by Warp

Hubble's repository automation runs on [Warp Factory agents](https://www.warp.dev/oz). When you open an issue or a pull request, an agent handles it:

- **Triage.** New issues get a readiness label and a comment explaining the decision.
- **Implementation.** Issues labeled `ready-to-implement` get a draft pull request.
- **Review.** Pull requests get a code review before a human looks at them.

Every comment, review, and pull request an agent produces is signed with a link back to Warp, so it is always clear what a person wrote and what an agent wrote. The workflows live in [`.github/workflows`](./.github/workflows).

If you want to set up your own software factory, [try Warp's setup guide](https://www.warp.dev/blog/software-factory-build-guide).

## Contributing

Contributions of any size are welcome. Open an issue before substantial work so we can agree on the approach together. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full flow.

This project follows our [Code of Conduct](./CODE_OF_CONDUCT.md). To report a security issue, see our [security policy](./SECURITY.md).

## License

Hubble.md is licensed under the [MIT License](./LICENSE).