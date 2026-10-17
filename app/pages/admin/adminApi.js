// Admin-session helper for the React admin dashboard.
//
// The master-admin dashboard authenticates differently from the customer app:
// the admin password itself is used as a bearer token and it lives in
// sessionStorage (key `unn_admin_token`), kept deliberately separate from the
// customer session (`unn_auth_token` in localStorage). This mirrors
// admin.html's getToken()/setToken()/clearToken() exactly so both versions of
// the dashboard share one session and one sign-out path.

const ADMIN_TOKEN_KEY = 'unn_admin_token';
const ADMIN_USER_KEY = 'unn_admin_user';

let unauthorizedHandler = null;

// Registered once by the Admin shell so any 401 anywhere clears the session and
// returns the UI to the login card, exactly like the legacy page did.
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export function getAdminToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setAdminToken(token) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch (e) { /* storage unavailable — stay logged out */ }
}

export function clearAdminToken() {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch (e) {}
}

// The stored profile is optional; the top bar falls back to "Main Admin".
export function getAdminUser() {
  try {
    const raw = localStorage.getItem(ADMIN_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearAdminUser() {
  try {
    sessionStorage.removeItem(ADMIN_USER_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
  } catch (e) {}
}

export function adminHeaders(extra) {
  const h = { 'Content-Type': 'application/json', ...(extra || {}) };
  const t = getAdminToken();
  if (t) h.Authorization = 'Bearer ' + t;
  return h;
}

// Fetch JSON with admin auth attached. A 401 clears the session and shows the
// login card, then resolves with `{ __unauthorized: true, ... }` so callers can
// render an "expired session" message instead of an empty list. Other responses
// resolve to the parsed body; network/parse failures reject with a message the
// UI can surface.
export async function adminFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: adminHeaders(options.headers)
    });
  } catch (e) {
    throw new Error('Cannot reach server. Check your connection and try again.');
  }

  if (res.status === 401) {
    clearAdminToken();
    if (unauthorizedHandler) unauthorizedHandler();
    const body = await res.json().catch(() => null);
    return { __unauthorized: true, ...(body || {}) };
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('Server returned an invalid response.');
  }
  return data;
}

// The four platform-split plans for DIRECT sales (Main Admin only). A sale
// through an influencer's link keeps the normal influencer split (2.5% / 20% /
// 77.5%) on every plan. Mirrors the legacy admin's plan list.
export const COMMISSION_PLANS = [
  { value: 'standard', fee: 20, owner: 80, label: 'Standard: 20% Unisocials / 80% owner' },
  { value: 'reduced_15', fee: 15, owner: 85, label: '15% Unisocials / 85% owner (direct sales)' },
  { value: 'reduced_13', fee: 13, owner: 87, label: '13% Unisocials / 87% owner (direct sales)' },
  { value: 'reduced_10', fee: 10, owner: 90, label: '10% Unisocials / 90% owner (direct sales)' }
];

export function planInfo(value) {
  return COMMISSION_PLANS.find((p) => p.value === String(value || 'standard')) || COMMISSION_PLANS[0];
}

// Ask, then move an event onto the chosen split plan. `reload` re-renders the
// caller's list once the server confirms (or refuses).
export async function changeCommissionPlan(eventId, next, showToast, reload) {
  if (!eventId) return;
  const target = planInfo(next);
  const confirmMsg = target.value === 'standard'
    ? 'Restore the standard 20% split for this event?\n\nFuture DIRECT sales go back to 20% Unisocials / 80% owner. Sales already verified keep their current split.'
    : 'Use the ' + target.fee + '% split for this event?\n\nFuture DIRECT sales will split ' + target.fee + '% Unisocials / ' + target.owner + '% owner. Referred sales keep the normal influencer split (2.5% / 20% / 77.5%). Sales already verified keep their current split.';
  if (!window.confirm(confirmMsg)) { if (typeof reload === 'function') reload(); return; }
  try {
    const data = await adminFetch('/api/admin/events/commission-plan', {
      method: 'POST',
      body: JSON.stringify({ eventId, plan: target.value }),
      credentials: 'same-origin'
    });
    if (data && data.success) {
      showToast(data.message || ('Split updated to ' + target.fee + '% Unisocials / ' + target.owner + '% owner.'));
    } else {
      showToast((data && data.error) || 'Could not change the commission plan', true);
    }
  } catch (e) {
    showToast('Network error changing the commission plan', true);
  }
  if (typeof reload === 'function') reload();
}

// Shared "reset password" flow for every managed account type (sub-admins,
// influencers and staff all use the same endpoint). Ported from admin.html's
// resetManagedPassword(): two prompts (new + confirm), then a single POST.
export async function resetManagedPassword(email) {
  if (!email) return;
  const first = window.prompt('Enter a new password for ' + email + ' (8+ chars, letter, number & symbol):');
  if (first === null) return;
  const password = String(first).trim();
  if (password.length < 6) return { error: 'Password must be at least 6 characters.' };
  const second = window.prompt('Confirm the new password:');
  if (second === null) return;
  if (password !== String(second)) return { error: 'Passwords do not match.' };
  try {
    const data = await adminFetch('/api/admin/account-password', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (data && data.success) return { ok: 'Password reset successfully. The account must log in again.' };
    return { error: (data && data.error) || 'Failed to reset password' };
  } catch (e) {
    return { error: 'Network error resetting password' };
  }
}
