---
name: test-desktop-app
description: Use when testing the Hubble Electron desktop app, especially when inspecting, clicking, screenshotting, or verifying a real note edit in the running app.
---

# Test Desktop App

1. Run `HUBBLE_DESKTOP_BACKGROUND=1 HUBBLE_DESKTOP_ENABLE_CDP=1 pnpm dev:desktop`. `HUBBLE_DESKTOP_BACKGROUND=1` keeps the window hidden so it never covers or takes focus from the user's screen; drive it over CDP.
2. Read the terminal output for:
   - `Playground: <path>`
   - `DevTools listening on ws://127.0.0.1:9222/...`
3. Use the auto-opened editable playground at `apps/desktop/.dev-electron/playground` instead of file pickers or checked-in fixtures.
4. Prefer the Chrome DevTools Protocol endpoint for interaction-heavy verification. It can inspect DOM state, evaluate JavaScript, click controls, inspect iframe contents, and capture screenshots from the real Electron renderer. This is useful when Computer Use has limitations interacting with the dev app window.
5. For CDP setup, fetch `http://127.0.0.1:9222/json/list`, connect to the page `webSocketDebuggerUrl`, and drive the renderer with DevTools Protocol commands.
6. When you're done, stop the dev server and confirm no `Hubble Dev` process remains.

Gotchas:

- Build `packages/ui` and `packages/editor` first; the desktop app imports their dist output.
- Screenshots are DPR 2: CSS px times 2.
- Right clicks need real `Input.dispatchMouseEvent` events; synthetic `contextmenu` events don't open base-ui context menus.
- Popup open in the DOM but missing from a screenshot? Check stacking with `document.elementFromPoint`.
- xterm refits through a debounced ResizeObserver and can lag layout changes by a few seconds; re-measure before calling it a bug.
