import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { esc, fmtN, fmtDate } from '../../lib/utils.jsx';

// Derive the customer directory from the orders endpoint when the account
// directory endpoint is unavailable, so ticket buyers NEVER disappear from this
// tab. Same shape as the API response: { account, summary, guest }.
function customersFromOrders(orders) {
  const byEmail = {};
  (orders || []).forEach((o) => {
    if (!o || !o.buyerEmail) return;
    const key = String(o.buyerEmail).toLowerCase();
    if (!byEmail[key]) {
      byEmail[key] = {
        guest: true,
        account: { id: null, name: '', email: key, phone: '', role: 'guest', createdAt: null, archived: false },
        summary: { totalOrders: 0, totalVerifiedOrders: 0, totalTickets: 0, totalSpent: 0, lastOrderAt: null }
      };
    }
    const entry = byEmail[key];
    const s = entry.summary;
    s.totalOrders += 1;
    if (String(o.status || '').toLowerCase() === 'verified') s.totalVerifiedOrders += 1;
    s.totalTickets += Math.max(0, parseInt(o.qty, 10) || 0);
    s.totalSpent += Math.max(0, Number(o.amount) || 0);
    const orderAt = o.verifiedAt || o.createdAt || null;
    if (orderAt && (!s.lastOrderAt || orderAt > s.lastOrderAt)) {
      s.lastOrderAt = orderAt;
      if (o.buyerName && !entry.account.name) entry.account.name = String(o.buyerName).trim();
      if (o.buyerPhone && !entry.account.phone) entry.account.phone = String(o.buyerPhone).trim();
    }
    if (o.createdAt && (!entry.account.createdAt || o.createdAt < entry.account.createdAt)) {
      entry.account.createdAt = o.createdAt;
    }
  });
  return Object.keys(byEmail).map((k) => {
    const e = byEmail[k];
    if (!e.account.name) e.account.name = e.account.email.split('@')[0] || '—';
    return e;
  }).sort((a, b) => {
    const byA = a.summary.lastOrderAt || a.account.createdAt || '';
    const byB = b.summary.lastOrderAt || b.account.createdAt || '';
    return String(byB).localeCompare(String(byA));
  });
}

