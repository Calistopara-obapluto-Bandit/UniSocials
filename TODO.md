# TODO — Sub-Admin dedicated page + logout fix + Render deploy

## Status: All implementation steps complete ✅

## Steps
- [x] 1. Create `subadmin.html` — dedicated sub-admin page (login + Check-in + Events only)
- [x] 2. Edit `admin.html` — make it master-admin only, remove sub-admin login toggle
- [x] 3. Edit `admin.html` — fix the 30s auto-refresh logout bug (sub-admin no longer shares this page)
- [x] 4. Edit `admin.html` — add link to the new sub-admin page
- [x] 5. Verify `render.yaml` + package.json for Render deployment via GitHub (verified — no changes needed)
- [x] 6. Test locally with `npm start` (server boots; /, /admin.html, /subadmin.html, /api all return HTTP 200)
- [ ] 7. User action: push to GitHub and connect to Render (see below)

---

## What was done

### 1. Root cause of "sub-admin logs out by itself"
The sub-admin and master admin shared `admin.html`. The 30-second auto-refresh interval called
`loadOrders()` → `/api/admin/orders` (master-only). A sub-admin has no master token, so the server
returned **401**, and the code called `clearToken()` + `showLoggedOut()` — kicking the sub-admin out
every 30 seconds.

### 2. Fix
- **New `subadmin.html`** — a dedicated page for sub-admins with only **Check-in 🎫** and **Events 🎤** tabs.
  - Logs in via `/api/auth/login` (email + password), stores token in `localStorage`.
  - Auto-refresh only refreshes events/universities — it never calls master-only endpoints, so no more self-logout.
- **`admin.html`** — now master-admin only:
  - Removed the sub-admin login mode toggle and all sub-admin login logic.
  - Only the admin password login remains.
  - Added a link to `subadmin.html` on the login screen.
  - Kept the 🔑 Sub-Admins management panel (create/delete sub-admin accounts).

### 3. Render deployment via GitHub
Deployment config is already correct and verified:
- `render.yaml` → web service, Node runtime, `npm install` / `npm start`, branch `main`.
- `package.json` → `start: node server.js`, `engines.node >= 18`.
- Persistent storage: PostgreSQL via `DATABASE_URL`, or JSON files in `./data` as fallback.

### Steps to deploy on Render (user action)
1. Create a GitHub repo and push this folder (make sure `.env` and `data/` are gitignored).
2. In Render dashboard → **New → Web Service**.
3. Connect your GitHub repo (branch `main`).
4. Runtime: **Node** · Build: `npm install` · Start: `npm start`.
5. Add env vars in **Environment** (dashboard only — never commit):
   - `ADMIN_PASSWORD` (your real admin password)
   - `DATABASE_URL` (optional, for persistent storage — recommended)
   - `RESEND_API_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `EMAIL_FROM`
   - `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`
6. Deploy. Sub-admins now log in at **`/subadmin.html`**; the master admin at `/admin.html`.
