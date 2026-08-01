# UNN Socials — Polish & Client Account Implementation

## Goal
Make the ticketing experience polished like popular ticketing sites:
Flutterwave-only payments, instant verified tickets with QR + print,
admin reject/verify reflected live on the client, and buyer accounts
that stay logged in (no page refresh).

## Tasks

### 1. Remove Bank Transfer — Flutterwave-only ✅
- [x] server.js: remove bank-transfer / notify-paid path from the flow; Flutterwave orders verified instantly
- [x] checkout.html: Flutterwave-only payment card (already only shows Flutterwave radio)
- [x] templatemo-622-clearwave.js: remove bank reveal/copy + transfer logic; remove `redirect_url` from inline checkout so callback reliably fires
- [x] pending.html: rewrite as "Confirming payment…" page (poll + auto-redirect to ticket)
- [x] my-tickets.html / admin.html: Flutterwave-only labels
- [x] config.js / render.yaml: remove bank-account env vars (done)

### 2. Fix Admin Reject propagation (live client update) ✅
- [x] Client-side polling so admin reject/verify updates buyer's open page automatically
- [x] Account dashboard polls orders via /api/account/orders every 5s

### 3. Fix Ticket display & QR printing ✅
- [x] Order created + verified immediately on Flutterwave callback
- [x] ticket.html print-only CSS + QR library fallback
- [x] thank-you.html: detect tx_ref/status params and finalize order + ticket link

### 4. Client Login & Account Dashboard (no refresh) ✅
- [x] server.js: register/login/me/logout endpoints + clients.json (gitignored) + hashed passwords
- [x] Auto-link orders to account by email/phone
- [x] my-tickets.html: Sign In / Create Account + dashboard with live order polling
- [x] Dashboard lists buyer's orders/tickets live (poll 5s)
- [x] "Sign In / My Account" in nav on all pages; auto-login after purchase

### 5. Test & Deploy
- [x] End-to-end test (checkout → flutterwave → ticket/QR → account dashboard → admin reject/verify live)
- [x] Verified: admin reject propagates to client lookup (`rejected` status), ticket fetch returns QR, client register/login/logout works
- [ ] Commit & push to Render
