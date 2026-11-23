# ChatGPT chat prototype

Run `pnpm dev:desktop`, then use the chat icon beside the note actions. Choose
**Continue with ChatGPT**, complete browser authorization, and select an available
model. An eligible ChatGPT Plus or Pro plan and permission to use that plan are
required. Manage usage opens ChatGPT's app usage settings.

Select a passage in the rich text editor and choose **Add selection**. Quotes are
snapshots of the live editor, including unsaved text. Send transmits the message,
attached quotes, and completed conversation history. The model has no tools or
filesystem access. Stop preserves partial text but excludes it from later context.

## Prototype limits

- Chats stay in memory. Closing the panel preserves them; switching folders,
  changing a Loose File, signing out, or quitting clears them.
- One ChatGPT registration per app installation. Reconnect uses the same account
  and registration. Account switching and automatic token renewal are deferred;
  reconnect when the access token expires (normally after an hour).
- Text and rich text selections only. No source-editor selection, saved-highlight
  browser, source navigation, voice, file editing, or transcript sync.
- Replies render as text. Context is capped at 80,000 characters and 100 messages.
  Oversized chats require a new conversation or fewer quotes.

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
