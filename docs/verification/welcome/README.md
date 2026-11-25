# Welcome and new-profile verification

Electron screenshots from a fresh, isolated profile:

- [Welcome](welcome.png): no top bar, rounded heading at a consistent size, with lighter “Welcome to” text and a semibold hubble wordmark, workspace creation as the primary action, shortcut hints for all three file/workspace actions, and an Install agent skills panel with a separate Install manually button.
- [Hover](hover.png): folder and file actions fade to a neutral gray background.
- [Skills installed](skills-installed.png): the entire skills row fades from gray to pale green without changing size.
- [First workspace](inbox.png): the top bar returns and Inbox is selected.

Verified in the real Electron app with native dialog results stubbed at the Electron boundary: all three buttons and keyboard shortcuts reach the expected picker, creating a workspace creates and opens its folder, and selecting an existing file or folder opens its content and restores the top bar. The welcome reveal uses 100 ms staggered delays and disables motion when reduced motion is requested. Folder and file actions fade to a neutral gray hover background over 150 ms, with transitions disabled for reduced motion.

The skills row shares the Settings component's installation hook, installed indicator, and manual-install modal. Welcome changes the title, removes the description, and makes the entire filled panel an install button with a download icon. Install manually is an independent secondary button. The row matches the other welcome options' width, 40 px height, horizontal padding, and label typography. The panel has a small right inset while the manual-install button retains its standard horizontal padding. It transitions to pale green over 500 ms after installation, with motion disabled under reduced motion.

Electron checks cover clicking the panel icon, Enter/Space activation, keyboard focus moving to Install manually without triggering installation, the busy indicator and duplicate-click prevention, success colors and stable geometry, already-installed detection after reload, manual installation, the Settings installed indicator, and failure/retry. Skill IPC handlers are stubbed for these checks.

The store regression cases cover a fresh profile, an older profile without a saved sidebar view, and saved Folders/Inbox choices. Only a fresh profile defaults to Inbox. Reverting the default change makes the fresh-profile test fail with Folders instead of Inbox.

Final PR verification on macOS:

- `pnpm check` and `REACT_COMPILER_AUDIT=1 pnpm build:desktop` pass; the React Compiler compiles 74 desktop components and 84 UI components with no failures.
- Desktop unit tests: 339 pass. Editor unit tests: 133 pass.
- Electron E2E: 7 pass; 5 diagram tests skip under the existing feature gate.
- A 360 × 320 window scrolls to the skills panel, opens the manual installer, and has no horizontal overflow.
- Updated to the latest `main`; both changelog entries are preserved after resolving the merge conflict.

Website builds and browser testing are excluded. Windows/Linux native UI was not exercised. Skill installation is stubbed at IPC for these checks; no user skills are written.

To check the welcome screen manually, run `pnpm dev:desktop:fresh`. Every launch creates a separate profile without the playground; regular development data remains intact.
