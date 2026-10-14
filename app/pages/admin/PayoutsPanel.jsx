import { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { esc, fmtN } from '../../lib/utils.jsx';

// d / hh / mm / ss countdown, shared by the hold banner and the table.
function fmtCountdown(ms) {
  if (!(ms > 0)) return '0d 00h 00m 00s';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return d + 'd ' + pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's';
}

function payoutBadge(status) {
  const s = String(status || 'pending').toLowerCase();
  return <span className={'lookup-badge ' + s}>{s}</span>;
}

// Payout Requests: verify, approve, pay or reject commission payouts. A sale
// through an influencer's link splits 2.5/20/77.5, a direct sale 20/80 (or
// 15/85 on events authorized for the reduced split). Requests are paid in full
// minus the platform fee that was already taken from the ticket.
export default function PayoutsPanel() {
  const { showToast, loadOrders, activeTab } = useAdmin();
  const [payoutsAll, setPayoutsAll] = useState([]);
  const [held, setHeld] = useState([]);
  const [holdDays, setHoldDays] = useState(7);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [requesterFilter, setRequesterFilter] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [now, setNow] = useState(Date.now());

  async function loadPayouts() {
    try {
      const data = await adminFetch('/api/admin/payouts');
      if (!data || !data.success) {
        showToast((data && data.error) || 'Could not load payout requests', true);
        return;
      }
      setPayoutsAll(data.payouts || []);
      setHeld(Array.isArray(data.heldPayments) ? data.heldPayments : []);
      setHoldDays(Number(data.holdDays) || 7);
      setLoaded(true);
    } catch (e) {
      showToast('Network error loading payout requests', true);
    }
  }

  // Reload every time the tab opens, like the legacy page's tab-click handler,
  // so the list can never stay stuck on a stale snapshot.
  useEffect(() => {
    if (activeTab === 'payouts') loadPayouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Tick once a second so the withdrawal hold visibly counts down instead of
  // showing whatever was left at the moment the panel loaded.
  useEffect(() => {
    if (!held.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [held.length]);

  const { requesters, schedules } = useMemo(() => {
    const people = new Set();
    const sched = new Set();
    payoutsAll.forEach((p) => {
      const who = (p.requesterName || p.requesterEmail || '').trim();
      if (who) people.add(who);
      const s = p.payoutMethodLabel || p.payoutMethod || '';
      if (s) sched.add(s);
    });
    return {
      requesters: Array.from(people).sort((a, b) => a.localeCompare(b)),
      schedules: Array.from(sched).sort((a, b) => a.localeCompare(b))
    };
  }, [payoutsAll]);

  const scoped = useMemo(() => payoutsAll.filter((p) => {
    const matchesRequester = !requesterFilter ||
      ((p.requesterName || p.requesterEmail || '').trim()) === requesterFilter;
    const matchesSchedule = !scheduleFilter ||
      (p.payoutMethodLabel || p.payoutMethod || '') === scheduleFilter;
    return matchesRequester && matchesSchedule;
  }), [payoutsAll, requesterFilter, scheduleFilter]);

  const stats = useMemo(() => {
    const rateOf = (p) => { const r = Number(p && p.feeRate); return isFinite(r) ? r : 0; };
    const netOf = (p) => Number(p.netAmount) || Math.round(((Number(p.amount) || 0) * (1 - rateOf(p))) * 100) / 100;
    const feeOf = (p) => Number(p.feeAmount) || Math.round(((Number(p.amount) || 0) * rateOf(p)) * 100) / 100;
    const byStatus = (st) => scoped.filter((p) => String(p.status).toLowerCase() === st);
    const pending = byStatus('pending');
    const approved = byStatus('approved');
    const paid = byStatus('paid');
    return {
      pending: pending.length,
      approved: approved.length,
      paid: fmtN(paid.reduce((s, p) => s + netOf(p), 0)),
      fees: fmtN(paid.reduce((s, p) => s + feeOf(p), 0))
    };
  }, [scoped]);

  const visible = useMemo(() => {
    const list = scoped.filter((p) =>
      statusFilter === 'all' || String(p.status || '').toLowerCase() === statusFilter);
    const rank = (p) => {
      const st = String(p.status).toLowerCase();
      return st === 'pending' ? 0 : (st === 'approved' ? 1 : 2);
    };
    return list.slice().sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [scoped, statusFilter]);

  // Held payments inside the withdrawal countdown, with a live total.
  const remaining = useMemo(() => held.filter((h) => new Date(h.unlocksAt).getTime() > now), [held, now]);

  async function payoutAction(payoutId, action) {
    let adminNote = '';
    if (action === 'reject') {
      adminNote = window.prompt('Reason for rejecting this payout request (sent to the requester by email):');
      if (adminNote === null) return;
      adminNote = String(adminNote).trim();
      if (!adminNote) { showToast('A rejection reason is required.', true); return; }
    }
    if (action === 'mark_paid' &&
        !window.confirm('Confirm you have sent this bank transfer. The requester will be emailed that the payout is complete.')) return;
    if (action === 'approve' &&
        !window.confirm('Verify the bank details and approve? The requester will be emailed that payment will be made within 24 hours.')) return;
    try {
      const data = await adminFetch('/api/admin/payouts', {
        method: 'POST',
        body: JSON.stringify({ payoutId, action, adminNote })
      });
      if (data && data.success) {
        if (data.emailWarning) {
          // No receivable address on file — never claim the influencer was told.
          showToast(data.emailWarning, true);
        } else {
          showToast(action === 'mark_paid'
            ? 'Marked as paid. ' + (data.emailSent ? 'Completion email sent to ' + data.emailSentTo + '.' : 'Requester emailed.')
            : (action === 'approve'
              ? 'Approved. Pay within 24 hours — requester notified.'
              : 'Request rejected. Requester notified.'));
        }
        loadPayouts();
        loadOrders();
      } else {
        showToast((data && data.error) || 'Failed to update payout', true);
      }
    } catch (e) {
      showToast('Network error updating payout', true);
    }
  }

  const rateOf = (p) => { const r = Number(p && p.feeRate); return isFinite(r) ? r : 0; };
  const pctOf = (p) => {
    const v = Math.round(rateOf(p) * 1000) / 10;
    return (Math.abs(v - Math.round(v)) < 0.001 ? String(Math.round(v)) : String(v)) + '%';
  };
  const netOf = (p) => Number(p.netAmount) || Math.round(((Number(p.amount) || 0) * (1 - rateOf(p))) * 100) / 100;
  const feeOf = (p) => Number(p.feeAmount) || Math.round(((Number(p.amount) || 0) * rateOf(p)) * 100) / 100;

  const totalHeld = remaining.reduce((s, h) =>
    s + (Number(h.commissionAmount != null ? h.commissionAmount : h.amount) || 0), 0);
  const nextUnlock = remaining[0] ? new Date(remaining[0].unlocksAt).getTime() - now : 0;

  return (
    <div className="admin-panel" id="panel-payouts">
      <div className="admin-panel-heading">
        <div>
          <h1>💰 Payout Requests</h1>
          <p>
            Every payout on the site. A sale through an influencer's link is split{' '}
            <strong>2.5% to Unisocials, 20% to the influencer, 77.5% to the event owner</strong>; a sale with no link is{' '}
            <strong>20% / 80%</strong> — or <strong>15% / 85%</strong> or <strong>10% / 90%</strong> on events
            authorized for a reduced split. Requests are paid in full — the platform fee was already taken from
            the ticket. Referrer commission is
            normally paid by the Influencer Admin of the event; you can still verify, release or reject any payout
            here. Approved payouts are promised within 24 hours.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="admin-refresh-btn" type="button" onClick={loadPayouts}>↻ Refresh</button>
          <button className="admin-print-btn" type="button" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat pending">
          <div className="admin-stat-label">Pending Review</div>
          <div className="admin-stat-value">{stats.pending}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Approved (pay within 24h)</div>
          <div className="admin-stat-value">{stats.approved}</div>
        </div>
        <div className="admin-stat verified">
          <div className="admin-stat-label">Paid Out</div>
          <div className="admin-stat-value">{stats.paid}</div>
        </div>
        <div className="admin-stat revenue">
          <div className="admin-stat-label">Platform Fee Retained</div>
          <div className="admin-stat-value">{stats.fees}</div>
        </div>
      </div>

      {remaining.length ? (
        <div style={{ marginBottom: 14, background: '#FFF8E1', border: '1px solid #FFE0B2', color: '#E65100', borderRadius: 10, padding: '12px 16px', fontSize: '.84rem', lineHeight: 1.7 }}>
          ⏳ <strong>{fmtN(totalHeld)}</strong> of verified payments is still inside the{' '}
          <strong>{holdDays}-day withdrawal countdown</strong> across {remaining.length} payment
          {remaining.length === 1 ? '' : 's'}. Next unlocks in <strong>{fmtCountdown(nextUnlock)}</strong>.
        </div>
      ) : null}

      <div className="admin-toolbar">
        <div className="admin-filters">
          {[
            { key: 'all', label: 'All' },
            { key: 'pending', label: '⏳ Pending' },
            { key: 'approved', label: '✅ Approved' },
            { key: 'paid', label: '💸 Paid' },
            { key: 'rejected', label: '❌ Rejected' }
          ].map((f) => (
            <button key={f.key}
              className={'admin-filter-btn' + (statusFilter === f.key ? ' active' : '')}
              onClick={() => setStatusFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-cat-filters">
        <div className="admin-cat-filter">
          <label htmlFor="payoutRequesterFilterSel">👤 Filter by Influencer Admin</label>
          <select id="payoutRequesterFilterSel" value={requesterFilter} onChange={(e) => setRequesterFilter(e.target.value)}>
            <option value="">All Influencer Admins</option>
            {requesters.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="admin-cat-filter">
          <label htmlFor="payoutScheduleFilterSel">📅 Filter by Schedule</label>
          <select id="payoutScheduleFilterSel" value={scheduleFilter} onChange={(e) => setScheduleFilter(e.target.value)}>
            <option value="">All Schedules</option>
            {schedules.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="admin-cat-clear" onClick={() => { setRequesterFilter(''); setScheduleFilter(''); }}>
          ✕ Clear Filters
        </button>
      </div>

      <div id="payoutAdminList">
        {!visible.length ? (
          <div className="admin-scan-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-3)', fontSize: '.85rem' }}>
            {payoutsAll.length
              ? <>No {statusFilter === 'all' ? '' : statusFilter + ' '}payout requests found with the selected filters.</>
              : (loaded ? 'No payout requests yet. Influencer Admins’ requests will appear here.' : 'Loading payout requests…')}
          </div>
        ) : visible.map((p) => (
          <PayoutCard key={p.id} p={p} onAction={payoutAction} netOf={netOf} feeOf={feeOf} rateOf={rateOf} pctOf={pctOf} />
        ))}
      </div>
    </div>
  );
}

function PayoutCard({ p, onAction, netOf, feeOf, rateOf, pctOf }) {
  const st = String(p.status).toLowerCase();
  let actions = null;
  if (st === 'pending') {
    actions = (
      <>
        <button className="btn-submit" style={{ whiteSpace: 'nowrap', padding: '10px 18px', fontSize: '.8rem' }}
          onClick={() => onAction(p.id, 'approve')}>✅ Verify & Approve</button>
        <button className="btn-submit" style={{ whiteSpace: 'nowrap', padding: '10px 18px', fontSize: '.8rem', background: '#B71C1C' }}
          onClick={() => onAction(p.id, 'reject')}>✖ Reject</button>
      </>
    );
  } else if (st === 'approved') {
    actions = (
      <>
        <button className="btn-submit" style={{ whiteSpace: 'nowrap', padding: '10px 18px', fontSize: '.8rem' }}
          onClick={() => onAction(p.id, 'mark_paid')}>
          💸 Send ₦{fmtN(netOf(p))} in full as Paid
        </button>
        <button className="btn-submit" style={{ whiteSpace: 'nowrap', padding: '10px 18px', fontSize: '.8rem', background: '#B71C1C' }}
          onClick={() => onAction(p.id, 'reject')}>✖ Reject</button>
      </>
    );
  } else if (st === 'paid') {
    actions = (
      <span style={{ fontSize: '.78rem', color: '#1B5E20', fontWeight: 700 }}>
        ✅ Paid {p.paidAt ? new Date(p.paidAt).toLocaleString() : ''}
      </span>
    );
  } else {
    actions = (
      <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
        Rejected{p.adminNote ? ' — ' + esc(p.adminNote) : ''}
      </span>
    );
  }

  const dueLine = p.paymentDueBy
    ? <div style={{ marginTop: 6, color: '#0D47A1', fontWeight: 600, fontSize: '.8rem' }}>
        ⏰ Pay by {new Date(p.paymentDueBy).toLocaleString()}
      </div>
    : null;

  return (
    <div className="admin-scan-panel" style={{
      marginBottom: 12,
      border: st === 'pending' ? '2px solid #FFE0B2' : (st === 'approved' ? '2px solid #BBDEFB' : undefined)
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: '1.02rem' }}>
          {fmtN(p.amount)} — {esc(p.requesterName || 'Referrer')}
          {p.requesterRole === 'influencer'
            ? <span style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--accent)' }}> · Influencer commission (20%)</span>
            : null}
        </strong>
        {payoutBadge(p.status)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: '.82rem', color: 'var(--text-2)' }}>
        <span>
          📧 {esc(p.requesterContactEmail || p.requesterEmail || '—')}
          {!p.requesterContactEmail
            ? <em style={{ color: '#E65100' }}> (no real email — payout notices will not reach them)</em>
            : null}
        </span>
        <span>📅 {esc(p.payoutMethodLabel || p.payoutMethod || '')}</span>
        <span>🕒 {p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}</span>
        <span><code style={{ fontSize: '.72rem' }}>{esc(p.id)}</code></span>
      </div>
      <div style={{ marginTop: 10, padding: 12, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 10, fontSize: '.88rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
          <span>Requested <strong>{fmtN(p.amount)}</strong></span>
          <span>Send <strong style={{ color: '#1B5E20' }}>{fmtN(netOf(p))}</strong> in full{rateOf(p) > 0 ? ' (after ' + pctOf(p) + ' fee)' : ''}</span>
          {rateOf(p) > 0
            ? <span>Unisocials fee {pctOf(p)} <strong style={{ color: '#E65100' }}>{fmtN(feeOf(p))}</strong></span>
            : null}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>🏦 {esc(p.bankName || '—')}</strong> · <strong>{esc(p.accountNumber || '—')}</strong> · {esc(p.accountName || '—')}
        </div>
        {dueLine}
        {p.note ? <div style={{ marginTop: 6, color: 'var(--text-3)', fontSize: '.8rem' }}>Note: {esc(p.note)}</div> : null}
      </div>
      {(st === 'pending' || st === 'approved')
        ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>{actions}</div>
        : <div style={{ marginTop: 10 }}>{actions}</div>}
    </div>
  );
}
