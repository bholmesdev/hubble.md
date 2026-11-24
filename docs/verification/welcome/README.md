# Welcome and new-profile verification

Electron screenshots from a fresh, isolated profile:

- [Welcome](welcome.png): no top bar, workspace creation as the primary action, shortcut hints for all three file/workspace actions, and a one-line Install Hubble skills action.
- [First workspace](inbox.png): the top bar returns and Inbox is selected.

Verified in the real Electron app with native dialog results stubbed at the Electron boundary: all three buttons and keyboard shortcuts reach the expected picker, and creating a workspace creates and opens its folder. The welcome reveal uses 100 ms staggered delays and disables motion when reduced motion is requested.

The skills action uses the same installation hook as Settings. Electron checks cover the available action, disabling repeat clicks while installation runs, already-installed detection after reload, and error feedback with retry. Skill IPC handlers are stubbed for these checks.

The store regression cases cover a fresh profile, an older profile without a saved sidebar view, and saved Folders/Inbox choices. Only a fresh profile defaults to Inbox. Reverting the default change makes the fresh-profile test fail with Folders instead of Inbox.

To check the welcome screen manually, run `pnpm dev:desktop:fresh`. Every launch creates a separate profile without the playground; regular development data remains intact.
