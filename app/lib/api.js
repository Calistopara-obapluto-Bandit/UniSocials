// Shared API helper for the React pages.
//
// Mirrors window.UNNAuth.authHeaders() from templatemo-622-clearwave.js so the
// React pages authenticate exactly the same way the legacy pages do: the token
// lives in localStorage and is sent as a bearer header.

const TOKEN_KEY = 'unn_auth_token';
const USER_KEY = 'unn_auth_user';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function getCachedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setAuth(token, user) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) { /* storage unavailable — treat as signed out */ }
}

export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {}
}

export function isLoggedIn() {
  return !!getToken();
}

export function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  return headers;
}

// Every API call goes through here so a server error or an offline device
// produces a message the UI can show, instead of an unhandled rejection.
export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
  } catch (e) {
    throw new Error('Cannot reach server. Please check your connection and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('Server returned an invalid response.');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || 'Something went wrong. Please try again.');
  }
  return data;
}