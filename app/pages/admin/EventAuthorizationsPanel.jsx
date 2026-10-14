import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { esc } from '../../lib/utils.jsx';

// Authorize Events tab: assign a specific existing event to a specific
// Influencer Admin, plus the reduced 15% commission-split controls.
export default function EventAuthorizationsPanel() {
  const { showToast, events, loadEvents } = useAdmin();
  const [staff, setStaff] = useState([]);
  const [eventId, setEventId] = useState('');
  const [adminId, setAdminId] = useState('');
  const [status, setStatus] = useState('Select an existing event and an Influencer Admin, then authorize.');
  const [saving, setSaving] = useState(false);

  async function loadStaff() {
    try {
      const data = await adminFetch('/api/admin/staff');
      const all = (data && data.success && data.staff) || [];
      setStaff(all.filter((u) => u.role === 'influencer_admin' && !u.archived));
    } catch (e) {
      showToast('Unable to load event authorizations.', true);
    }
  }

  useEffect(() => {
    loadStaff();
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function authorize() {
    if (!eventId || !adminId) {
      setStatus('Select both an existing event and an Influencer Admin.');
      showToast('Select both an existing event and an Influencer Admin.', true);
      return;
    }
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/events/authorize-influencer', {
        method: 'POST',
        body: JSON.stringify({ eventId, influencerAdminId: adminId, action: 'add' })
      });
      if (!data || !data.success) throw new Error((data && data.error) || 'Authorization failed');
      setStatus('Event authorized successfully. The Influencer Admin can now oversee this event.');
      showToast('Event authorized successfully.');
      loadEvents();
    } catch (e) {
      setStatus(e.message);
      showToast(e.message, true);
    } finally {
      setSaving(false);
    }
  }

  async function removeAuthorization(evId, sid) {
    if (!window.confirm('Remove this event authorization?')) return;
    try {
      const data = await adminFetch('/api/admin/events/authorize-influencer', {
        method: 'POST',
        body: JSON.stringify({ eventId: evId, influencerAdminId: sid, action: 'remove' })
      });
      if (!data || !data.success) throw new Error((data && data.error) || 'Could not remove authorization');
      showToast('Authorization removed.');
      loadEvents();
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function togglePlan(ev) {
    const id = String(ev.id || ev._id || '');
    const current = String(ev.commissionPlan || 'standard');
    const next = current === 'reduced_15' ? 'standard' : 'reduced_15';
    const msg = next === 'reduced_15'
      ? 'Authorize the reduced 15% split for this event?\n\nFuture DIRECT sales will split 15% Unisocials / 85% owner. Referred sales stay 2.5/20/77.5. Sales already verified keep their current split.'
      : 'Restore the standard 20% split for this event?\n\nFuture direct sales go back to 20% Unisocials / 80% owner. Sales already verified keep their current split.';
    if (!window.confirm(msg)) return;
    try {
      const data = await adminFetch('/api/admin/events/commission-plan', {
        method: 'POST',
        body: JSON.stringify({ eventId: id, plan: next }),
        credentials: 'same-origin'
      });
      if (data && data.success) {
        showToast(data.message || (next === 'reduced_15' ? 'Reduced 15% split authorized.' : 'Standard 20% split restored.'));
        loadEvents();
      } else {
        showToast((data && data.error) || 'Could not change the commission plan', true);
      }
    } catch (e) {
      showToast('Network error changing the commission plan', true);
    }
  }

  return (
    <div className="admin-panel" id="panel-event-authorizations">
      <div className="admin-panel-heading">
        <div>
          <h1>🔐 Authorize Events</h1>
          <p>Assign a specific existing event to a specific Influencer Admin. This controls which event sales that Influencer Admin can oversee.</p>
        </div>
        <button className="admin-refresh-btn" type="button" onClick={() => { loadEvents(); loadStaff(); }}>↻ Refresh</button>
      </div>
      <div className="admin-scan-panel" style={{ border: '2px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, alignItems: 'end' }}>
          <div className="form-group">
            <label htmlFor="authEventSelect">Existing Event</label>
            <select id="authEventSelect" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Select event…</option>
              {events.map((e) => (
                <option key={String(e.id || e._id)} value={String(e.id || e._id)}>{esc(e.name || e.id)}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="authInfluencerAdminSelect">Influencer Admin</label>
            <select id="authInfluencerAdminSelect" value={adminId} onChange={(e) => setAdminId(e.target.value)}>
              <option value="">Select Influencer Admin…</option>
              {staff.map((u) => (
                <option key={String(u.id)} value={String(u.id)}>
                  {esc(u.name || u.email)} — {esc(u.email || '')}
                </option>
              ))}
            </select>
          </div>
          <button id="authorizeEventBtn" className="btn-submit" type="button" disabled={saving} onClick={authorize}>
            🔐 Authorize Event
          </button>
        </div>
        <div style={{ marginTop: 10, color: 'var(--text-3)', fontSize: '.85rem' }}>{status}</div>
      </div>

      <div className="admin-scan-panel" style={{ marginTop: 16 }}>
        <div className="admin-panel-heading" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ fontSize: '1rem' }}>Current Event Authorizations</h2>
            <p>These are the assignments currently saved for existing events.</p>
          </div>
        </div>
        <div>
          {(() => {
            const rows = [];
            events.forEach((e) => {
              const ids = Array.isArray(e.authorizedInfluencerAdminIds) ? e.authorizedInfluencerAdminIds : [];
              ids.forEach((sid) => {
                const u = staff.find((x) => String(x.id) === String(sid));
                rows.push(
                  <div key={String(e.id || e._id) + ':' + String(sid)}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>
                      <strong>{esc(e.name || e.id)}</strong><br />
                      <small style={{ color: 'var(--text-3)' }}>Authorized to {esc(u ? (u.name || u.email) : sid)}</small>
                    </span>
                    <button className="admin-filter-btn" onClick={() => removeAuthorization(String(e.id || e._id), String(sid))}>
                      Remove
                    </button>
                  </div>
                );
              });
            });
            return rows.length
              ? rows
              : <div style={{ color: 'var(--text-3)', fontSize: '.85rem', padding: '12px 0' }}>No event authorizations yet.</div>;
          })()}
        </div>
      </div>

      <div className="admin-scan-panel" style={{ marginTop: 16 }}>
        <div className="admin-panel-heading" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ fontSize: '1rem' }}>💰 Reduced 15% Commission Split</h2>
            <p>
              Authorize the reduced platform fee for an event: future <strong>direct</strong> sales split 15% Unisocials /
              85% event owner instead of the standard 20/80. Referred sales always stay 2.5% / 20% / 77.5%. Only sales
              verified from the moment you authorize earn the new rate — sales already verified keep their original split.
            </p>
          </div>
          <button className="admin-refresh-btn" type="button" onClick={loadEvents}>↻ Refresh</button>
        </div>
        <div>
          {events.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: '.85rem', padding: '12px 0' }}>
              No events yet. Add an event in the Events tab first.
            </div>
          ) : events.map((ev) => {
            const id = String(ev.id || ev._id || '');
            const reduced = String(ev.commissionPlan || 'standard') === 'reduced_15';
            return (
              <div key={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong>{esc(ev.name || id)}</strong>
                  <small style={{ color: 'var(--text-3)' }}>
                    {reduced ? '💰 15% Unisocials / 85% owner (direct sales)' : 'Standard: 20% Unisocials / 80% owner'}
                  </small>
                </span>
                <button type="button" className="admin-filter-btn" onClick={() => togglePlan(ev)}>
                  {reduced ? 'Revoke — use standard 20%' : 'Authorize 15% split'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
