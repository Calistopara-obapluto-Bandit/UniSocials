# Unisocials — Feature Implementation TODO

## Task
1. Require sign-in to view tickets (protect ticket codes + QR).
2. Forgot password via OTP email.
3. Sub-admin role (check-in + add events) managed by master admin.

## Steps

### A. server.js — Backend
- [x] Add `role` field to users (default `buyer`). Include `role` in `publicUser`.
- [x] Add OTP fields to user storage + helper functions (generate OTP, expiry).
- [x] Add `POST /api/auth/forgot`, `POST /api/auth/verify-otp`, `POST /api/auth/reset-password`.
- [x] Protect `/api/ticket`, `/api/orders/lookup`, `/api/orders/status` to require login + ownership.
- [x] Add `isAdminOrSubadmin(req)` helper (master password OR subadmin session).
- [x] Use isAdminOrSubadmin for `/api/ticket/scan` and `POST /api/admin/events`.
- [x] Add sub-admin management endpoints: `POST/GET/DELETE /api/admin/subadmins` (master only).

### B. Public pages — ticket protection
- [x] `ticket.html`: redirect to login if not logged in; send Bearer token.
- [x] `my-tickets.html`: lookup requires login; redirect to login if not.
- [x] `pending.html`: poll with auth; require login to reveal ticket codes.

### C. Forgot password pages
- [x] Create `forgot-password.html` (enter email → send OTP).
- [x] Create `reset-password.html` (enter OTP + new password).
- [x] `login.html`: add "Forgot your password?" link.

### D. admin.html — sub-admin UI
- [x] Add sub-admin login option (email + password).
- [x] Sub-admins see only Check-in + Events tabs.
- [x] Add "Sub Admins" management UI (master admin only).

### E. Verify & test
- [x] Check server starts without errors (`node --check server.js` → SERVER_SYNTAX_OK).
</content>
