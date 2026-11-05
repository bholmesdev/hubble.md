---
name: embed-html-app
description: "Embed a Hubble HTML App inline inside a Markdown File using an iframe block. Use when an app should be viewed in the context of a document."
---
# Embed an HTML app

To embed an HTML app inside of a document, use the app's folder-local `.html` path with an iframe block:

```
<iframe src="./file-index.html"></iframe>
```

The `src` must be a relative folder-local `.html` path from the Markdown File.

Inline Embeds resize to fit their content inside the Markdown File. A full-panel HTML App opened on its own relies on normal iframe scrolling instead.

To author the HTML App itself, see `create-html-app`.
