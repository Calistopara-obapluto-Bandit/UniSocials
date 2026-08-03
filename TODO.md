# Unisocials — Current Task TODO

## Goal
Make the home page events fully dynamic (admin add/delete from the dashboard reflects on Home, Events, and Tickets pages), delete related tickets/orders when an event is deleted, then push to GitHub and deploy on Render.

## Steps
- [x] 1. index.html: add IDs to hero "Next Big Event" card (icon, sub, date)
- [x] 2. index.html: dynamic featured events loader from `/api/events` (render featured events or first 3; graceful fallback)
- [x] 3. tickets.html: remove static fallback options even when event list is empty (so deleted events never reappear)
- [x] 4. server.js: deleting an event also removes all related orders/tickets (returns `ordersDeleted` count)
- [x] 5. admin.html: show "related orders removed" message on event delete + refresh orders list
- [x] 6. Syntax check `node --check server.js` — passed
- [x] 7. git add / commit / push to `main` → Render auto-deploy triggered

