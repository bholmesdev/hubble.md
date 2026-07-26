# Hubble review comments

Hubble stores review state in the Markdown body. The portable inline forms are:

```md
{==anchored text==}{>>comment body<<}{#c1}
{++suggested insertion++}
{--suggested deletion--}
{~~original text~>replacement text~~}
```

Text that could be mistaken for review or Markdown syntax is backslash-escaped
so opening and saving a file is lossless:

| Field | Escaping |
| --- | --- |
| Comment anchor | CriticMarkup delimiters use an encoded backslash escape; Markdown formatting remains active |
| Comment body | CriticMarkup delimiters, Markdown inline syntax, backslashes, and line breaks are escaped |
| Replacement original | CriticMarkup delimiters and backslashes use the same encoded escape as anchored text |

The encoded escapes survive Markdown parsing and are decoded only after Hubble
recognizes the surrounding review span. Other Markdown tools still display the
CriticMarkup structure as readable text.

Comment replies and resolution are stored immediately after the comment as an
HTML comment. Hubble renders this metadata as part of the same thread
and other Markdown tools can safely ignore the HTML comment:

```md
<!-- hubble-review:{"v":1,"replies":[],"resolved":true}-->
```

Agents should preserve the anchor id, comment body, edit markers, and unknown
review metadata when editing the file. To reply, append a reply object to the
metadata `replies` array. Each reply requires a string `id` and `body`; replies
missing either are silently discarded. `author` and `createdAt` are optional:

```json
{ "id": "r2", "body": "Done, see the updated section.", "author": "agent", "createdAt": "2026-07-19T00:00:00.000Z" }
```

Because the metadata lives inside an HTML comment, a reply `body` containing
a hyphen (`-`) must escape each one as the six-character sequence `\u002d`,
or a raw `--` will invalidate the HTML comment and corrupt the file. For
example, a body of `Wait -- really?` must be written as `Wait \u002d\u002d really?`
inside the JSON string.

To resolve or reopen a thread, set `resolved` to `true` or `false`. Review
markers inside inline code and fenced code blocks are literal content and must
not be modified.

## Agent handoff

The thread popover's **Copy agent prompt** action copies a short request naming
the file and the comment's stable id. An agent addressing it should:

1. Read the named Markdown file before editing.
2. Locate the comment by its `{#id}` anchor and preserve its anchored text.
3. Reply by appending an object to the inline `replies` metadata.
4. Resolve the comment only after addressing it.
5. Preserve CriticMarkup markers, unknown review metadata, and unrelated Markdown.

Install the companion Hubble skills to give an agent a reusable workflow for
this handoff:

```bash
npx skills add bholmesdev/hubble-skills
```

The `review-markdown-comments` skill handles the file-backed reply and resolve
workflow described above.
