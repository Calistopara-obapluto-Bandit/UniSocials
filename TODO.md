# TODO — Remove FAQ from header nav + verify admin + deploy

## Goals
1. Remove the **FAQ link from the header navigation** (desktop top nav + mobile menu) on all pages, while keeping the FAQ page accessible via the footer.
2. Verify the admin dashboard can add events to universities (Events Manager) and verify all pages work.
3. Push to git and deploy to Render.

## ✅ Done
- [x] Analyze project structure and understand nav pattern across all pages
- [x] Confirm admin Events Manager (add event per university) is implemented in admin.html + server.js
- [x] Remove FAQ link from desktop nav + mobile menu on all 13 HTML pages
- [x] Verify admin event-adding works (tested POST/DELETE /api/admin/events with universityId + universitySlug)
- [x] Confirm server runs and `/api/universities` + `/api/events` respond correctly
- [x] Commit changes and push to git
- [ ] Deploy to Render (auto via render.yaml branch main)
