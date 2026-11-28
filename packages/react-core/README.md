# Hubble React core

This private workspace package owns shared React integrations with external systems. Feature code imports its public entry points. Changes to core APIs or their enforcement go in a dedicated pull request for code-owner review before feature work depends on them.

## Commands

Use `useWindowCommands` for a window-level command. It accepts an ordered list of commands with a registered command ID, fixed shortcut, or literal key. It evaluates enabled conditions at dispatch time so an editor's current focus can determine whether to handle the key. The first eligible match consumes the event. Component-local actions use JSX event handlers.

Find and Replace are the first consumers. The current effect lint applies throughout the codebase. As other integrations move into core APIs, expand the static restrictions until product code cannot call React effects directly.
