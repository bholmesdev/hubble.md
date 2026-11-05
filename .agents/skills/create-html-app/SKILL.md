---
name: create-html-app
description: "Create or update a Hubble HTML App: a folder-local .html file
  Hubble runs as a self-contained interactive UI, with Alpine, Tailwind, Hubble
  theme tokens, and the injected hubble runtime API."
---
# Create HTML App

A Hubble HTML App is a folder-local `.html` file Hubble runs as a self-contained interactive UI. Opening it shows the app in the main content panel. Build any interactive experience — a tool, dashboard, or app — as a single `.html` file in the Folder.

To embed an HTML App inline inside a Markdown File, see `create-embed`.

## Runtime

Hubble provides the app runtime. Write plain HTML that assumes these globals are already available:

- `hubble`
- `Alpine`
- Tailwind browser v4
- Hubble theme tokens

Use Alpine and Tailwind by default. Do not add dependency `<script>` tags or set up package files, lockfiles, or `node_modules`.

HTML Apps run in a sandboxed iframe. Hubble allows:

- `allow-scripts`: Alpine, Tailwind browser, and the Hubble runtime can execute.
- `allow-forms`: native HTML form semantics work when paired with Alpine handlers such as `@submit.prevent`.

Hubble does not allow:

- `allow-same-origin`: apps keep an opaque origin and cannot use app-origin storage, cookies, or same-origin access.
- `allow-top-navigation`: apps cannot navigate the desktop app frame.
- `allow-popups` / `allow-popups-to-escape-sandbox`: apps cannot open unsandboxed popup windows.
- `allow-downloads`: apps cannot start downloads directly.
- `allow-modals`: apps cannot use modal browser dialogs.

## Files API

Apps reach Workspace files through `hubble.files`, an async broker rather than direct filesystem access. All paths are Workspace-relative and point to Markdown files.

```
await hubble.files.list("todos/*.md")
// → [{ name, path, modified_at, size }], sorted by path
await hubble.files.read("notes/today.md")
// → { path, body, properties }
await hubble.files.open("notes/today.md")
// → { path }, navigates the editor to the file
await hubble.files.create({ path, body, properties, open })
// → { path, body, properties }
await hubble.files.update(path, { body, properties })
// → { path, body, properties }, patch
await hubble.files.remove("notes/today.md")
// → { path }
```

Methods throw on failure; each has a `safe*` variant. See [Files API](references/files-api.md) for shapes, patch semantics, and error handling.

## Template

```
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Folder files</title>
	</head>
	<body class="m-0 bg-background p-3 font-sans text-foreground">
		<main
			class="grid gap-3 rounded-md border border-border bg-card p-3 text-card-foreground"
			x-data="{
				files: [],
				error: '',
				async init() {
					try {
						this.files = await hubble.files.list('**/*.md')
					} catch (error) {
						this.error = error.message || 'Could not load files'
					}
				},
			}"
		>
			<header class="flex items-center justify-between gap-3">
				<h1 class="m-0 text-base font-semibold">Folder files</h1>
				<span class="text-sm text-muted-foreground" x-text="`${files.length} files`"></span>
			</header>

			<p class="m-0 text-sm text-muted-foreground" x-show="!error && files.length === 0">
				Loading files...
			</p>
			<p class="m-0 text-sm text-destructive" x-show="error" x-text="error"></p>

			<ul class="m-0 grid list-none gap-2 p-0" x-show="!error && files.length > 0">
				<template x-for="file in files" :key="file.path">
					<li class="rounded-sm border border-border bg-background px-3 py-2">
						<span class="text-sm font-medium" x-text="file.path"></span>
					</li>
				</template>
			</ul>
		</main>
	</body>
</html>
```

## Structuring Logic

Inline `x-data` is fine for simple state (a flag, a counter, a current tab). For anything more, like async loaders, multiple methods, or computed logic, register an `Alpine.data()` component in a `<script>` and reference it by name.

```ts
<script>
	document.addEventListener('alpine:init', () => {
		Alpine.data('fileList', () => ({
			files: [],
			error: '',
			async init() {
				try {
					this.files = await hubble.files.list('**/*.md')
				} catch (error) {
					this.error = error.message || 'Could not load files'
				}
			},
		}))
	})
</script>

<main x-data="fileList">…</main>
```

Why this beats large inline expressions:

- Alpine parses `x-data` as a single expression. Multi-line bodies with arrow functions, object methods, or `<`/`>`/`&` get HTML-escaped or mis-parsed, surfacing as silent "Alpine Expression Error" failures.
- Logic lives in real JavaScript with syntax highlighting and normal quoting, not inside an attribute string.
- Components are reusable and testable, and keep markup readable.

Register components inside `alpine:init` so they exist before Alpine scans the DOM.

## Native Feel

Use Hubble tokens through Tailwind classes so the app feels native:

- Surfaces: `bg-background`, `bg-card`, `bg-popover`
- Text: `text-foreground`, `text-muted-foreground`, `text-card-foreground`
- Borders/rings: `border-border`, `border-input`, `ring-ring`, `focus-visible:ring-ring`
- Actions: `bg-primary text-primary-foreground`, `bg-secondary text-secondary-foreground`
- States: `hover:bg-accent`, `bg-selected text-selected-foreground`

Keep spacing compact: `gap-2`, `gap-3`, `p-2`, `p-3`, `px-3`, `py-2`. Use `rounded-sm` or `rounded-md` for controls.

Avoid one-off palettes, oversized cards, hero layouts, and decorative gradients unless the user asks for a themed visual.

## References

Read only the patterns you need:

- [Files API](references/files-api.md)
- [Buttons](references/buttons.md)
- [Radio selects](references/radio-selects.md)
- [Tabs](references/tabs.md)
- [Forms](references/forms.md)
- [Lists and empty states](references/lists-and-empty-states.md)

