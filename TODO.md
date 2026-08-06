# Unisocials — Client Fixes TODO

## Tasks
- [x] 1. Server: /api/stats (live events, tickets sold, faculties) — already in server.js
- [x] 2. Server: /api/orders/lookup shows details w/o sign-in, hides codes unless owner — already in server.js
- [x] 3. Server: /api/subadmin/checkins + /api/ticket/scan records checkedInBy — already in server.js
- [x] 4. index.html — wire hero + stats counters to /api/stats (live numbers)
- [x] 5. events.html — show month-by-month count of events happening each month (when events are added)
- [x] 6. my-tickets.html — remove forced login redirect on lookup; show details + "sign in to view QR/code" prompt if not the owner
- [x] 7. subadmin.html — add "My Check-ins / Overview" tab (who the sub-admin checked in)
- [x] 8. Rebuild minified JS (npm run build)
- [x] 9. Stage, commit, push to GitHub (origin/main) to trigger Render deploy

