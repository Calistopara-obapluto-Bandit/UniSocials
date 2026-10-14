import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { esc } from '../../lib/utils.jsx';

// Subscribers tab: users who opted in to receive event notifications, filterable
// by university. Creating an event emails that university's subscribers.
export default function SubscribersPanel() {
  const { showToast, universities } = useAdmin();
  const [filterUni, setFilterUni] = useState('');
  const [subs, setSubs] = useState(null);

  async function load(universityId) {
    const id = universityId != null ? universityId : filterUni;
    try {
      const data = await adminFetch('/api/admin/subscribers' +
        (id ? '?universityId=' + encodeURIComponent(id) : ''));
      setSubs((data && data.success && data.subscribers) || []);
    } catch (e) {
      showToast('Network error loading subscribers', true);
    }
  }

  // Fetch once when the tab first mounts (the shell lazy-keeps tabs mounted).
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function changeFilter(id) {
    setFilterUni(id);
    load(id);
  }

  async function removeSubscriber(email) {
    if (!email) return;
    if (!window.confirm('Remove ' + email + ' from all event notifications?')) return;
    try {
      const data = await adminFetch('/api/admin/subscribers', {
        method: 'DELETE',
        body: JSON.stringify({ email })
      });
      if (data && data.success) {
        showToast('Subscriber removed');
        load();
      } else {
        showToast((data && data.error) || 'Failed to remove subscriber', true);
      }
    } catch (e) {
      showToast('Network error removing subscriber', true);
    }
  }

  if (subs === null) {
    return (
      <div className="admin-panel" id="panel-subscribers">
        <SubsHeading filterUni={filterUni} onFilter={changeFilter} onRefresh={() => load()} universities={universities} />
        <div className="admin-scan-panel">
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>Loading subscribers…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-panel" id="panel-subscribers">        <SubsHeading filterUni={filterUni} onFilter={changeFilter} onRefresh={() => load()} universities={universities} />
      <div className="admin-scan-panel">
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {subs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>No subscribers yet.</div>
          ) : (
            <>
              <div className="admin-ticket-codes-label">📧 Subscribers ({subs.length})</div>
              {subs.map((s) => (
                <div className="admin-ticket-code" key={s.email} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 0' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
                    <strong>{esc(s.email)}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(s.universityName || '')}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{(s.eventIds ? s.eventIds.length : 0)} event(s)</span>
                  </div>
                  <button className="admin-ticket-copy" onClick={() => removeSubscriber(s.email)}
                    title="Remove subscriber" style={{ color: '#B71C1C', borderColor: '#F5C6CB' }}>✕</button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SubsHeading({ filterUni, onFilter, onRefresh, universities }) {
  return (
    <>
      <div className="admin-panel-heading">
        <div>
          <h1>📧 Subscribers (Event Notifications)</h1>
          <p>Users who opted in to receive event notifications. When you create an event, subscribers of that university are emailed automatically.</p>
        </div>
      </div>
      <div className="admin-scan-panel" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 4 }}>
          <div className="admin-cat-filter" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="subFilterUni">Filter by University</label>
            <select id="subFilterUni" value={filterUni} onChange={(e) => onFilter(e.target.value)}>
              <option value="">All Universities</option>
              {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button className="admin-refresh-btn" onClick={onRefresh}>↻ Refresh</button>
        </div>
      </div>
    </>
  );
}
