# Files API

`hubble.files` is the async broker an HTML App uses to read, navigate, create, and edit Markdown files in the current Workspace. There is no direct filesystem access.

Rules that apply to every method:

- Paths are Workspace-relative (no `..`, no absolute paths) and point to Markdown files.
- Calls are async; `await` them.
- Methods throw on failure. Each has a `safe*` variant that never throws — it resolves to `{ ok: true, value }` or `{ ok: false, error: { message } }`.
- A request rejects if no Workspace is open.

## File shape

`read`, `create`, and `update` return a parsed file:

```js
{
	path: "notes/today.md",
	body: "# Today\n\nNotes...", // Markdown after front matter
	properties: { title: "Today", done: false, tags: ["a", "b"] }
}
```

`properties` is the front matter as a plain object. Supported value types: `string`, `number`, `boolean`, `string[]`. Unsupported front matter entries are omitted.

## Methods

### `list(glob = "**/*")`

Returns matching files sorted by path:

```js
const files = await hubble.files.list("todos/*.md")
// → [{ name, path, modified_at, size }, ...]
```

Each entry: `name` (basename), `path` (Workspace-relative), `modified_at` (epoch ms), `size` (bytes). Use `read` to get a file's body/properties.

### `read(path)`

```js
const note = await hubble.files.read("notes/today.md") // → { path, body, properties }
```

### `open(path)`

Navigates the editor to the file (Hubble "open" = editor navigation, not an OS dialog):

```js
await hubble.files.open("notes/today.md") // → { path }
```

### `create(input)`

```js
await hubble.files.create({
	path: "todos/buy-milk.md", // ".md" added if missing
	body: "# Buy milk\n\n", // optional, defaults to ""
	properties: { done: false, priority: "normal" }, // optional
	open: true, // optional, navigate to it after creating
})
// → { path, body, properties }
```

Fails if the file already exists. Missing parent folders are created.

### `update(path, patch)`

Patch-style. Omitted keys are preserved:

```js
await hubble.files.update("todos/buy-milk.md", {
	properties: { done: true }, // merged into existing properties
})

await hubble.files.update("todos/buy-milk.md", {
	body: "# Buy oat milk\n", // replaces body, properties untouched
	properties: { priority: null }, // null deletes the property
})
// → { path, body, properties }
```

A patch must include `body`, `properties`, or both. Properties merge key-by-key; pass `null` to delete a key. The file must already exist.

### `remove(path)`

```js
await hubble.files.remove("todos/buy-milk.md") // → { path }
```

## Error handling

Throwing form — wrap in try/catch:

```js
try {
	const note = await hubble.files.read(path)
} catch (error) {
	this.error = error.message
}
```

Safe form — branch on the result:

```js
const result = await hubble.files.safeRead(path)
if (result.ok) {
	this.note = result.value
} else {
	this.error = result.error.message
}
```

Every method has a safe variant: `safeList`, `safeRead`, `safeOpen`, `safeCreate`, `safeUpdate`, `safeRemove`.