// React-side event notification helper for the Events page.
// Replaces the legacy page's reliance on legacy JS (window.UNNotify) so the
// React /events route no longer needs the site-wide templatemo-622-clearwave JS
// just to subscribe users to event notifications.

const SUBSCRIBE_URL = '/api/subscribe';

export async function subscribeToEvent({ email, universityId, universityName, eventId }) {
  if (!email || !universityId) {
    return { ok: false, error: 'Select your campus first' };
  }

  const res = await fetch(SUBSCRIBE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      universityId,
      universityName: universityName || '',
      source: 'button'
    })
  });

  const data = await res.json();
  if (data && data.success) {
    return { ok: true, data };
  }

  return {
    ok: false,
    error: (data && data.error) || 'subscribe failed',
    status: res.status
  };
}
