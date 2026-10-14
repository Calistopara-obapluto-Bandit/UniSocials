import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch, resetManagedPassword } from './adminApi.js';
import { esc } from '../../lib/utils.jsx';

// Dedicated Staff Accounts: separate login accounts for Check-in Staff and
// Influencer Admins. 📦 archives an account (signed out, blocked from signing
// in, history kept); ♻️ restores it.
export default function StaffPanel() {
  const { showToast } = useAdmin();
  const [list, setList] = useState([]);
  const [role, setRole] = useState('checkin_staff');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadStaff() {
    try {
      const data = await adminFetch('/api/admin/staff');
      setList((data && data.success && data.staff) || []);
    } catch (e) {
      showToast('Could not load staff accounts', true);
    }
  }

  useEffect(() => { loadStaff(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function addStaffAccount() {
    const n = name.trim();
    const e = email.trim();
    const p = password.trim();
    const ce = contactEmail.trim();
    if (!n || !e || !p) { showToast('Name, Email, and Password are required.', true); return; }
    if (p.length < 6) { showToast('Password must be at least 6 characters.', true); return; }
    if (ce && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ce)) {
      showToast('Enter a valid real email address, or leave it blank.', true);
      return;
    }
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({ role, name: n, email: e, contactEmail: ce, password: p })
      });
      if (data && data.success) {
        showToast((role === 'checkin_staff' ? 'Check-in Staff' : 'Influencer Admin') + ' account created for ' + n + '.');
        setName(''); setEmail(''); setContactEmail(''); setPassword('');
        loadStaff();
      } else {
        showToast((data && data.error) || 'Failed to create account', true);
      }
    } catch (err) {
      showToast('Network error creating account', true);
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(mail, archived) {
    if (!mail) return;
    if (!window.confirm(
      (archived ? 'Archive' : 'Restore') + ' ' + mail + '?' +
      (archived ? '\n\nThey will be signed out and blocked from signing in again until restored.' : '')
    )) return;
    try {
      const data = await adminFetch('/api/admin/staff', {
        method: 'PATCH',
        body: JSON.stringify({ email: mail, archived })
      });
      if (data && data.success) {
        showToast(archived ? mail + ' archived.' : mail + ' restored.');
        loadStaff();
      } else {
        showToast((data && data.error) || 'Could not update the account', true);
      }
    } catch (e) {
      showToast('Network error updating the account', true);
    }
  }

  async function deleteAccount(mail) {
    if (!mail || !window.confirm('Remove staff account ' + mail + '?')) return;
    try {
      const data = await adminFetch('/api/admin/staff?email=' + encodeURIComponent(mail), {
        method: 'DELETE'
      });
      if (data && data.success) {
        showToast('Staff account removed');
        loadStaff();
      } else {
        showToast((data && data.error) || 'Failed to remove account', true);
      }
    } catch (e) {
      showToast('Network error removing account', true);
    }
  }

  async function resetPassword(mail) {
    const res = await resetManagedPassword(mail);
    if (!res) return;
    if (res.ok) showToast(res.ok);
    else showToast(res.error, true);
  }

  const active = list.filter((u) => !u.archived);
  const archived = list.filter((u) => u.archived);

  const row = (u, isArchived) => {
    const label = u.role === 'checkin_staff' ? 'Check-in Staff' : 'Influencer Admin';
    return (
      <div className="admin-ticket-code" key={u.email || u.id}
        style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 0', opacity: isArchived ? 0.6 : 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            <strong>{esc(u.name || '—')}</strong>{' '}
            <span style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{esc(u.email || '')}</span>
          </div>
          <span style={{ fontSize: '.72rem', color: isArchived ? '#B71C1C' : 'var(--accent)', fontWeight: 700 }}>
            {label}{isArchived ? ' · Archived' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <button className="admin-ticket-copy" onClick={() => resetPassword(u.email || '')} title="Reset password">🔑</button>
          <button className="admin-ticket-copy" onClick={() => setArchived(u.email || '', !isArchived)}
            title={isArchived ? 'Restore account' : 'Archive account — blocks sign in'}
            style={{ color: isArchived ? '#1B5E20' : '#E65100' }}>
            {isArchived ? '♻️' : '📦'}
          </button>
          <button className="admin-ticket-copy" onClick={() => deleteAccount(u.email || '')}
            title="Remove account" style={{ color: '#B71C1C', borderColor: '#F5C6CB' }}>✕</button>
        </div>
      </div>
    );
  };

  return (
    <div className="admin-panel" id="panel-staff">
      <div className="admin-panel-heading">
        <div>
          <h1>👥 Dedicated Staff Accounts</h1>
          <p>
            Create separate login accounts for Check-in Staff and Influencer Admins. Each account only gets its assigned
            dashboard. Use 📦 to <strong>archive</strong> an account — it is signed out and blocked from signing in, but
            its history is kept. ♻️ restores it.
          </p>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="staffRole">Account Type</label>
            <select id="staffRole" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="checkin_staff">Check-in Staff</option>
              <option value="influencer_admin">Influencer Admin</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="staffName">Full Name</label>
            <input type="text" id="staffName" placeholder="e.g. Event Staff"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="staffEmail">Login Email</label>
            <input type="email" id="staffEmail" placeholder="staff@unisocials.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="staffContactEmail">Real Email <span style={{ opacity: .6 }}>— optional</span></label>
            <input type="email" id="staffContactEmail" placeholder="e.g. ada@gmail.com"
              value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            <p style={{ margin: '6px 0 0', fontSize: '.72rem', color: 'var(--text-3)' }}>
              Where they receive their <strong>payout complete</strong> email. A <code>@unisocials.com</code> login cannot
              receive mail.
            </p>
          </div>
          <div className="form-group">
            <label htmlFor="staffPassword">Password</label>
            <input type="password" id="staffPassword" placeholder="8+ chars, letter, number & symbol"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-submit" disabled={saving} onClick={addStaffAccount}>➕ Create Account</button>
          <button className="admin-refresh-btn" onClick={loadStaff}>↻ Refresh</button>
          <span style={{ fontSize: '.75rem', color: 'var(--text-3)', alignSelf: 'center' }}>
            {active.length} active{active.length === 1 ? '' : 's'}{archived.length ? ' · ' + archived.length + ' archived' : ''}
          </span>
        </div>
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '.85rem' }}>
              No dedicated staff accounts yet.
            </div>
          ) : (
            <>
              {active.length ? (
                <>
                  <div className="admin-ticket-codes-label">👥 Active Accounts</div>
                  {active.map((u) => row(u, false))}
                </>
              ) : null}
              {archived.length ? (
                <>
                  <div className="admin-ticket-codes-label" style={{ marginTop: 12 }}>📦 Archived (blocked from signing in)</div>
                  {archived.map((u) => row(u, true))}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
