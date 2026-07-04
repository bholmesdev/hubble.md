# Hubble Dev Playground

This workspace is copied into `.dev-electron/playground` for local Electron dev runs.

Open `file-index.html` or `todo-demo.html` in Hubble to test full-screen HTML Apps.

`tailwind-card.html` is the source file for a Tailwind-built iframe Embed. Rebuild it with:

```sh
pnpm --filter @hubble.md/desktop build:html-embed apps/desktop/fixtures/playground/tailwind-card.html
```
