import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch, resetManagedPassword } from './adminApi.js';
import { esc, fmtN, fmtDate } from '../../lib/utils.jsx';

// University Sub-Admins: sub-admin accounts authorized for SPECIFIC
// universities. Their entire dashboard (sales, customers, events, referral
// stats) is scoped to the campuses picked here — nothing outside those
// universities is ever visible to them. The existing sub-admin role remains
// the platform-wide "Master Sub-Admin".
export default function UniversitySubAdminsPanel({ active }) {
  const { showToast, universities } = useAdmin();
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [picked, setPicked] = useState({}); // { [uniId]: true }
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadSubAdmins() {
    try {
      const data = await adminFetch('/api/admin/university-subadmins');
      setList((data && data.success && data.subadmins) || []);
    } catch (e) { /* keep the last list on a transient failure */ }
  }

  useEffect(() => { loadSubAdmins(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const uniKey = (u) => String(u.id || u.slug || u.name || '');
  const visibleUniversities = (universities || []).filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return String(u.name || '').toLowerCase().includes(q) ||
      String(u.state || '').toLowerCase().includes(q) ||
      String(u.location || '').toLowerCase().includes(q);
  });

  function toggleUni(id, on) {
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[id] = true; else delete next[id];
      return next;
    });
  }

  async function addSubAdmin() {
    const n = name.trim();
    const e = email.trim();
    const p = password.trim();
    if (!n || !e || !p) { showToast('Name, Email, and Password are required.', true); return; }
    if (p.length < 6) { showToast('Password must be at least 6 characters.', true); return; }
    const universitiesPicked = Object.keys(picked);
    if (!universitiesPicked.length) { showToast('Pick at least one university to authorize this sub-admin for.', true); return; }
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/university-subadmins', {
        method: 'POST',
        body: JSON.stringify({ name: n, email: e, password: p, universities: universitiesPicked })
      });
      if (data && data.success) {
        showToast('University sub-admin "' + n + '" authorized for ' + universitiesPicked.length + ' universities');
        setName(''); setEmail(''); setPassword(''); setPicked({});
        loadSubAdmins();
      } else {
        showToast((data && data.error) || 'Failed to create university sub-admin', true);
      }
    } catch (err) {
      showToast('Network error creating university sub-admin', true);
    } finally {
      setSaving(false);
    }
  }

  // Change an existing account's campuses. The current set is prefilled so a
  // single-campus edit is a one-word change, not a rebuild from scratch.
  async function editUniversities(sub) {
    if (!sub) return;
    const current = (sub.authorizedUniversities || []).map((x) => x.name || x.id).join(', ');
    const input = window.prompt('Universities for ' + sub.email + ' (comma-separated names):', current);
    if (input === null) return;
    const picks = input.split(',').map((s) => s.trim()).filter(Boolean);
    if (!picks.length) { showToast('Keep at least one university.', true); return; }
    try {
      const data = await adminFetch('/api/admin/university-subadmins', {
        method: 'PATCH',
        body: JSON.stringify({ email: sub.email, universities: picks })
      });
      if (data && data.success) {
        showToast('Authorized universities updated');
        loadSubAdmins();
      } else {
        showToast((data && data.error) || 'Failed to update universities', true);
      }
    } catch (e) {
      showToast('Network error updating universities', true);
    }
  }

  async function deleteSubAdmin(mail) {
    if (!mail) return;
    if (!window.confirm('Remove university sub-admin ' + mail + '? They will no longer be able to sign in.')) return;
    try {
      const data = await adminFetch('/api/admin/university-subadmins?email=' + encodeURIComponent(mail), { method: 'DELETE' });
      if (data && data.success) {
        showToast('University sub-admin removed');
        loadSubAdmins();
      } else {
        showToast((data && data.error) || 'Failed to remove university sub-admin', true);
      }
    } catch (e) {
      showToast('Network error removing university sub-admin', true);
    }
  }

  async function resetPassword(mail) {
    const res = await resetManagedPassword(mail);
    if (!res) return;
    if (res.ok) showToast(res.ok);
    else showToast(res.error, true);
  }

  const pickedCount = Object.keys(picked).length;

  return (
    <div className={'admin-panel' + (active ? ' active' : '')} id="panel-university-subadmins">
      <div className="admin-panel-heading">
        <div>
          <h1>🎓 University Sub-Admins</h1>
          <p>Create sub-admin accounts authorized for <strong>specific universities</strong>. Their dashboard (sales, customers, events and referral stats) only ever shows the campuses you authorize here. They sign in at <code>university-subadmin.html</code>.</p>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="usubName">Full Name</label>
            <input type="text" id="usubName" placeholder="e.g. Campus Sub-Admin"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="usubEmail">Email</label>
            <input type="email" id="usubEmail" placeholder="subadmin@unisocials.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="usubPassword">Password</label>
            <input type="password" id="usubPassword" placeholder="8+ chars, letter, number & symbol"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label htmlFor="usubUniSearch">
            Authorize universities <span style={{ opacity: 0.6 }}>— pick one or more campuses{pickedCount ? ' (' + pickedCount + ' picked)' : ''}</span>
          </label>
          <input type="text" id="usubUniSearch" placeholder="Search universities…"
            style={{ marginBottom: 8 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 6 }}>
            {visibleUniversities.length === 0 ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                {universities && universities.length
                  ? 'No universities match your search.'
                  : 'No universities saved yet — add them in the 🏛 Universities tab first.'}
              </span>
            ) : visibleUniversities.map((u) => {
              const id = uniKey(u);
              return (
                <label key={id} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!picked[id]} onChange={(e) => toggleUni(id, e.target.checked)} />
                  <span>{esc(u.name || id)}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-submit" style={{ whiteSpace: 'nowrap' }} disabled={saving} onClick={addSubAdmin}>
            ➕ Create University Sub-Admin
          </button>
          <button className="admin-refresh-btn" onClick={loadSubAdmins}>↻ Refresh</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', alignSelf: 'center' }}>
            {list.length} university sub-admin{list.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>
              No university sub-admins yet. Create your first one above.
            </div>
          ) : (
            <>
              <div className="admin-ticket-codes-label">🎓 Authorized University Sub-Admins ({list.length})</div>
              {list.map((u) => {
                const id = String(u.id || u._id || u.email || '').replace(/[^a-zA-Z0-9@.\-_]/g, '');
                const unis = u.authorizedUniversities || [];
                const st = u.scopedStats || { totalOrders: 0, totalRevenue: 0, totalTickets: 0 };
                return (
                  <div className="admin-ticket-code" key={id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
                        <span>👤</span>
                        <strong>{esc(u.name || '—')}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(u.email || '')}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Created {fmtDate(u.createdAt)}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 8px', alignItems: 'center' }}>
                        {unis.length ? unis.map((x) => (
                          <span key={String(x.id || x.name)} style={{
                            background: 'var(--accent-ghost)', border: '1px solid var(--accent-border)',
                            color: 'var(--accent)', borderRadius: 100, padding: '2px 9px',
                            fontSize: '0.68rem', fontWeight: 700
                          }}>🏛 {esc(x.name || x.id || '')}</span>
                        )) : <span style={{ color: '#E65100', fontSize: '0.72rem' }}>No universities authorized</span>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Referral: {esc(u.referralCode || 'No referral link yet')}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Orders: {Number(st.totalOrders || 0)}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Purchases: {fmtN(st.totalRevenue || 0)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <button className="admin-ticket-copy" onClick={() => editUniversities(u)} title="Change authorized universities">🏛</button>
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
