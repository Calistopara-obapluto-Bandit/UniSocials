import { useMemo, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { fmtN, fmtDate, esc } from '../../lib/utils.jsx';

// Orders Overview panel: stats, status quick-filter, event/category filters and
// the order cards with verify/reject/reopen/resend actions plus per-ticket codes.
// Orders are loaded by the shell (shared with the check-in tab); this panel only
// derives stats and the visible list from them.
export default function OverviewPanel({ orders, lastUpdated, active }) {
  const { showToast, loadOrders } = useAdmin();
  const [statusFilter, setStatusFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Event + Category dropdown options built from the loaded orders (unique).
  const { eventOptions, categoryOptions } = useMemo(() => {
    const events = new Set();
    const cats = new Set();
    (orders || []).forEach((o) => {
      const ev = (o.eventName || '').trim();
      const ct = (o.eventCategory || '').trim();
      if (ev) events.add(ev);
      if (ct) cats.add(ct);
    });
    return {
      eventOptions: Array.from(events).sort((a, b) => a.localeCompare(b)),
      categoryOptions: Array.from(cats).sort((a, b) => a.localeCompare(b))
    };
  }, [orders]);

  // Stats are driven by the Event + Category filters, then the status
  // quick-filter narrows the visible list underneath.
  const { stats, visible } = useMemo(() => {
    const catFiltered = (orders || []).filter((o) => {
      const matchesEvent = !eventFilter || (o.eventName || '') === eventFilter;
      const matchesCategory = !categoryFilter || (o.eventCategory || '') === categoryFilter;
      return matchesEvent && matchesCategory;
    });
    const s = { total: catFiltered.length, pending: 0, verified: 0, rejected: 0, revenue: 0 };
    catFiltered.forEach((o) => {
      if (o.status === 'pending') s.pending++;
      else if (o.status === 'verified') { s.verified++; s.revenue += (parseFloat(o.amount) || 0); }
      else if (o.status === 'rejected') s.rejected++;
    });
    const list = catFiltered.filter((o) => statusFilter === 'all' || o.status === statusFilter);
    return { stats: s, visible: list };
  }, [orders, statusFilter, eventFilter, categoryFilter]);

  async function updateOrderStatus(orderId, status) {
    try {
      const data = await adminFetch('/api/admin/orders/status', {
        method: 'POST',
        body: JSON.stringify({ orderId, status })
      });
      if (data && data.success) {
        showToast(status === 'verified' ? 'Order ' + orderId + ' verified ✅'
          : status === 'rejected' ? 'Order ' + orderId + ' rejected'
          : 'Order ' + orderId + ' reopened');
        loadOrders();
      } else {
        showToast((data && data.error) || 'Failed to update order', true);
      }
    } catch (e) {
      showToast('Network error updating order', true);
    }
  }

  async function resendOrderEmail(orderId) {
    try {
      const data = await adminFetch('/api/admin/orders/resend-email', {
        method: 'POST',
        body: JSON.stringify({ orderId })
      });
      if (data && data.success) showToast('Email queued for ' + orderId + ' ✉');
      else showToast((data && data.error) || 'Failed to queue email', true);
    } catch (e) {
      showToast('Network error sending email', true);
    }
  }

  function copyTicketCode(code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code)
        .then(() => showToast('Ticket code copied'))
        .catch(() => window.prompt('Copy ticket code:', code));
    } else {
      window.prompt('Copy ticket code:', code);
    }
  }

  return (
    <div className={'admin-panel' + (active ? ' active' : '')} id="panel-overview">
      <div className="admin-panel-heading">
        <div>
          <h1>📊 Orders Overview</h1>
          <p>{lastUpdated ? 'Last updated: ' + lastUpdated : 'Loading orders…'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="admin-print-btn" onClick={() => window.print()}>🖨 Print</button>
          <button className="admin-refresh-btn" onClick={() => loadOrders()}>↻ Refresh</button>
        </div>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <div className="admin-stat-label">Total Orders</div>
          <div className="admin-stat-value">{stats.total}</div>
        </div>
        <div className="admin-stat pending">
          <div className="admin-stat-label">Pending</div>
          <div className="admin-stat-value">{stats.pending}</div>
        </div>
        <div className="admin-stat verified">
          <div className="admin-stat-label">Verified</div>
          <div className="admin-stat-value">{stats.verified}</div>
        </div>
        <div className="admin-stat revenue">
          <div className="admin-stat-label">Revenue (Verified)</div>
          <div className="admin-stat-value">{fmtN(stats.revenue)}</div>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-filters">
          {[
            { key: 'all', label: 'All' },
            { key: 'pending', label: '⏳ Pending' },
            { key: 'verified', label: '✅ Verified' },
            { key: 'rejected', label: '❌ Rejected' }
          ].map((f) => (
            <button
              key={f.key}
              className={'admin-filter-btn' + (statusFilter === f.key ? ' active' : '')}
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-cat-filters" id="catFilters">
        <div className="admin-cat-filter">
          <label htmlFor="eventFilterSel">🎤 Filter by Event</label>
          <select id="eventFilterSel" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
            <option value="">All Events</option>
            {eventOptions.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </div>
        <div className="admin-cat-filter">
          <label htmlFor="categoryFilterSel">🏷 Filter by Category</label>
          <select id="categoryFilterSel" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {categoryOptions.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
          </select>
        </div>
        <button
          className="admin-cat-clear"
          onClick={() => { setEventFilter(''); setCategoryFilter(''); }}
        >
          ✕ Clear Filters
        </button>
      </div>

      <div className="admin-orders" id="ordersList">
        {visible.length === 0 ? (
          <div className="admin-empty">
            <span>🗂️</span>
            <p>
              No {statusFilter === 'all' ? '' : statusFilter + ' '}orders found
              {eventFilter || categoryFilter ? ' with the selected filters' : ''}.
            </p>
          </div>
        ) : (
          visible.map((o) => (
            <OrderCard
              key={o.orderId}
              order={o}
              onStatus={updateOrderStatus}
              onResend={resendOrderEmail}
              onCopy={copyTicketCode}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OrderCard({ order: o, onStatus, onResend, onCopy }) {
  const amount = fmtN(o.amount);
  const qty = o.qty + ' ticket' + (o.qty > 1 ? 's' : '');
  const isNew = o.notifyAdmin && !o.seenByAdmin;

  // Per-ticket code list (each verified ticket carries its own QR code).
  const ticketList = (o.status === 'verified' && Array.isArray(o.ticketCodes) && o.ticketCodes.length)
    ? (
      <div className="admin-ticket-codes">
        <div className="admin-ticket-codes-label">🎟 Ticket Codes ({o.ticketCodes.length})</div>
        {o.ticketCodes.map((tc, i) => {
          const used = !!(tc && tc.used);
          const href = '/ticket.html?orderId=' + encodeURIComponent(o.orderId) +
            '&code=' + encodeURIComponent(tc.code);
          return (
            <div className={'admin-ticket-code' + (used ? ' used' : '')} key={tc.code}>
              <span style={{ color: 'var(--text-3)', fontSize: '0.72rem' }}>#{i + 1}</span>
              <code>{esc(tc.code)}</code>
              {used ? <span className="admin-ticket-used">Used</span> : <span className="admin-ticket-unused">OK</span>}
              <a className="admin-ticket-open" href={href} target="_blank" rel="noopener" title="Open ticket">↗</a>
              <button className="admin-ticket-copy" onClick={() => onCopy(tc.code)} title="Copy code">⧉</button>
            </div>
          );
        })}
      </div>
    )
    : null;

  let actions = null;
  if (o.status === 'pending') {
    actions = (
      <>
        <button className="action-btn action-verify" onClick={() => onStatus(o.orderId, 'verified')}>✅ Verify</button>
        <button className="action-btn action-reject" onClick={() => onStatus(o.orderId, 'rejected')}>✕ Reject</button>
        <button className="action-btn action-reopen" onClick={() => onResend(o.orderId)} title="Send the admin new-order alert again">✉ Resend Email</button>
      </>
    );
  } else if (o.status === 'verified') {
    actions = (
      <>
        <button className="action-btn action-reopen" onClick={() => onStatus(o.orderId, 'pending')}>↩ Reopen</button>
        <button className="action-btn action-reopen" onClick={() => onResend(o.orderId)} title="Resend the buyer ticket confirmation email">✉ Resend Email</button>
      </>
    );
  } else if (o.status === 'rejected') {
    actions = (
      <>
        <button className="action-btn action-verify" onClick={() => onStatus(o.orderId, 'verified')}>✅ Verify</button>
        <button className="action-btn action-reopen" onClick={() => onStatus(o.orderId, 'pending')}>↩ Reopen</button>
      </>
    );
  }

  const paidFlag = (o.paymentNotified && o.status === 'pending')
    ? <span className="admin-paid-flag">💸 Payment claimed</span>
    : null;
  const referralFlag = o.referralCode
    ? <span className="admin-paid-flag" style={{ color: 'var(--accent)', background: 'var(--accent-ghost)', border: '1px solid var(--accent-border)' }}>🏷 {esc(o.referralCode)}</span>
    : null;
  const ticket = (o.status === 'verified' && o.ticketCode)
    ? <span className="admin-order-badge" style={{ background: '#E8F5E9', color: '#1B5E20', border: '1px solid #C8E6C9' }}>🎟 {esc(o.ticketCode)}</span>
    : null;

  return (
    <div className={
      'admin-order' +
      (o.paymentNotified && o.status === 'pending' ? ' payment-notified' : '') +
      (isNew ? ' new-order' : '')
    }>
      <div className="admin-order-main">
        <div className="admin-order-top">
          <span className="admin-order-id">{esc(o.orderId)}</span>
          <span className={'admin-order-badge ' + esc(o.status)}>{esc(o.status)}</span>
          {paidFlag}{referralFlag}{ticket}
        </div>
        <div className="admin-order-event">{esc(o.eventName || '—')}</div>
        <div className="admin-order-meta">
          <span>📅 {esc(o.eventDate || '—')}</span>
          <span>📍 {esc(o.eventVenue || '—')}</span>
          {o.eventCategory ? <span>🏷 {esc(o.eventCategory)}</span> : null}
          <span>🎟 {esc(qty)}</span>
          <span>💳 Flutterwave</span>
          <span>🕒 {fmtDate(o.createdAt)}</span>
          {o.paymentNotifiedAt ? <span>💸 Paid {fmtDate(o.paymentNotifiedAt)}</span> : null}
          {o.verifiedAt ? <span>✅ {fmtDate(o.verifiedAt)}</span> : null}
        </div>
        <div className="admin-order-buyer">
          <strong>{esc(o.buyerName || '—')}</strong> &middot;{' '}
          <a href={'mailto:' + esc(o.buyerEmail || '')}>{esc(o.buyerEmail || '—')}</a>
          {o.buyerPhone ? ' · ' + esc(o.buyerPhone) : ''}
          {o.buyerFaculty ? ' · ' + esc(o.buyerFaculty) : ''}
        </div>
        {ticketList}
      </div>
      <div className="admin-order-right" style={{ textAlign: 'right' }}>
        <div className="admin-order-amount">{amount}</div>
        <div className="admin-order-actions">{actions}</div>
      </div>
    </div>
  );
}
