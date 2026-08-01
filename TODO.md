# UNN Socials — Overhaul (Flutterwave-only + Accounts + Per-Ticket Codes + Persistent Storage)

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

