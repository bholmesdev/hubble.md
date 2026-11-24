# ChatGPT chat prototype

Run `pnpm dev:desktop`, then open **Settings → Chat** and choose
**Continue with ChatGPT**. Complete browser authorization with an eligible ChatGPT
Plus or Pro plan and permission to use that plan. Reconnect, sign-out, and Manage
usage are also in Settings → Chat.

Use the OpenAI icon beside the note actions to open chat. Select an available model
beside **Send**. Sending includes the current text file, including unsaved edits,
alongside your message and completed conversation history. The agent can discover,
read, and edit text files in the open workspace.
Stop preserves partial text but excludes it from later context.

## Prototype limits

- Each tab owns its conversation, draft, and model choice. App state persists
  these in localStorage with stable tab IDs. Switching files in a tab, renaming,
  switching workspaces, and restarting preserve them. Closing a tab or signing
  out clears its chat. Switching tabs stops an in-progress reply and preserves
  its partial text as incomplete. Reopening a closed tab starts a new chat.
- One ChatGPT registration per app installation. Reconnect uses the same account
  and registration. Account switching and automatic token renewal are deferred;
  reconnect when the access token expires (normally after an hour).
- File context is captured on send, never while browsing. First use and edits add
  full text snapshots at that turn; unchanged content references an earlier
  snapshot in the same tab. Returning to a file or renaming it reuses identical
  text. Earlier turns remain unchanged to preserve cacheable prefixes. All needed
  history, including snapshots, is transmitted on each HTTP request; caching does
  not remove it from the context window. New chat clears the snapshot history.
- Markdown, HTML, plain text, and code files are supported. Binary files and
  virtual pages are not attached. Sending waits while a text file loads or fails
  to load, so another file's editor buffer cannot be included accidentally.
- Workspace tools are `list_files`, `search_content`, `read_file`, and
  `apply_patch`. File listing and search follow sidebar ignore rules. Reads use
  the live buffer for the open file, including unsaved edits. Each patch updates
  one existing text file, requires the version returned by a read, and rejects
  stale or ambiguous context. Creation, deletion, moves, shell commands, and
  binary edits are outside this prototype.
- Tool paths are workspace-relative. Main resolves paths and checks real paths
  stay inside the workspace, including symlink targets. Each request retains its
  starting workspace and stops if the workspace changes. Tool access remains
  available if native filesystem watching fails. Each watcher start has a unique
  ID so cleanup from an older renderer effect cannot clear the active scope. Edit
  requests instruct the agent to apply changes directly and report success only
  after a successful tool result. Open-file edits use Hubble's existing save queue
  and conflict checks. Workspace activity appears where it happened in the reply.
- Tool results and original response items persist with the conversation and are
  replayed on follow-ups. Completed tool activity remains available after a stop;
  incomplete reply text is excluded. Each turn allows up to 12 model rounds.
- Agent edits save directly. Each edit to an open text editor is one Undo action,
  including front matter in Markdown. Undo and Redo save through the normal editor
  queue. Closed-file edits have no editor history; a review interface is deferred.
- The panel checks the connection before showing a conversation. Signed-out
  accounts see sign-in even when the tab has saved history. Connected accounts
  resume that history or show a new conversation. Missing models and connection
  failures show recovery actions; file-loading failures explain why Send is unavailable.
- No selection attachments, voice, or transcript sync.
- Replies render Markdown while streaming, including lists, links, tables, and
  fenced code blocks. Workspace activity appears between text segments in response
  order, including after restoring a chat. New chunks fade in over 140 ms; reduced
  motion disables the animation. Context, including file snapshots and tool results, is capped at
  80,000 characters and 100 messages.
  Oversized chats require a new conversation.

## Connection and credentials

The Electron main process implements the documented public-client OAuth flow:
loopback callback, dynamic registration, PKCE, state and nonce checks, verified
ID-token signature/issuer/audience/expiry, and an account-specific model catalog.
Credentials are encrypted through Electron safeStorage under the app's userData
folder. Linux's plaintext fallback is rejected. The renderer receives account
labels and stream text, never tokens. Sign-out clears local credentials and
attempts refresh-token revocation; a failed remote revocation is reported.

Requests use the public Responses endpoint with `store: false`, `stream: true`,
explicit history, no automatic retry, and no API-key billing fallback. Completion
requires a terminal success event. The OpenAI SDK and jose are used directly; no
Sign in with ChatGPT DevKit source is included.

Protocol references:

- [Open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Responses and models](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Accounts and sign-out](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

Unreadable saved credentials show a recovery state in both the panel and Chat
settings. Reset connection and sign in again removes only the local connection,
then starts sign-in. It preserves notes and tab conversations. A failed reset
stays visible with the same retry action.
