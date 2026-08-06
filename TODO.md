# Unisocials — Task TODO

## 1. Fix sub-admin reload logout bug
- [ ] `admin.html`: Restore sub-admin session from localStorage on page reload (initial-state check).

## 2. Add VVIP & Table pricing to events
- [ ] `server.js`: Accept `vvipPrice` and `tablePrice` in `POST /api/admin/events`.
- [ ] `admin.html`: Add VVIP Price and Table Price fields to the event form; include them in `addEventItem()`.
- [ ] `tickets.html`: Add ticket-type selector UI (Regular / VVIP / Table).
- [ ] `templatemo-622-clearwave.js`: Ticket selection step — add ticket-type selector logic, store chosen type + unit price; update checkout summary to use selected type price.
- [ ] `events.html`: Show price range on event cards when VVIP/Table pricing is set (optional polish).

## 3. Deploy to GitHub
- [ ] Commit all changes.
- [ ] Push to `origin` (`main` branch).
