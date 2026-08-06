# Unisocials — VIP/Table (VVIP & Table) Ticket Tier Fix

## Tasks
- [ ] 1. tickets.html — set `data-vvip-price`/`data-table-price` on each dynamic event `<option>`
- [ ] 2. tickets.html — add Ticket Type selector UI (Regular / VIP / Table) with live price
- [ ] 3. server.js — add sensible `vvipPrice`/`tablePrice` to `DEFAULT_EVENTS`
- [ ] 4. server.js — store `ticketTier` on the order object in `/api/orders`
- [ ] 5. templatemo-622-clearwave.js — pass `ticketTier` in order payload; wire tier selector to refresh price
- [ ] 6. Add CSS for ticket-type selector cards
- [ ] 7. Rebuild minified JS (npm run build)
- [ ] 8. Verify server starts without errors
- [ ] 9. Stage, commit, push to GitHub (origin) to trigger Render deploy

