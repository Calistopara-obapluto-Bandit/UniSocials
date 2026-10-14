import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch, resetManagedPassword } from './adminApi.js';
import { esc, fmtN } from '../../lib/utils.jsx';

// Influencers: create influencer login accounts. Assigning events to an
// Influencer Admin happens on the Authorize Events tab, so this panel links
// straight to it, exactly like the legacy page.
export default function InfluencersPanel({ active }) {
  const { showToast, switchTab } = useAdmin();
  const [list, setList] = useState([]);
  const [overall, setOverall] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Platform-wide task-link and referral totals, sub-admins included. The
  // per-influencer numbers below are the same figures scoped to one account.
  async function loadOverall() {
    try {
      const data = await adminFetch('/api/admin/task-links');
      if (data && data.success) setOverall(data);
    } catch (e) { /* the panel still works without the totals */ }
  }

  async function loadInfluencers() {
    try {
      const data = await adminFetch('/api/admin/influencers');
      setList((data && data.success && data.influencers) || []);
    } catch (e) { /* keep the last list on a transient failure */ }
  }

  useEffect(() => {
    loadInfluencers();
    loadOverall();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  async function addInfluencer() {
    const n = name.trim();
    const e = email.trim();
    const p = password.trim();
    if (!n || !e || !p) { showToast('Name, Email, and Password are required.', true); return; }
    if (p.length < 6) { showToast('Password must be at least 6 characters.', true); return; }
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/influencers', {
        method: 'POST',
        body: JSON.stringify({ name: n, email: e, password: p })
      });
      if (data && data.success) {
        showToast('Influencer created! Referral code: ' + ((data.influencer && data.influencer.referralCode) || '—'));
        setName(''); setEmail(''); setPassword('');
        loadInfluencers();
      } else {
        showToast((data && data.error) || 'Failed to create influencer', true);
      }
    } catch (err) {
      showToast('Network error creating influencer', true);
    } finally {
      setSaving(false);
    }
  }

  async function deleteInfluencer(mail) {
    if (!mail || !window.confirm('Remove influencer ' + mail + '? They will no longer be able to sign in.')) return;
    try {
      const data = await adminFetch('/api/admin/influencers?email=' + encodeURIComponent(mail), {
        method: 'DELETE'
      });
      if (data && data.success) {
        showToast('Influencer removed');
        loadInfluencers();
      } else {
        showToast((data && data.error) || 'Failed to remove influencer', true);
      }
    } catch (e) {
      showToast('Network error removing influencer', true);
    }
  }

  async function resetPassword(mail) {
    const res = await resetManagedPassword(mail);
    if (!res) return;
    if (res.ok) showToast(res.ok);
    else showToast(res.error, true);
  }

  return (
    <div className={'admin-panel' + (active ? ' active' : '')} id="panel-influencers">
      <div className="admin-panel-heading">
        <div>
          <h1>📣 Influencers</h1>
          <p>Create influencer login accounts and assign specific existing events to Influencer Admins.</p>
        </div>
      </div>
      <div className="admin-scan-panel" style={{ marginBottom: 16, border: '2px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 4px' }}>🔐 Event Authorization</h2>
            <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '.84rem' }}>
              Choose the exact existing event and the exact Influencer Admin who should oversee its ticket sales.
            </p>
          </div>
          <button className="btn-submit" type="button" onClick={() => switchTab('event-authorizations')}>
            🔐 Authorize Event
          </button>
        </div>
      </div>
      <div className="admin-scan-panel" style={{ marginBottom: 16 }}>
        <div className="admin-ticket-codes-label">🔗 Task referral links — overall</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: '.84rem', color: 'var(--text-2)' }}>
          <span>🛒 Purchases: <strong>{overall ? String(overall.task.purchases) : '—'}</strong></span>
          <span>🎟 Tickets: <strong>{overall ? String(overall.task.tickets) : '—'}</strong></span>
          <span>💰 Revenue: <strong>{overall ? fmtN(overall.task.revenue) : '—'}</strong></span>
          <span>📣 Influencers with a task link: <strong>{overall ? String(overall.task.influencers) : '—'}</strong></span>
        </div>
        <div className="admin-ticket-codes-label" style={{ marginTop: 14 }}>
          🎁 Referral links — overall (influencers + sub-admins)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: '.84rem', color: 'var(--text-2)' }}>
          <span>Orders: <strong>{overall ? String(overall.referral.totalOrders) : '—'}</strong></span>
          <span>Revenue: <strong>{overall ? fmtN(overall.referral.totalRevenue) : '—'}</strong></span>
          <span>
            Sub-admins: <strong>{overall ? String(overall.referral.subadmin.orders) : '—'}</strong> orders ·{' '}
            {overall ? fmtN(overall.referral.subadmin.revenue) : '—'}
          </span>
          <span>
            Influencers: <strong>{overall ? String(overall.referral.influencer.orders) : '—'}</strong> orders ·{' '}
            {overall ? fmtN(overall.referral.influencer.revenue) : '—'}
          </span>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="infName">Full Name</label>
            <input type="text" id="infName" placeholder="e.g. John Influencer"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="infEmail">Login Email</label>
            <input type="email" id="infEmail" placeholder="influencer@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="infPassword">Password</label>
            <input type="password" id="infPassword" placeholder="8+ chars, letter, number & symbol"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-submit" style={{ whiteSpace: 'nowrap' }} disabled={saving} onClick={addInfluencer}>
            ➕ Create Influencer
          </button>
          <button className="admin-refresh-btn" onClick={loadInfluencers}>↻ Refresh</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', alignSelf: 'center' }}>
            {list.length} influencer{list.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>
              No influencers yet. Create your first influencer above.
            </div>
          ) : (
            <>
              <div className="admin-ticket-codes-label">📣 Active Influencers ({list.length})</div>
              {list.map((u) => {
                const stats = u.referralStats || {};
                const task = u.taskLink || {};
                return (
                  <div className="admin-ticket-code" key={u.email || u.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
                        <span>📣</span>
                        <strong>{esc(u.name || '—')}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(u.email || '')}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Referral: <strong>{esc(u.referralCode || '—')}</strong></span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>People: {esc(String(stats.uniquePeople || 0))}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Tickets: {esc(String(stats.totalTickets || 0))}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Revenue: {fmtN(stats.totalRevenue || 0)}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Task link: <strong>{esc(task.code || '—')}</strong></span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 700 }}>
                          🛒 Task purchases: {esc(String(task.purchases || 0))}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Tickets: {esc(String(task.tickets || 0))}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Revenue: {fmtN(task.revenue || 0)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <button className="admin-ticket-copy" onClick={() => resetPassword(u.email || '')} title="Reset password">🔑</button>
                      <button className="admin-ticket-copy" onClick={() => deleteInfluencer(u.email || '')}
                        title="Remove influencer" style={{ color: '#B71C1C', borderColor: '#F5C6CB' }}>✕</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