// Customers tab: registered buyers and everyone who has bought tickets.
// Passwords are never shown. Auth failures and server errors are surfaced as
// messages — a 401 or a 500 must never render as an empty customer list.
export default function CustomersPanel() {
  const { activeTab } = useAdmin();
  const [list, setList] = useState([]);
  const [countText, setCountText] = useState('Loading…');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [expanded, setExpanded] = useState({}); // index -> { open, loading, data, error }

  async function loadCustomers() {
    setCountText('Loading…');
    setError('');
    try {
      const data = await adminFetch('/api/admin/customers', { credentials: 'same-origin' });
      if (data && data.__unauthorized) {
        setCountText('');
        setError('Your admin session is invalid or expired. Log in again to view customers.');
        setList([]);
        return;
      }
      if (!data || data.success !== true) {
        throw new Error((data && data.error) ? data.error : 'Server returned an invalid response');
      }
      const customers = data.customers || [];
      const totalCount = data.totalCount != null ? data.totalCount : customers.length;
      const withOrders = data.customersWithOrders != null ? data.customersWithOrders : 0;
      setList(customers);
      setNotice(null);
      setCountText(totalCount + ' customer' + (totalCount !== 1 ? 's' : '') + ' · ' + withOrders + ' with orders');
      setExpanded({});
    } catch (err) {
      if (err && err.message && err.message.indexOf('session') > -1) {
        setList([]);
        setCountText('');
        setError(err.message);
        return;
      }
      // Fallback: rebuild the directory from the orders endpoint (the
      // dashboard's own data source) so every ticket buyer still appears.
      try {
        const fallback = await adminFetch('/api/admin/orders', { credentials: 'same-origin' });
        if (fallback && fallback.__unauthorized) throw new Error('unauthorized');
        const fallbackOrders = (fallback && fallback.success && fallback.orders) || [];
        const derived = customersFromOrders(fallbackOrders);
        if (!derived.length) throw err;
        const withOrders = derived.filter((c) => c.summary && c.summary.totalOrders > 0).length;
        setList(derived);
        setCountText(derived.length + ' customer' + (derived.length !== 1 ? 's' : '') + ' · ' + withOrders + ' with orders');
        setNotice('The full account directory could not be loaded (' + err.message + '). Showing ticket buyers from orders instead.');
        setError('');
        setExpanded({});
      } catch (fallbackErr) {
        setList([]);
        setCountText('');
        setNotice(null);
        setError(fallbackErr && fallbackErr.message === 'unauthorized'
          ? 'Your admin session is invalid or expired. Log in again to view customers.'
          : 'Could not load customers: ' + (err && err.message ? err.message : 'unknown error'));
      }
    }
  }

  // Refresh every time the tab opens, so the list can never stay stuck on an
  // old "Loading…"/empty state from the login fetch.
  useEffect(() => {
    if (activeTab === 'customers') loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Expanding a customer fetches their order history inline, so the admin
  // never leaves the tab for a raw JSON URL.
  async function toggleDetail(index) {
    const current = expanded[index];
    if (current && current.open) {
      setExpanded((e) => ({ ...e, [index]: { ...current, open: false } }));
      return;
    }
    if (current && current.data) {
      setExpanded((e) => ({ ...e, [index]: { ...current, open: true } }));
      return;
    }
    const acct = list[index] && list[index].account;
    const email = acct ? acct.email : '';
    if (!email) return;
    setExpanded((e) => ({ ...e, [index]: { open: true, loading: true } }));
    try {
      const data = await adminFetch('/api/admin/customers/' + encodeURIComponent(email), {
        credentials: 'same-origin'
      });
      if (!data || !data.success) {
        setExpanded((e) => ({ ...e, [index]: { open: true, error: (data && data.error) || 'Could not load this customer.' } }));
        return;
      }
      setExpanded((e) => ({ ...e, [index]: { open: true, data } }));
    } catch (err) {
      setExpanded((e) => ({
        ...e,
        [index]: {
          open: true,
          error: err && err.message && err.message.indexOf('session') > -1
            ? 'Your admin session is invalid or expired. Log in again.'
            : 'Could not load orders. Check your connection and try again.'
        }
      }));
    }
  }

  return (
    <div className="admin-panel" id="panel-customers">
      <div className="admin-panel-heading">
        <div>
          <h1>👥 Customers</h1>
          <p>Registered buyers and everyone who has bought tickets. Passwords are never shown.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="admin-refresh-btn" onClick={loadCustomers}>↻ Refresh</button>
          <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>{error ? '' : countText}</span>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ marginTop: 14 }}>
          {notice ? (
            <div style={{ textAlign: 'center', padding: '8px 0', color: '#B7791F', fontSize: '.78rem' }}>{esc(notice)}</div>
          ) : null}
          {error ? (
            <div style={{ textAlign: 'center', padding: 18, color: '#B71C1C', fontSize: '.85rem' }}>{esc(error)}</div>
          ) : null}
          {!error && list.length === 0 && countText !== 'Loading…' ? (
            <div style={{ textAlign: 'center', padding: 18, color: 'var(--text-3)', fontSize: '.85rem' }}>
              No customer accounts yet.
            </div>
          ) : null}
          {!error ? list.map((c, i) => {
            const acct = c && c.account ? c.account : null;
            const email = acct && acct.email ? acct.email : '—';
            const name = acct && acct.name ? acct.name : (acct && acct.email ? acct.email.split('@')[0] : '—');
            const summary = c && c.summary ? c.summary : null;
            const isGuest = !!(c && c.guest);
            const orderLine = summary && summary.totalOrders > 0
              ? (
                <span style={{ fontSize: '.74rem', color: 'var(--accent)', fontWeight: 600 }}>
                  {summary.totalOrders} order{summary.totalOrders !== 1 ? 's' : ''} · {fmtN(summary.totalSpent)}
                </span>
              )
              : <span style={{ fontSize: '.74rem', color: 'var(--text-3)' }}>No orders yet</span>;
            const state = expanded[i] || { open: false };
            return (
              <div key={email + i}>
                <div className="admin-ticket-code" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: '.95rem' }}>{esc(name)}</strong>
                      {isGuest ? (
                        <span style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 7px' }}>
                          Guest buyer
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: '.82rem', color: 'var(--text-3)' }}>{esc(email)}</div>
                    <div style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>{acct && acct.phone ? esc(acct.phone) : 'No phone'}</div>
                    <div style={{ fontSize: '.74rem', color: 'var(--text-2)' }}>
                      {isGuest ? 'First ticket purchase ' : 'Member since '}{fmtDate(acct && acct.createdAt ? acct.createdAt : null)}
                    </div>
                    <div style={{ marginTop: 6 }}>{orderLine}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <button type="button" onClick={() => toggleDetail(i)}
                      style={{ fontSize: '.8rem', color: 'var(--accent)', border: 'none', padding: '6px 10px', cursor: 'pointer', background: 'none' }}>
                      {state.open ? 'Hide orders' : 'View orders →'}
                    </button>
                  </div>
                </div>
                {state.open ? (
                  <div style={{ padding: '10px 0 16px', borderBottom: '1px solid var(--border)' }}>
                    <CustomerDetail state={state} />
                  </div>
                ) : null}
              </div>
            );
          }) : null}
        </div>
      </div>
    </div>
  );
}

