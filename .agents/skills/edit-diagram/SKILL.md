---
name: edit-diagram
description: "Create or edit a Hubble diagram: a .tldr file Hubble opens in its built-in tldraw canvas. With this skill installed, any diagram, canvas, whiteboard, or .tldr file is a Hubble diagram: use this skill instead of tldraw-offline, unless the user names the tldraw offline app or the file is a .tldraw archive."
---

# Edit Diagram

A Hubble diagram is a `.tldr` file: tldraw's JSON file format. Hubble opens it
in a built-in tldraw canvas and reloads it live when the file changes on disk,
keeping the user's view in place. Edit the file directly.

## Routing

Use this skill, not `tldraw-offline`, for:

- any `.tldr` file
- a new diagram, canvas, or whiteboard, created as a `.tldr` file next to the
  user's notes

Do not open the tldraw offline app or call its local API for these files, even
when its skill is installed. Never create a `.tldraw` file: that is tldraw
offline's archive format, and Hubble does not open it.

Use `tldraw-offline` instead only when the user names the tldraw offline app,
or the file is an existing `.tldraw` archive.

## Tool

`scripts/diagram.mjs` in this skill loads diagrams with the same tldraw version
Hubble ships. The first run installs it into `~/.cache/hubble-skills`, which
needs `npm` and network access once.

```sh
node scripts/diagram.mjs summary path/to/file.tldr   # shapes, labels, arrows
node scripts/diagram.mjs fix path/to/file.tldr       # complete, validate, save
node scripts/diagram.mjs check path/to/file.tldr     # validate and lint only
```

`fix` saves nothing if tldraw rejects a record, and prints the field it
rejected.

## Workflow

1. Run `summary` instead of reading the file. Image assets embed as base64
   and can make the raw JSON very large.
2. Read the file, then edit its `records` array. Write only the fields you
   need (see below). Keep every record you are not changing as it is, and
   never edit `schema` or asset records.
3. Run `fix`. It fills defaults, binds arrows, writes the file in Hubble's
   format, then runs `check`.
4. Fix every `error`. Each `warning` is a heuristic: act on it unless the
   layout is intentional.
5. Report what changed by shape id and label. There is no screenshot; if
   placement matters, ask the user to look in Hubble.

Read the file right before writing it. Hubble saves the user's own canvas edits
to the same file, and a write based on an old read discards them.

To create a diagram, write a file with only a `records` array, then run `fix`.
An empty `.tldr` file is also valid: Hubble opens it as a blank diagram.

## Records

`fix` completes shapes, so a new shape needs only `id`, `typeName`, `type`,
position, and the props that matter:

```json
{
  "records": [
    { "id": "shape:request", "typeName": "shape", "type": "geo", "x": 0, "y": 0,
      "props": { "w": 220, "h": 100, "text": "Request" } },
    { "id": "shape:server", "typeName": "shape", "type": "geo", "x": 400, "y": 0,
      "props": { "w": 220, "h": 100, "text": "Server", "color": "blue", "fill": "semi" } },
    { "id": "shape:calls", "typeName": "shape", "type": "arrow",
      "props": { "from": "shape:request", "to": "shape:server", "text": "POST /save" } }
  ]
}
```

- Ids start with `shape:` and are readable (`shape:server`). Never change an
  existing id: bindings point at it.
- `text` is shorthand for a label. `fix` converts it to tldraw's `richText`. To
  relabel an existing shape, delete its `richText` and set `text`.
- Arrows connect shapes with `from` and `to`. `fix` turns them into bindings,
  so the arrow follows the shapes when they move. `check` reports an arrow
  with an unbound end. Mark an intentionally loose arrow with
  `"meta": { "decorative": true }`.
- To delete a shape, remove its record, every binding whose `toId` is that
  shape, and arrows that only made sense with it.
- A shape inside a `frame` has `"parentId": "<frame id>"` and `x`/`y` relative
  to the frame.

## Shapes

- `geo`: a box with a label. `props.geo` is `rectangle` (default), `ellipse`,
  `diamond`, `triangle`, `hexagon`, `oval`, `cloud`, `star`, `pentagon`,
  `octagon`, `rhombus`, `trapezoid`, `arrow-right`, `x-box`, or `check-box`.
- `note`: a sticky note, 200×200. Size it with `props.scale`, not `w`/`h`.
- `text`: free-standing words, such as a heading over a group. A label for a
  box goes in that box's `text`, not a separate text shape.
- `frame`: a named container (`props.name`) with children.
- `arrow`: a connection, as above. `props.bend` curves it.

Shared props:

- `color`: `black`, `grey`, `light-violet`, `violet`, `blue`, `light-blue`,
  `yellow`, `orange`, `green`, `light-green`, `light-red`, `red`, `white`.
- `fill`: `none`, `semi`, `solid`, `pattern`.
- `size`: `s`, `m`, `l`, `xl`.
- `font`: `draw` (hand-drawn, the default), `sans`, `serif`, `mono`.
- `dash`: `draw`, `solid`, `dashed`, `dotted`.

## Layout

- Match the existing diagram's sizes, colors, and font before adding to it.
- Lay boxes on a grid with equal gaps. A 220×100 box fits a short label at
  size `m`. Leave 160px or more between boxes joined by a labeled arrow, and
  80px or more otherwise.
- Use color to group related shapes, not to decorate each one.
- Boxes should not partly overlap. A box fully inside a larger one, like a
  lane or container, is fine.
