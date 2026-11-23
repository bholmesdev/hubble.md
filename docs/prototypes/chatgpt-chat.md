# ChatGPT chat prototype

Run `pnpm dev:desktop`, then open **Settings → Chat** and choose
**Continue with ChatGPT**. Complete browser authorization with an eligible ChatGPT
Plus or Pro plan and permission to use that plan. Reconnect, sign-out, and Manage
usage are also in Settings → Chat.

Use the OpenAI icon beside the note actions to open chat. Select an available model
beside **Send**. Sending includes the current text file, including unsaved edits,
alongside your message and completed conversation history. The model has no tools
or filesystem access.
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
- No selections, source navigation, voice, file editing, or transcript sync.
- Replies render as text. Context, including file snapshots, is capped at 80,000 characters and 100 messages.
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
