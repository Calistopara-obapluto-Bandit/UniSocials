# Task Implementation TODO

## Feature 1: "What's Included" per ticket tier (Admin + Sub-Admin editable)

- [x] server.js: accept `includedRegular`, `includedVip`, `includedTable` fields in `/api/admin/events` POST and store them on the event
- [x] admin.html: add 3 "What's included" text inputs to Events panel + include in `addEventItem()`
- [x] subadmin.html: add 3 "What's included" text inputs to Events panel + include in `addEventItem()`
- [x] tickets.html: show "what's included" per tier in the pricing table
- [x] checkout.html: show selected tier's "what's included" in summary
- [x] ticket.html: show selected tier's "what's included" on the ticket

## Feature 2: Sub-Admin + Admin check-in shows full ticket details

- [x] server.js `/api/ticket/scan`: return detailed ticket info (event, date, venue, qty, amount, tier, buyer, ticket index/total, verified time, checkedInBy)
- [x] subadmin.html `scanTicket()`: render detailed ticket info box
- [x] admin.html `scanTicket()`: render detailed ticket info box

## Feature 3: University-scoped checkout

- [x] tickets.html: persist/use selected campus to filter events + store university in checkoutData
- [x] templatemo-622-clearwave.js: include university fields in `checkoutData` and pass to `/api/orders`
- [x] server.js: store `universityId`/`universityName`/`universitySlug` on the order
- [x] my-tickets.html: filter student's tickets by their selected campus

## Feature 4: Deploy to GitHub + Render

- [ ] Commit all changes and push to `main` on GitHub
- [ ] Provide Render connection instructions (render.yaml blueprint auto-deploy)