function CustomerDetail({ state }) {
  if (state.loading) {
    return <div style={{ fontSize: '.82rem', color: 'var(--text-3)', padding: '6px 0' }}>Loading orders…</div>;
  }
  if (state.error) {
    return <div style={{ fontSize: '.82rem', color: '#B71C1C', padding: '6px 0' }}>{esc(state.error)}</div>;
  }
  const data = state.data || {};
  const orders = data.orders || [];
  const totals = (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '.78rem', color: 'var(--text-2)', marginBottom: 10 }}>
      <span><strong>{data.totalOrders || 0}</strong> order{(data.totalOrders || 0) !== 1 ? 's' : ''}</span>
      <span><strong>{data.totalVerifiedOrders || 0}</strong> verified</span>
      <span><strong>{data.totalTickets || 0}</strong> tickets</span>
      <span>Spent <strong>{fmtN(data.totalSpent || 0)}</strong></span>
    </div>
  );
  if (!orders.length) {
    return (
      <>
        {totals}
        <div style={{ fontSize: '.82rem', color: 'var(--text-3)' }}>No orders for this customer yet.</div>
      </>
    );
  }
  return (
    <>
      {totals}
      {orders.map((o) => {
        const status = String(o.status || '').toLowerCase();
        const statusColor = status === 'verified' ? 'var(--accent)' : (status === 'pending' ? '#B7791F' : 'var(--text-3)');
        const tickets = Array.isArray(o.ticketCodes) ? o.ticketCodes : [];
        const qty = parseInt(o.qty, 10) || 0;
        return (
          <div key={o.orderId} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '.85rem' }}>{esc(o.eventName || 'Event')}</strong>
              <span style={{ fontSize: '.78rem', color: statusColor, fontWeight: 600, textTransform: 'capitalize' }}>
                {esc(o.status || 'unknown')}
              </span>
            </div>
            <div style={{ fontSize: '.76rem', color: 'var(--text-3)', marginTop: 4 }}>
              Order <span style={{ fontFamily: 'monospace' }}>{esc(o.orderId || '—')}</span>
              {' · '}{qty} ticket{qty !== 1 ? 's' : ''}
              {' · ₦'}{fmtN(o.amount || 0).replace('₦', '')}
              {o.eventDate ? ' · ' + esc(o.eventDate) : ''}
              {o.eventVenue ? ' · ' + esc(o.eventVenue) : ''}
            </div>
            {o.buyerPhone ? (
              <div style={{ fontSize: '.74rem', color: 'var(--text-3)', marginTop: 2 }}>Phone: {esc(o.buyerPhone)}</div>
            ) : null}
            {tickets.length ? (
              <div style={{ fontSize: '.74rem', color: 'var(--text-2)', marginTop: 4 }}>
                Tickets: {tickets.map((t, i) => (
                  <span key={i}>
                    <span style={{ fontFamily: 'monospace' }}>{esc(t && t.code ? t.code : t)}</span>
                    {t && t.used ? <span style={{ color: '#B7791F' }}> (used)</span> : null}
                    {i < tickets.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
