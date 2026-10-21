import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch, resetManagedPassword } from './adminApi.js';
import { esc, fmtN, fmtDate } from '../../lib/utils.jsx';

// Workers: the Main Admin creates these accounts. Workers pay nothing — they
// sell through their own task link, each completed 150-sales monthly quota
// block (sales above 150 roll into the next month) earns ₦25,000 salary, and a
// salary request is allowed once every 3 weeks. Salary requests arrive in the
// Payout Requests panel like every other payout.
export default function WorkersPanel({ active }) {
  const { showToast, universities } = useAdmin();
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [password, setPassword] = useState('');
  const [picked, setPicked] = useState({}); // { [uniId]: true }
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadWorkers() {
    try {
      const data = await adminFetch('/api/admin/workers');
      setList((data && data.success && data.workers) || []);
    } catch (e) { /* keep the last list on a transient failure */ }
  }

  useEffect(() => { loadWorkers(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // A worker is authorized for SPECIFIC universities: the sub-admin of that
  // campus settles their salary, so the campuses are picked at creation.
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

  async function addWorker() {
    const n = name.trim();
    const e = email.trim();
    const c = contactEmail.trim();
    const p = password.trim();
    if (!n || !e || !p) { showToast('Name, Email, and Password are required.', true); return; }
    if (p.length < 6) { showToast('Password must be at least 6 characters.', true); return; }
    const campuses = Object.keys(picked);
    if (!campuses.length) { showToast('Authorize this worker for at least one university — that campus’s sub-admin settles their salary.', true); return; }
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/workers', {
        method: 'POST',
        body: JSON.stringify({ name: n, email: e, contactEmail: c, password: p, universities: campuses })
      });
      if (data && data.success) {
        showToast('Worker "' + n + '" created — they sign in at worker.html');
        setName(''); setEmail(''); setContactEmail(''); setPassword(''); setPicked({});
        loadWorkers();
      } else {
        showToast((data && data.error) || 'Failed to create worker', true);
      }
    } catch (err) {
      showToast('Network error creating worker', true);
    } finally {
      setSaving(false);
    }
  }

  async function deleteWorker(mail) {
    if (!mail) return;
    if (!window.confirm('Remove worker ' + mail + '? They will no longer be able to sign in. Their sales and salary history are kept.')) return;
    try {
      const data = await adminFetch('/api/admin/workers?email=' + encodeURIComponent(mail), { method: 'DELETE' });
      if (data && data.success) {
        showToast('Worker removed');
        loadWorkers();
      } else {
        showToast((data && data.error) || 'Failed to remove worker', true);
      }
    } catch (e) {
      showToast('Network error removing worker', true);
    }
  }

  async function resetPassword(mail) {
    const res = await resetManagedPassword(mail);
    if (!res) return;
    if (res.ok) showToast(res.ok);
    else showToast(res.error, true);
  }

  return (
    <div className={'admin-panel' + (active ? ' active' : '')} id="panel-workers">
      <div className="admin-panel-heading">
        <div>
          <h1>💼 Workers</h1>
          <p>Workers pay nothing — they sell through their own task link. Each completed <strong>150-sales monthly quota</strong> (sales above 150 roll into the next month) earns <strong>₦25,000 salary</strong>, requestable once every 3 weeks. Salary requests arrive in 💰 Payout Requests. They sign in at <code>worker.html</code>.</p>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="workerName">Full Name</label>
            <input type="text" id="workerName" placeholder="e.g. Wale Worker"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="workerEmail">Login Email</label>
            <input type="email" id="workerEmail" placeholder="worker@unisocials.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="workerContactEmail">Real Email <span style={{ opacity: 0.6 }}>— optional</span></label>
            <input type="email" id="workerContactEmail" placeholder="e.g. wale@gmail.com"
              value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-3)' }}>
              Where they receive their <strong>salary paid</strong> email. A <code>@unisocials.com</code> login cannot receive mail.
            </p>
          </div>
          <div className="form-group">
            <label htmlFor="workerPassword">Password</label>
            <input type="password" id="workerPassword" placeholder="8+ chars, letter, number & symbol"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label htmlFor="workerUniSearch">
            Authorize universities <span style={{ opacity: 0.6 }}>— pick one or more campuses{Object.keys(picked).length ? ' (' + Object.keys(picked).length + ' picked)' : ''}; that campus's sub-admin settles their salary</span>
          </label>
          <input type="text" id="workerUniSearch" placeholder="Search universities…"
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
          <button className="btn-submit" style={{ whiteSpace: 'nowrap' }} disabled={saving} onClick={addWorker}>
            ➕ Create Worker
          </button>
          <button className="admin-refresh-btn" onClick={loadWorkers}>↻ Refresh</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', alignSelf: 'center' }}>
            {list.length} worker{list.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>
              No workers yet. Create your first worker above — they pay nothing and earn ₦25,000 salary per completed 150-sales block.
            </div>
          ) : (
            <>
              <div className="admin-ticket-codes-label">💼 Active Workers ({list.length})</div>
              {list.map((u) => {
                const id = String(u.id || u._id || u.email || '').replace(/[^a-zA-Z0-9@.\-_]/g, '');
                const L = u.ledger || { quota: 150, monthSales: 0, credited: 0, blocksEarned: 0, totalSalary: 0 };
                const sal = u.salary || { totalPaid: 0, openAmount: 0 };
                return (
                  <div className="admin-ticket-code" key={id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
                        <span>💼</span>
                        <strong>{esc(u.name || '—')}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(u.email || '')}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Created {fmtDate(u.createdAt)}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                          Task link: <strong style={{ color: 'var(--accent)' }}>{esc(u.taskCode || 'not generated yet')}</strong>
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                          Campuses: <strong>{esc(((u.authorizedUniversities || []).map((x) => x && (x.name || x.id)).filter(Boolean).join(', ')) || '—')}</strong>
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                          This month: {Number(L.monthSales || 0)} sales ({Number(L.credited || 0)}/{Number(L.quota || 150)} counted)
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                          Blocks: {Number(L.blocksEarned || 0)} ({fmtN(L.totalSalary || 0)} earned)
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Paid: {fmtN(sal.totalPaid || 0)}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Awaiting payment: {fmtN(sal.openAmount || 0)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <button className="admin-ticket-copy" onClick={() => resetPassword(u.email || id)} title="Reset password">🔑</button>
                      <button className="admin-ticket-copy" onClick={() => deleteWorker(u.email || id)}
                        title="Remove worker" style={{ color: '#B71C1C', borderColor: '#F5C6CB' }}>✕</button>
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
