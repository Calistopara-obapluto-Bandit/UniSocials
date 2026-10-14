import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch, resetManagedPassword } from './adminApi.js';
import { esc, fmtN, fmtDate } from '../../lib/utils.jsx';

// Sub-admins: staff accounts limited to gate check-in and adding events. They
// cannot view orders or manage universities/subscribers. Master admin only.
export default function SubAdminsPanel({ active }) {
  const { showToast } = useAdmin();
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadSubAdmins() {
    try {
      const data = await adminFetch('/api/admin/subadmins');
      setList((data && data.success && data.subadmins) || []);
    } catch (e) { /* keep the last list on a transient failure */ }
  }

  useEffect(() => { loadSubAdmins(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function addSubAdmin() {
    const n = name.trim();
    const e = email.trim();
    const p = password.trim();
    if (!n || !e || !p) { showToast('Name, Email, and Password are required.', true); return; }
    if (p.length < 6) { showToast('Password must be at least 6 characters.', true); return; }
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/subadmins', {
        method: 'POST',
        body: JSON.stringify({ name: n, email: e, password: p })
      });
      if (data && data.success) {
        showToast('Sub-admin "' + n + '" created! Referral code: ' + ((data.subadmin && data.subadmin.referralCode) || '—'));
        setName(''); setEmail(''); setPassword('');
        loadSubAdmins();
      } else {
        showToast((data && data.error) || 'Failed to create sub-admin', true);
      }
    } catch (err) {
      showToast('Network error creating sub-admin', true);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSubAdmin(mail) {
    if (!mail) return;
    if (!window.confirm('Remove sub-admin ' + mail + '? They will no longer be able to sign in.')) return;
    try {
      const data = await adminFetch('/api/admin/subadmins?email=' + encodeURIComponent(mail), {
        method: 'DELETE'
      });
      if (data && data.success) {
        showToast('Sub-admin removed');
        loadSubAdmins();
      } else {
        showToast((data && data.error) || 'Failed to remove sub-admin', true);
      }
    } catch (e) {
      showToast('Network error removing sub-admin', true);
    }
  }

  async function resetPassword(mail) {
    const res = await resetManagedPassword(mail);
    if (!res) return;
    if (res.ok) showToast(res.ok);
    else showToast(res.error, true);
  }

  return (
    <div className={'admin-panel' + (active ? ' active' : '')} id="panel-subadmins">
      <div className="admin-panel-heading">
        <div>
          <h1>🔑 Sub-Admins</h1>
          <p>Create staff accounts that can only do gate check-in and add events. Sub-admins cannot view orders or manage universities/subscribers.</p>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="subName">Full Name</label>
            <input type="text" id="subName" placeholder="e.g. Gate Staff"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="subEmail">Email</label>
            <input type="email" id="subEmail" placeholder="staff@unisocials.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="subPassword">Password</label>
            <input type="password" id="subPassword" placeholder="8+ chars, letter, number & symbol"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-submit" style={{ whiteSpace: 'nowrap' }} disabled={saving} onClick={addSubAdmin}>
            ➕ Create Sub-Admin
          </button>
          <button className="admin-refresh-btn" onClick={loadSubAdmins}>↻ Refresh</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', alignSelf: 'center' }}>
            {list.length} sub-admin{list.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>
              No sub-admins yet. Create your first sub-admin above.
            </div>
          ) : (
            <>
              <div className="admin-ticket-codes-label">🔑 Active Sub-Admins ({list.length})</div>
              {list.map((u) => {
                const id = String(u.id || u._id || u.email || '').replace(/[^a-zA-Z0-9@.\-_]/g, '');
                const stats = u.referralStats || { totalOrders: 0, totalRevenue: 0, totalTickets: 0 };
                const usageText = stats.totalOrders > 0
                  ? 'Used by ' + stats.totalOrders + ' people • Purchases ' + fmtN(stats.totalRevenue)
                  : 'No purchases through this referral yet';
                return (
                  <div className="admin-ticket-code" key={id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
                        <span>👤</span>
                        <strong>{esc(u.name || '—')}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(u.email || '')}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Created {fmtDate(u.createdAt)}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Referral: {esc(u.referralCode || 'No referral link yet')}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>People: {esc(String(stats.uniquePeople || 0))}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Tickets: {esc(String(stats.totalTickets || 0))}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(usageText)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <button className="admin-ticket-copy" onClick={() => resetPassword(u.email || id)} title="Reset password">🔑</button>
                      <button className="admin-ticket-copy" onClick={() => deleteSubAdmin(u.email || id)}
                        title="Remove sub-admin" style={{ color: '#B71C1C', borderColor: '#F5C6CB' }}>✕</button>
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
