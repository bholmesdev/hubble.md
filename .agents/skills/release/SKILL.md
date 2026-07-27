---
name: release
description: Prepare Hubble desktop releases using tag-triggered GitHub Releases. Use when cutting, automating, or explaining app releases, version bumps, tags, GitHub Actions publishing, Electron artifacts, or updater release management.
---
# Release

Run the deterministic release script:

```sh
pnpm release:desktop [x.y.z]
```

Omit the version to increment the patch version. Use `--dry-run` to preview or
`--yes` to skip confirmation.

The script requires a clean, synced `main`; validates and promotes Unreleased;
runs `pnpm build:desktop`; shows the release diff; commits; tags; and atomically
pushes `main` with `desktop-vx.y.z`. GitHub Actions publishes the release.
