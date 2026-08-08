# Task: Make "What's Included" show on tickets

Bug: "What's Included" data is captured in admin and stored on events, but never
flows through to the buyer's digital ticket.

## Steps
- [x] 1. tickets.html — populate `data-included-*` attributes + render real included in pricing table
- [x] 2. templatemo-622-clearwave.js — pass included data through checkoutData + createOrderViaApi
- [x] 3. server.js — store `included` on order (`/api/orders`) and return it (`/api/ticket`)
- [x] 4. ticket.html — add & render "What's Included" section on the ticket
- [x] 5. Rebuild assets/min/templatemo-622-clearwave.min.js (`npm run build`)
- [ ] 6. Commit to GitHub
