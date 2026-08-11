# Custom themes

Hubble loads custom color themes from its global themes folder. Open **Settings → Appearance**, select the folder icon beside **Theme**, add a top-level `.json` file, and Hubble will load changes automatically.

Each file defines one light or dark theme. Its filename is its stable identity, so renaming `rose-pine.json` creates a new theme. Built-in themes remain available without being copied into this folder.

```json
{
  "$schema": "https://hubble.md/schemas/theme.json",
  "name": "Rosé Pine",
  "author": "Rosé Pine",
  "appearance": "dark",
  "palette": {
    "base": "#191724",
    "text": "#e0def4"
  },
  "colors": {
    "background": "$base",
    "foreground": "$text",
    "card": "#1f1d2e",
    "primary": "#c4a7e7",
    "primary-foreground": "$base",
    "muted": "#26233a",
    "muted-foreground": "#908caa",
    "border": "#403d52",
    "ring": "#ebbcba"
  }
}
```

Colors accept `#RRGGBB`, `#RRGGBBAA`, or a `$palette-name` reference. The nine colors above are required; Hubble derives the remaining interface colors and uses its matching built-in palette for omitted `syntax` and `terminal` colors. The [JSON Schema](https://hubble.md/schemas/theme.json) lists every optional token and enables editor completion when `$schema` is present.

Invalid files are reported in Appearance settings without preventing other themes from loading. If the selected file is removed or becomes invalid, Hubble falls back to its matching built-in theme.
