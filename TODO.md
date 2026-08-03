# Unisocials — Current Task TODO

## Goal
1. After payment, show a message that the ticket will be sent to the buyer's email shortly and also appear in their dashboard.
2. Add logout buttons in the admin dashboard and the client (My Tickets) dashboard.
3. Allow the admin to manually add events from the admin dashboard so they appear on the client pages.
4. Push to GitHub and deploy on Render.

## Steps
- [ ] 1. server.js: add `events` storage (PostgreSQL table + JSON fallback), seed default events, `GET /api/events`, `POST /api/admin/events`, `DELETE /api/admin/events`
- [ ] 2. checkout.html: success modal message + Email row ("ticket sent to email + appears in dashboard")
- [ ] 3. templatemo-622-clearwave.js: populate modal Email field; make tickets page dropdown load events from `/api/events`; expose `filterEvents` for dynamic event cards
- [ ] 4. tickets.html: empty select placeholder (populated by JS)
- [ ] 5. events.html: dynamic event cards rendered from `/api/events` + dynamic category filter
- [ ] 6. index.html: dynamic featured events from `/api/events`
- [ ] 7. admin.html: Events Manager panel (add form + list + delete) + ensure logout visible
- [ ] 8. my-tickets.html: visible Log Out button + dashboard user bar
- [ ] 9. pending.html: verified message mentions email + dashboard
- [ ] 10. Syntax check `node --check` on changed JS
- [ ] 11. git add / commit / push to `main` → Render auto-deploy

