# Phase 4 — Migration lock-down notes

## What this phase is
Phase 4 is the "lock it down and document it" pass. The React checkout and
thank-you pages are in place, the server now treats them as canonical when the
React build is deployed, and the legacy `.html` pages are kept only as a
reversible fallback. This document captures the current state and the things to
verify on Render before and after the next deploy.

## What is canonical now
- When the React build exists, the server serves these from `dist/` before the
  legacy `.html` files:
  - `/checkout`
  - `/thank-you`
  - `/lookup`
  - `/my-tickets`
- The legacy `.html` forms are still reachable and still valid while the React
  build exists, because `server.js` aliases:
  - `/checkout.html` -> `/checkout`
  - `/thank-you.html` -> `/thank-you`
- The React checkout writes `checkoutData` to `sessionStorage` using the same
  key and shape as the legacy checkout, so the two versions can coexist without
  breaking the post-payment flow.
- The React thank-you page now:
  - shows the order summary and ticket links when an order is present
  - points "View My Tickets" at `/my-tickets` (React dashboard)
  - includes a guest lookup card wired to `/api/orders/lookup`, falling through
    to `/ticket.html?orderId=...&code=...` on success

## What still routes through the legacy path
- The legacy checkout page `checkout.html` still loads
  `templatemo-622-clearwave.js` and runs the legacy Flutterwave callback.
- The legacy `thank-you.html` is still served as a fallback when the React
  build is absent.
- The real payment end-to-end still needs a live Flutterwave key and a real
  test payment to confirm. This cannot be verified from the sandbox alone.

## Redirect URL consistency
- `render.yaml` now has `REDIRECT_URL` pointed at the canonical React
  thank-you path.
- `server.js` derives the default post-payment destination from
  `process.env.SITE_URL` plus `thankYouUrl()`, so the repo itself tells one
  consistent story.
- If Render still has an older `REDIRECT_URL` value set in the dashboard, that
  value wins at runtime. Check and align it before redeploying if you want the
  production Flutterwave return path to point at the React thank-you page.

## Before the next Render deploy
1. Confirm the deploy is building from `main` and that the build command is
   `npm ci && npm run build`.
2. Confirm `SITE_URL` is set to the live Render domain in production env vars.
3. Confirm `REDIRECT_URL` in production env vars matches the canonical
   thank-you path you want Flutterwave to use.
4. After deploy, check that the production `/checkout`, `/thank-you`,
   `/checkout.html`, and `/thank-you.html` all return 200 and that the React
   pages serve the SPA entry.
5. After deploy, verify the legacy pages still resolve as a fallback if the
   React build were removed — that is the reversibility guarantee.

## Unverified
- A real payment through Flutterwave. The code path is wired end to end; proving
  it works requires a live key and a real test payment on your side.

## Reversibility
- If anything about the React checkout/thank-you needs to be rolled back, remove
  the React build and the server falls back to the legacy `.html` pages. The
  legacy files are still on disk and untouched.
