# UNN Socials — Full Ticket-Selling Experience (Phase 1 + 2) ✅

## Phase 1 — Verification & Real-Time Admin Notifications
- [x] 1. Server: add `POST /api/webhook/flutterwave` (real server-to-server payment confirmation)
- [x] 2. Server: add `POST /api/orders/notify-paid` (buyer marks bank transfer as done)
- [x] 3. Server: add `POST /api/orders/lookup` (buyer Order ID + phone lookup)
- [x] 4. Server: unseen tracking (`notifyAdmin`, `unseenCount`, `POST /api/admin/orders/seen`)
- [x] 5. Server: ticket code generation + `GET /api/ticket` (QR ticket fetch)
- [x] 6. Server: ticket-issued notification on verify (email audit + WhatsApp to buyer)
- [x] 7. Admin dashboard: real-time new-order alerts (poll 15s, badge, sound, browser notification, toast)
- [x] 8. Admin dashboard: highlight "payment notified" orders needing confirmation
- [x] 9. Pending page: "I've made the transfer" button + improved state machine + ticket preview
- [x] 10. render.yaml: add `FLUTTERWAVE_WEBHOOK_HASH` + `SITE_URL` env vars

## Phase 2 — Digital Tickets
- [x] 11. New `ticket.html`: QR ticket page (protected by orderId + code)
- [x] 12. New `my-tickets.html`: buyer lookup page (Order ID + phone)
- [x] 13. Update "My Tickets" links across site → my-tickets.html
- [x] 14. CSS: styles for ticket page, badges, admin alerts

## Phase 3 — Test & Deploy
- [x] 15. Test webhook, notify-paid, lookup, unseen, ticket fetch endpoints
- [x] 16. Test full flow: order → notify paid → admin alert → verify → ticket page unlocks
- [ ] 17. Commit & push to Render

## ✅ Completed This Session
- Webhook signature verification now enforced with `FLUTTERWAVE_WEBHOOK_HASH = Soludo123@`
  (falls back to defaults when env var not set — verified: no sig → 401, valid HMAC → verifies order)
- Fixed `/api/ticket` endpoint: was `=== '/api/ticket'`, now `startsWith` so query params work
- Success modal in checkout now passes `ticketCode` through `createOrderViaApi` → links straight to
  `ticket.html?orderId=...&code=...` for verified Flutterwave orders ("Find My Ticket" → my-tickets.html otherwise)
- Server + JS syntax verified; all 12 pages return HTTP 200; endpoints tested end-to-end

## Remaining
1. Commit & push to GitHub (Render auto-deploys on push to `main`)
2. In Render dashboard set:
   - `ADMIN_PASSWORD` (replace `CHANGE_ME_STRONG_PASSWORD`)
   - `FLUTTERWAVE_WEBHOOK_HASH` = `Soludo123@` (if not using render.yaml)
3. In Flutterwave Dashboard → Settings → Webhooks:
   - Webhook URL: `https://unisocials.onrender.com/api/webhook/flutterwave`
   - Secret hash: `Soludo123@`

