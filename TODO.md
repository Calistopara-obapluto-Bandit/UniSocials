# UNN Socials — Overhaul (Flutterwave-only + Accounts + Per-Ticket Codes + Persistent Storage)

## ✅ Latest Round — Event Category + Resend Email + Secret Removal — Completed
- [x] `tickets.html`: added `data-category` to every event option (Arts & Culture, Engineering, Business, Music, Academic, Sports)
- [x] `templatemo-622-clearwave.js`: pass `eventCategory` through both checkout flows (tickets page + events page)
- [x] `server.js`: store `eventCategory` on order creation
- [x] `server.js`: include Category in ALL email functions — `sendBuyerConfirmation`, `sendAdminAlert`, `sendNewOrderAlert` (plain text + HTML table)
- [x] `server.js`: new endpoint `POST /api/admin/orders/resend-email` (admin-only) — resends buyer confirmation for verified orders, new-order alert for pending orders, 400 for rejected
- [x] `admin.html`: category chip (`🏷`) in order meta row
- [x] `admin.html`: "✉ Resend Email" action button on pending + verified orders
- [x] `admin.html`: `resendOrderEmail()` JS helper with loading state + error handling + unauthorized logout
- [x] `render.yaml`: removed committed `DATABASE_URL` (Postgres password) and `RESEND_API_KEY` — both now set via Render dashboard env vars only; documented examples in comments
- [x] Syntax check: `node --check server.js` + `node --check templatemo-622-clearwave.js` both pass
- [x] End-to-end API test (local): create order with category → stored correctly → resend-email returns 200 "Email queued" → unauthorized returns 401 → missing order returns 404 → test order cleaned up
- [x] Temp test/helper files removed from repo

## ✅ Email Notifications (Resend) — Completed
- [x] server.js: `postJson` helper + Resend integration
- [x] server.js: `sendBuyerConfirmation` — buyer gets confirmation email with per-ticket QR links
- [x] server.js: `sendAdminAlert` — admin gets instant alert with order details + admin dashboard link
- [x] server.js: `notifyOrderVerified` fired on ALL three verification paths (verify-payment API, Flutterwave webhook, admin manual verify)
- [x] server.js: email env vars read from `process.env` (RESEND_API_KEY, EMAIL_FROM, ADMIN_EMAIL) with defaults
- [x] server.js: `getConfig` excludes RESEND/ADMIN_EMAIL/PASSWORD/WEBHOOK/API_KEY from browser config.js
- [x] render.yaml: added `ADMIN_EMAIL`, `EMAIL_FROM`, `RESEND_API_KEY` env vars
- [x] Tested: admin verify → order marked verified → notification path executed successfully
- [x] Best-effort: email failures never block the order flow (try/catch everywhere)

## ✅ Neon PostgreSQL Connected & Verified
- [x] `DATABASE_URL` updated in `render.yaml` to the new Neon PostgreSQL connection string
- [x] Connectivity test: connection OK, database `neondb` reachable
- [x] Tables auto-created on boot: `orders`, `users`, `sessions`
- [x] End-to-end persistence test: order created → server stopped → order still present in Neon DB (survives restarts)
- [x] Test data cleaned up (0 test orders remain)

## Completed
### Phase 1 — Server Core (persistent storage + verification)
- [x] 1. package.json: add `pg` dependency (PostgreSQL persistence; JSON fallback in ./data)
- [x] 2. server.js: storage layer (PostgreSQL if `DATABASE_URL`, JSON files fallback) for orders, users, sessions
- [x] 3. server.js: `generateTicketCodes(qty)` — one unique code per ticket
- [x] 4. server.js: POST /api/orders creates PENDING order with ticketCodes[]
- [x] 5. server.js: /api/verify-payment — server-authoritative amount+currency check before marking verified
- [x] 6. server.js: webhook handler validates HMAC signature + amount; issues tickets
- [x] 7. server.js: auth endpoints (register/login/logout/me/orders) with scrypt-hashed passwords + sessions
- [x] 8. server.js: POST /api/ticket/scan — gate check-in (marks a ticket used, rejects reuse)
- [x] 9. server.js: GET /api/ticket validates individual codes from ticketCodes[]
- [x] 10. server.js: removed bank-transfer notify-paid endpoint (Flutterwave-only)

### Phase 2 — Client JS + Checkout
- [x] 11. templatemo-622-clearwave.js: auth helpers (token in localStorage) + nav sign-in injection (`nav-account-slot`)
- [x] 12. templatemo-622-clearwave.js: removed revealAccount/copyAccountNumber (bank transfer)
- [x] 13. templatemo-622-clearwave.js: new checkout flow — create order → Flutterwave → verify → per-ticket success modal
- [x] 14. checkout.html: removed bank-transfer remnants; success modal lists every ticket link

### Phase 3 — Client Pages
- [x] 15. login.html (NEW): buyer sign in
- [x] 16. register.html (NEW): buyer sign up
- [x] 17. my-tickets.html: auto-load orders when logged in; list all tickets with individual links; order lookup by Order ID + phone
- [x] 18. pending.html: fixed blank page (reads from URL + /api/orders/status); removed "I've made the transfer" button; shows verified/rejected states + per-ticket links
- [x] 19. ticket.html: per-ticket QR (qrcode CDN + fallback) + print-only CSS + used status

### Phase 4 — Admin + Nav + Styling
- [x] 20. admin.html: list every ticket code with copy + QR link; gate scan/check-in panel; working verify/reject/reopen; already-used warning
- [x] 21. Nav across all pages: "Sign In" / account link (`nav-account-slot`)
- [x] 22. templatemo-622-clearwave.css: print styles, auth page styles, ticket-code styles, account nav
- [x] 23. render.yaml: PostgreSQL `DATABASE_URL` + updated env vars (secret key, public key, webhook hash)

### Phase 5 — Test & Deploy
- [x] 24. Syntax-check server.js + main JS
- [x] 25. End-to-end API test: register → login → order 2 tickets → admin verify → status → per-ticket → gate scan → already-used rejection
- [x] 26. Security: `FLUTTERWAVE_WEBHOOK_HASH` no longer exposed in browser config.js
- [x] 27. npm install (pg + dependencies), server runs on localhost:3000

---

# Previous Task: Fix "Buy Now" → auto-select clicked event
- [x] 1. index.html: pass `?event=` on all 3 home "Buy Now" links
- [x] 2. templatemo-622-clearwave.js: scroll to + highlight selected event on tickets page
- [x] 3. templatemo-622-clearwave.css: `.checkout-card-highlight` transition style
- [x] 4. Test: home "Buy Now" auto-selects the right event on tickets page

