export function chatAuthPage(declined: boolean) {
	const title = declined ? "Sign-in cancelled" : "Signed in successfully";
	const description = declined
		? "Return to Hubble to try signing in again."
		: "You can close this tab and return to Hubble.";
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${title} · Hubble</title>
  <style>
    :root { color-scheme: light dark; --background: #fdfcf9; --foreground: #262b27; --muted: #777970; --brand: #235d46; --tint: #e8eeea; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--background); color: var(--foreground); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; min-height: 100svh; place-content: center; justify-items: center; padding: 100px 24px; text-align: center; }
    .mark { display: grid; width: 64px; height: 64px; margin-bottom: 28px; place-items: center; border-radius: 50%; background: var(--tint); color: var(--brand); }
    h1 { margin: 0 0 12px; font-size: clamp(26px, 5vw, 32px); font-weight: 600; line-height: 1.2; letter-spacing: -.035em; }
    p { max-width: 100%; margin: 0; color: var(--muted); }
    @media (prefers-color-scheme: dark) { :root { --background: #20231f; --foreground: #f2f3ee; --muted: #a6aca1; --brand: #a8c9b6; --tint: #2b3b31; } }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        ${declined ? '<path d="m7 7 10 10M17 7 7 17" />' : '<path d="m5 12 4 4L19 6" />'}
      </svg>
    </div>
    <h1>${title}</h1>
    <p>${description}</p>
  </main>
</body>
</html>`;
}
