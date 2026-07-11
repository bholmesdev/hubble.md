# Hubble review comments

Hubble stores review state in the Markdown body. The portable inline forms are:

```md
{==anchored text==}{>>comment body<<}{#c1}
{++suggested insertion++}
{--suggested deletion--}
{~~original text~>replacement text~~}
```

Comment replies and resolution are stored immediately after the comment as an
encoded HTML comment. Hubble renders this metadata as part of the same thread
and other Markdown tools can safely ignore the HTML comment:

```md
<!-- hubble-review:%7B%22replies%22%3A%5B%5D%2C%22resolved%22%3Atrue%7D-->
```

Agents should preserve the anchor id, comment body, edit markers, and unknown
review metadata when editing the file. To reply, append a reply object to the
metadata `replies` array. To resolve or reopen a thread, set `resolved` to
`true` or `false`. Review markers inside inline code and fenced code blocks are
literal content and must not be modified.
