import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { esc } from '../../lib/utils.jsx';

// Coupons tab: create fixed-amount coupons (₦4,000 ticket − ₦400 = ₦3,600),
// edit existing ones and delete them.
export default function CouponsPanel() {
  const { showToast } = useAdmin();
  const [coupons, setCoupons] = useState([]);
  const [count, setCount] = useState('');
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadCoupons() {
    try {
      const data = await adminFetch('/api/admin/coupons');
      if (!data || !data.success) throw new Error((data && data.error) || 'Could not load coupons');
      const list = data.coupons || [];
      setCoupons(list);
      setCount(list.length + ' coupon' + (list.length === 1 ? '' : 's'));
      setLoadError('');
    } catch (e) {
      setLoadError('Could not load coupons: ' + (e.message || 'Unauthorized or server error. Click Refresh to try again.'));
      if (!coupons.length) showToast('Coupon list could not be loaded.', true);
    }
  }

  useEffect(() => { loadCoupons(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function cancelEdit() {
    setEditingId('');
    setCode('');
    setAmount('');
  }

  async function saveCoupon() {
    const trimmed = code.trim().toUpperCase();
    const value = Number(amount || 0);
    if (trimmed.length < 3 || value <= 0) {
      window.alert('Enter a coupon code and discount amount.');
      return;
    }
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({ id: editingId || undefined, code: trimmed, amount: value, active: true })
      });
      if (!data || !data.success) throw new Error((data && data.error) || 'Could not save coupon');
      cancelEdit();
      loadCoupons();
      window.alert('Coupon saved: ' + trimmed + ' = ₦' + value.toLocaleString() + ' off.');
    } catch (e) {
      window.alert(e.message || 'Could not save coupon.');
    } finally {
      setSaving(false);
    }
  }

  async function editCoupon(id) {
    try {
      const data = await adminFetch('/api/admin/coupons');
      const c = (data.coupons || []).find((x) => String(x.id) === String(id));
      if (!c) throw new Error('Coupon not found');
      setEditingId(c.id);
      setCode(c.code);
      setAmount(String(c.amount));
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function deleteCoupon(id) {
    if (!window.confirm('Delete this coupon?')) return;
    try {
      const data = await adminFetch('/api/admin/coupons?id=' + encodeURIComponent(id), {
        method: 'DELETE'
      });
      if (!data || !data.success) throw new Error((data && data.error) || 'Delete failed');
      if (editingId === id) cancelEdit();
      loadCoupons();
    } catch (e) {
      window.alert(e.message);
    }
  }

  return (
    <div className="admin-panel" id="panel-coupons">
      <div className="admin-panel-heading">
        <div><h1>🏷️ Coupon Codes</h1><p>Create fixed-amount coupons. Example: ₦4,000 ticket − ₦400 coupon = ₦3,600 to pay.</p></div>
        <button type="button" className="admin-refresh-btn" onClick={loadCoupons}>↻ Refresh</button>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="couponCodeAdmin">Coupon Code</label>
            <input type="text" id="couponCodeAdmin" placeholder="SAVE400" maxLength={40} autoComplete="off"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="couponAmountAdmin">Discount Amount (₦)</label>
            <input type="number" id="couponAmountAdmin" placeholder="400" min="1" step="1"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn-submit" style={{ width: 'auto', whiteSpace: 'nowrap' }}
            disabled={saving} onClick={saveCoupon}>
            {editingId ? '💾 Save Coupon' : '➕ Create Coupon'}
          </button>
          {editingId ? (
            <button type="button" className="admin-refresh-btn" onClick={cancelEdit}>✕ Cancel Edit</button>
          ) : null}
          <span style={{ fontSize: '.75rem', color: 'var(--text-3)' }}>{count}</span>
        </div>
        {loadError ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, fontSize: '.82rem', background: 'rgba(183,28,28,.08)', color: '#B71C1C' }}>
            {loadError}
          </div>
        ) : null}
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {coupons.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)' }}>No coupons created yet.</div>
          ) : coupons.map((c) => (
            <div className="admin-ticket-code" key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 0' }}>
              <div>
                <strong>{esc(c.code)}</strong>
                <span style={{ fontSize: '.78rem', color: 'var(--text-3)', marginLeft: 10 }}>
                  −₦{Number(c.amount || 0).toLocaleString()}
                </span>
                <span style={{ fontSize: '.72rem', marginLeft: 10, color: c.active === false ? '#B71C1C' : 'var(--accent)' }}>
                  {c.active === false ? 'Inactive' : 'Active'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="admin-ticket-copy" onClick={() => editCoupon(c.id)} title="Edit coupon">✏️</button>
                <button type="button" className="admin-ticket-copy" onClick={() => deleteCoupon(c.id)} title="Delete coupon">🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
