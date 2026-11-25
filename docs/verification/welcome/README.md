# Welcome and new-profile verification

Electron screenshots from a fresh, isolated profile:

- [Welcome](welcome.png): no top bar, workspace creation as the primary action, shortcut hints for all three file/workspace actions, and a Set up agent skills row with Install manually and Install controls.
- [Skills installed](skills-installed.png): the entire skills row fades from gray to pale green without changing size.
- [First workspace](inbox.png): the top bar returns and Inbox is selected.

Verified in the real Electron app with native dialog results stubbed at the Electron boundary: all three buttons and keyboard shortcuts reach the expected picker, and creating a workspace creates and opens its folder. The welcome reveal uses 100 ms staggered delays and disables motion when reduced motion is requested.

The skills row shares the Settings component's installation hook, installed indicator, and manual-install modal. Welcome changes the title, removes the description, and uses a dark download-icon button without a fill in a filled row with a bolt icon. The row matches the other welcome options' width, 40 px height, horizontal padding, and label typography. It transitions to pale green over 500 ms after installation, with motion disabled under reduced motion.

Electron checks cover the icon button, busy indicator and duplicate-click prevention, success colors and stable geometry, already-installed detection after reload, manual installation, the Settings installed indicator, and failure/retry. Skill IPC handlers are stubbed for these checks.

The store regression cases cover a fresh profile, an older profile without a saved sidebar view, and saved Folders/Inbox choices. Only a fresh profile defaults to Inbox. Reverting the default change makes the fresh-profile test fail with Folders instead of Inbox.

To check the welcome screen manually, run `pnpm dev:desktop:fresh`. Every launch creates a separate profile without the playground; regular development data remains intact.
