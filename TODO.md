# TODO — Fix events showing correctly per university in checkout flow

## Steps
1. [x] Add `universityId`, `universityName`, `universitySlug` fields to each `DEFAULT_EVENTS` entry in `server.js` (associate with UNN).
2. [x] Seed the events database table with `DEFAULT_EVENTS` when empty (PostgreSQL mode), so events are available server-side.
3. [x] Update `data/events.json` with the same university fields for JSON-file storage mode.
4. [x] Verify `/api/events?university=unn` returns the events.
5. [x] Commit changes to GitHub and redeploy to Render.

## Extra (seed DB)
- [x] Added `data/events_seed.sql` — a ready-to-run PostgreSQL seed script that creates the `events` table (if missing) and upserts the 6 default UNN events with full data (including university fields).
- [x] Confirmed `data/events.json` now matches `DEFAULT_EVENTS` in `server.js` (added `vvipPrice`/`tablePrice` where defined, plus university fields).
