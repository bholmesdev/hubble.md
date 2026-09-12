# Desktop startup profile

Measured against `main` @ `91b7ddb` (desktop 0.1.28 + shortcut-settings work), unpackaged
production `out/` build, macOS 26.x, Apple Silicon. Warm runs, median of 5 (first run of each
batch discarded). Workspace: `fixtures/playground`, isolated user-data profile, last note restored.

Method: temporary `[DEBUG-perf]` timing marks in `electron/main.ts`, `electron/preload.ts`,
`index.html`, `src/main.tsx`, and `src/App.tsx`; renderer nav/paint stats collected via
`performance.getEntriesByType` at init completion; cross-process correlation via epoch
timestamps on stdout. All instrumentation was removed after measurement.

Related: #279.

## Warm startup timeline

Times are ms from the first line of `out/main/main.js`. Add ~190 ms of Electron/Chromium
bootstrap before that point to get process-exec-relative times (per the profiling in #279).

| Phase | Median Δ | Cumulative | Notes |
| --- | ---: | ---: | --- |
| `main.js` start → `app.whenReady` | 43–55 | 55 | |
| whenReady prep: telemetry, grants, IPC, menu | 22 | 77 | negligible — confirms #279's finding |
| `loadWindowState` | 6–10 | 82 | |
| `new BrowserWindow()` | **94–100** | 182 | largest single main-process chunk |
| renderer process boot → preload entry | **90–100** | 272 | second-largest chunk |
| html inline script → full bundle eval done | **77** | 353 | warm V8 lazy-compile of the 4.9 MB chunk |
| load event → React commit / init effect starts | 37 | 399 | React mount cost |
| inset round-trip + `show()` | 34 | 436 | 12 ms is the awaited `executeJavaScript` |
| **window visible** | | **~440** (~630 exec-relative) | |
| workspace open (sidebar walk + pins + last note) | 58–65 | 501 | real work, not overhead |
| **init-done / note text on screen** | | **~500** (~700 exec-relative) | |

Renderer page-relative stats:

- navigation response end: ~11 ms (local file read is not a bottleneck warm)
- `domInteractive`: ~94–128 ms
- `DOMContentLoaded` / `load`: ~172–208 ms
- first paint: ~108–156 ms
- **first contentful paint: ~252–324 ms — after React mounts**, because the body is only
  `<div id="root">` plus the theme-class inline script. Nothing contentful can paint earlier.

## Findings

### 1. The window is invisible for essentially all of startup

Confirmed with fresh data: window shows ~440 ms after `main.js` starts (~630 ms exec-relative),
~75 ms after `did-finish-load`. The show path itself costs ~34 ms (inset round-trip + native show).

### 2. `ready-to-show` is not an early signal in the current app

New finding: `ready-to-show` fired **1 ms before `did-finish-load`** in every run. Because there
is no paintable shell, Chromium cannot paint anything until React commits content, so Electron
has no reason to fire `ready-to-show` early. Consequence for the #279 design discussion:
switching `show()` to `ready-to-show` alone saves only the ~75 ms tail. A themed static shell in
`index.html` is what makes early reveal genuinely early — with a shell, first paint moves from
post-React-mount (~400 ms) to roughly bundle-eval time (~350 ms) or earlier, and `ready-to-show`
would fire there instead.

### 3. Main-process bootstrap work is confirmed cheap

The entire `whenReady` sequence before window creation (telemetry load, grants read/write,
protocol handler, IPC registration, menu build) totals 22 ms. Not worth optimizing beyond
possibly overlapping it with window creation.

### 4. The two big serial chunks are Electron-fixed, but overlappable

`new BrowserWindow()` (~95 ms) and renderer process boot (~95 ms) dominate after ready. They are
platform costs, but the 22 ms of prep work currently runs *before* them and could partially
overlap. Small win; ordering constraints apply (IPC handlers and grants must be in place before
the renderer's first `invoke`, which lands ~270 ms in).

### 5. Bundle eval is cheap warm; size still matters cold

Full evaluation of the unminified 4,945 KB single-chunk bundle costs only ~77 ms warm thanks to
V8 lazy compilation and warm page cache. Minification halves bytes but was measured in #279 to
gain ~15 ms warm — its payoff is cold launch, update download size, and disk. Eagerly loaded
heavy modules remain: `@xterm/xterm` (static `TerminalPanel` import), highlight.js via
`createLowlight(common)` at module scope (`packages/ui/src/editor/CodeBlockExtension.tsx:29`),
`@base-ui/react`, zod, yaml, parse5 — zero dynamic imports in `apps/desktop/src`.

### 6. Post-load work is real work

The last ~100 ms (React commit 37 + workspace open 58–65) is functional: sidebar listing,
pinned-notes config, reading the last-open note. It overlaps nothing today but happens after
the window is already visible, so it affects time-to-content, not time-to-window.

## Ranked levers

1. **Paintable HTML shell + reveal before `did-finish-load`** — biggest perceptual win
   (~300 ms earlier window). Needs the product decision tracked in #279 (skeleton vs blank).
2. **Move the traffic-light inset out of the show path** — set it from preload or inline CSS;
   removes a 12 ms round-trip from before `show()`.
3. **Minify + lazy-load xterm/lowlight/base-ui** — modest warm gain, meaningful cold gain,
   smaller updates.
4. **Move `shadcn` to devDependencies** — ~125 MB less asar; no runtime behavior change.
5. **Overlap whenReady prep with window creation** — ~20 ms, do last if at all.

## After

Levers 1, 2 and 4 shipped, plus minification of all three build targets. Lazy-loading is
deferred to its own change.

Re-measured with a lighter mark set than the profile above (marks only in `electron/main.ts`,
renderer stats via CDP). Baseline was re-run under that same set back-to-back, so compare
within this table, not against the ~440 ms in the timeline above — the two mark sets carry
different overhead.

Window-visible time, ms from the first line of `out/main/main.js`, median of 5 warm runs:

| Variant | Median | Range |
| --- | ---: | ---: |
| baseline (`did-finish-load` → inset round-trip → `show`) | 370 | 367–373 |
| `show()` on `ready-to-show` | 324 | 321–331 |
| **`show()` immediately after the state restore** | **165** | 162–171 |

Finding 2 held: `ready-to-show` fired 0.1–0.2 ms before `did-finish-load` in every baseline
run, so it is worth only the ~46 ms show-path tail. Showing before the load starts is what
pays, and it is only safe because zoom, the traffic-light inset and the background color are
all settled before the window exists.

Size:

| | Before | After |
| --- | ---: | ---: |
| renderer chunk | 4,943 KB | 2,467 KB |
| `app.asar` | 131 MB | 56 MB |
| asar header JSON (parsed per process) | 4.05 MB | 2.10 MB |

Still open: an electron-builder `files` allowlist would take the remaining 56 MB down further,
but it has to carry the full transitive closure of `electron-updater`, `zod`, `ignore`,
`@hubble.md/editor` and `node-pty` across 231 flattened packages, and needs a packaged smoke
test on macOS, Windows and Linux. Tracked separately.
