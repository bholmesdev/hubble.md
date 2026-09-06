# hubble.md context

Glossary for shared terms across the project. Implementation details belong in code or ADRs — not here.

## Flagged ambiguities

- **A Workspace is defined by its configuration, not by the cloud.** Don't conflate "is this a Workspace?" (does the folder have a `.hubble/` configuration) with "is it synced?" ([[Cloud Sync]] enabled). A desktop Workspace can be local-only and gain Cloud Sync later. *(Note: not yet true in code — `init()` requires a Convex backend to mint a `workspaceId`. This is the subject of an active spec; see the deferred-cloud-sync handoff.)*
- **"Open folder" (desktop runtime) vs "Workspace."** The desktop editor operates on any open folder path and reads/writes the filesystem directly; that folder may be a [[Workspace Folder]] or a [[Plain Folder]]. Say "open folder" for the runtime notion, "Workspace" for the configured logical entity.
- **"Open file" can mean OS selection or editor navigation.** In desktop shell language, opening a file may mean choosing a Loose File from the operating system. In [[HTML App]] API language, opening a file means navigating the editor to a [[Markdown File]] inside the current [[Workspace]].

## Glossary

### Workspace

A logical container of Markdown Files and Assets, defined by a **workspace configuration** (`.hubble/config.json`) — *not* by the cloud. A Workspace has a stable identity from the moment it is created.

[[Cloud Sync]] is an optional capability layered on top. A Workspace may be **local-only** (configured, no cloud backend) or **synced** (bound to a Convex deployment, with a row in the `workspaces` table). On the **web** a Workspace is always synced — there is no local filesystem to fall back to. On **desktop** a Workspace can be created local-only and have Cloud Sync enabled later.

The Workspace is the unit; the **access path differs by surface**. The web app reads/writes through the Convex backend. The desktop app reads/writes the [[Workspace Folder]] directly on disk (the working source of truth), with the background sync engine reconciling to Convex when Cloud Sync is on. Features that must run on both surfaces — notably [[Embed]]s — target the Workspace as the unit and resolve against whichever backend the current surface provides; they never assume Convex.

### Workspace Folder

The on-disk realization of a [[Workspace]]: a folder containing the workspace configuration at `.hubble/config.json`. **Configuration presence — not cloud binding — is what makes a folder a Workspace Folder.** When [[Cloud Sync]] is enabled the config also carries the Convex linkage (today: `workspaceId`, `workspaceName`); a local-only Workspace Folder has configuration without it. Multiple Workspace Folders across devices can map to the same synced Workspace.

### Plain Folder

A folder open in the desktop app with **no** workspace configuration (no `.hubble/`). It is not a [[Workspace]]: the desktop app reads and edits it as a general markdown viewer, nothing syncs, and Workspace-scoped features (e.g. [[Embed]]s) do not resolve. Adding a configuration promotes it to a [[Workspace Folder]].

### Folder

A filesystem directory inside a [[Workspace Folder]] or [[Plain Folder]]. A Folder can contain zero or more [[Markdown File]]s and zero or more Folders.
_Avoid_: Directory

### Compacted Folder Path

A single sidebar row that represents a chain of nested Folders where each Folder has exactly one child Folder and no sibling [[Markdown File]]s or Folders. Each segment in the row names one real Folder, and can be targeted independently for folder actions such as dragging or dropping.
_Avoid_: Compacted directory name

### Cloud Sync

The optional capability that binds a [[Workspace]] to a Convex deployment, enabling multi-device sync and web access. Required for web Workspaces; opt-in on desktop, where it can be enabled after a Workspace is created by supplying a Convex deployment URL. Whether Cloud Sync is on is orthogonal to whether a folder is a Workspace.

### Markdown File

A markdown document on the local filesystem or in a Workspace.

### HTML App

A folder-local `.html` file that Hubble runs as a self-contained, interactive UI. Opening an HTML App directly shows it in the main content panel instead of the Markdown editor. An HTML App reaches files in the open Folder only through a capability-scoped, async **broker**, never directly.

### Slash Command

A formatting command launched by typing `/` in a Markdown File. Slash Commands create a new block after the current block, except when the current block is an empty paragraph, where the command converts that paragraph in place.

### File Properties

User-facing structured fields attached to a Markdown File. File Properties are distinct from the document body and are stored in the file's front matter.

### Loose File

A Markdown File opened directly from the filesystem, not through a Workspace Folder or Plain Folder. The desktop app can read and edit it with access scoped to the file and nearby assets; nothing syncs.

### Tab

A note the user has open in the desktop editor, shown as one entry in the tab strip in the top bar.

A Tab records **where** a note is, not what it holds: its path and its own back/forward trail. The open document itself stays singular — one [[Markdown File]] is loaded at a time, in one editor, with one file watcher. Activating a Tab saves the current note and loads the Tab's note from disk, the same thing clicking a sidebar row already does. Background Tabs therefore hold no unsaved text, no dirty state, and no conflict state; there is nothing in a Tab to go stale.

Tabs are session state. They are not persisted, so a relaunch restores the last opened note as a single Tab rather than the set that was open.
_Avoid_: buffer, pane, window.

### Active Tab

The Tab whose note is currently in the editor. Back and forward act on the Active Tab's trail, so each Tab navigates independently.

The [[Markdown File]] on screen is normally the Active Tab's, with one exception: the app changelog takes over the editor without a Tab of its own, so while it is showing no Tab is selected.

### Asset

A binary file referenced by a Markdown File, such as an image. Asset paths in markdown use the desktop-canonical `<markdown-file-stem>.assets/<hash>.<ext>` convention relative to the Markdown File's folder.

### Embed

An inline placement of an [[HTML App]] at a point in a [[Markdown File]]. Use an Embed when an HTML App should appear inside existing Markdown content instead of taking over the main content panel. See ADR-0007.

Embeds have the same constraints as HTML apps; they reach files in the open Folder only through a capability-scoped, async **broker**, never directly.

### HTML App File API

The [[HTML App]] broker capability for reading, navigating to, creating, and patching [[Markdown File]]s inside the current [[Workspace]]. Reading a file returns its body and [[File Properties]] separately; updating a file is patch-like, so omitted body or property keys are preserved and explicit property deletion must be requested.

HTML App File API methods throw on failure by default. Each method also has a safe variant that returns an explicit success or failure result instead of throwing.
_Avoid_: filesystem API, direct file access.

### Workspace Snapshot

The client's currently loaded view of a [[Workspace]] — an atomically assembled bundle of (workspace name, files list, last-opened file content). The app shell renders only when a Workspace Snapshot exists; the UI never shows a partially-loaded one. Switching workspaces means preparing a new snapshot in the background and replacing the previous Workspace Snapshot in a single update once it's ready.
