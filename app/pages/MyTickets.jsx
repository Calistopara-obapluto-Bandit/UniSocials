import { useEffect, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { api, isLoggedIn, getToken } from '../lib/api.js';
import { esc, fmtN, orderStatusBadge, ticketLinks } from '../lib/utils.jsx';

// The signed-in dashboard. This page is account-only: a signed-out visitor has
// nothing to see here, so they are sent to the standalone lookup page rather
// than shown an empty list.
export default function MyTickets() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!isLoggedIn()) {
      window.location.replace('/lookup.html');
      return;
    }

    api('/api/auth/orders')
      .then((data) => {
        if (cancelled) return;
        setOrders((data && data.success && data.orders) || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => { cancelled = true; };
  }, []);

  async function logout() {
    const token = getToken();
    try {
      localStorage.removeItem('unn_auth_token');
      localStorage.removeItem('unn_auth_user');
    } catch (e) { /* nothing to clear */ }
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token }
        });
      } catch (e) { /* the session expires on its own */ }
    }
    window.location.replace('/login.html');
  }

  return (
    <>
      <Nav active="Tickets" />
      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">My Tickets</div>
          <h1 className="section-title reveal reveal-delay-1">Your <em>orders</em></h1>
          <p className="section-sub reveal reveal-delay-2">
            Every order on your account, in one place. Bought something with a different phone number?{' '}
            <a href="/lookup.html" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
              Look up that order
            </a>.
          </p>
        </div>
      </section>

      <section className="orders-section" id="ordersSection">
        <div className="container">
          <div
            id="ordersHeader"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}
          >
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-1)' }}>🎟 My Orders</h2>
            <button
              className="btn-cta-ghost"
              onClick={logout}
              style={{ display: 'inline-flex', padding: '10px 24px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Log Out
            </button>
          </div>

          <div id="ordersList">
            {error ? <div className="lookup-error show">{error}</div> : null}

            {!error && checking ? null : null}

            {!error && !checking && orders && orders.length === 0 ? (
              <div className="dashboard-empty">
                <h2>No tickets yet</h2>
                <p>You haven’t bought any tickets on this account. Browse events and grab yours today!</p>
                <a href="/events.html" className="btn-primary" style={{ display: 'inline-flex', padding: '12px 28px' }}>
                  Browse Events
                </a>
              </div>
            ) : null}

            {!error && !checking && orders && orders.map((o) => (
              <div className="order-card" key={o.orderId}>
                <div className="order-card-top">
                  <span className="order-id">{esc(o.orderId)}</span>
                  {orderStatusBadge(o.status)}
                </div>
                <div className="order-card-title">{esc(o.eventName || '—')}</div>
                <div className="order-card-meta">
                  {o.eventDate ? '📅 ' + esc(o.eventDate) : ''}
                  {o.eventVenue ? ' · 📍 ' + esc(o.eventVenue) : ''}
                  {' · '}{fmtN(o.amount)}
                </div>
                <div className="order-codes">{ticketLinks(o)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}