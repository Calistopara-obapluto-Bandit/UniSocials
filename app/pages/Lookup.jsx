import { useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { api, isLoggedIn } from '../lib/api.js';
import { esc, fmtN, fmtDate, orderStatusBadge, ticketLinks } from '../lib/utils.jsx';

// The guest lookup page. No account required: an Order ID plus the phone number
// used at checkout is the same secret the emailed ticket link carries.
export default function Lookup() {
  const [orderId, setOrderId] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const signedIn = isLoggedIn();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);

    if (!orderId.trim() || !phone.trim()) {
      setError('Please enter both your Order ID and phone number.');
      return;
    }

    setBusy(true);
    try {
      const data = await api('/api/orders/lookup', {
        method: 'POST',
        body: JSON.stringify({ orderId: orderId.trim(), phone: phone.trim() })
      });
      if (data && data.success && data.order) {
        setResult(data.order);
      } else {
        setError((data && data.error) || 'Order not found. Check your details and try again.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const o = result;

  return (
    <>
      <Nav active="Tickets" />
      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Order Lookup</div>
          <h1 className="section-title reveal reveal-delay-1">Find your <em>ticket</em></h1>
          <p className="section-sub reveal reveal-delay-2">
            {signedIn
              ? 'You’re signed in — every order on your account is on your dashboard. You can still look up a single order here.'
              : 'Already bought a ticket? Enter your Order ID and the phone number you paid with — no account, no sign-in.'}
          </p>
        </div>
      </section>

      <section className="lookup-section" id="lookupSection">
        <div className="container">
          {signedIn ? (
            <div className="lookup-hint">
              <strong>Signed in.</strong> Every order on your account is already listed on your dashboard.{' '}
              <a href="/my-tickets.html">Go to My Tickets →</a>
            </div>
          ) : (
            <div className="lookup-hint">
              <strong>No account needed.</strong> Your tickets are emailed to you the moment payment is
              confirmed — just open that email. <a href="/login.html">Signing in</a> is optional, only to see
              every order in one place.
            </div>
          )}

          <div className="lookup-card reveal">
            <h2>🔍 {signedIn ? 'Look up another order' : 'Look Up Your Order'}</h2>
            <p>
              {signedIn
                ? 'Useful for a ticket bought with a different phone number, or one from before you made an account.'
                : 'Enter your Order ID and the phone number you used to buy the ticket. No sign-up, no sign-in.'}
            </p>

            <form onSubmit={onSubmit}>
              <div className="form-group">
                <label htmlFor="lookupOrderId">Order ID</label>
                <input
                  type="text"
                  id="lookupOrderId"
                  placeholder="UNI-XXXX-XXXX"
                  autoComplete="off"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="lookupPhone">Phone Number</label>
                <input
                  type="tel"
                  id="lookupPhone"
                  placeholder="0812 345 6789"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <button className="btn-submit" id="lookupBtn" type="submit" disabled={busy}>
                {busy ? 'Searching…' : 'Find My Ticket'}
              </button>
            </form>

            {error ? <div className="lookup-error show">{error}</div> : null}

            {o ? (
              <div className="lookup-result show">
                <div style={{ textAlign: 'center', marginBottom: 14 }}>{orderStatusBadge(o.status)}</div>
                <div className="lookup-order-row"><span>Order ID</span><strong>{esc(o.orderId)}</strong></div>
                <div className="lookup-order-row"><span>Event</span><strong>{esc(o.eventName || '—')}</strong></div>
                {o.eventDate ? <div className="lookup-order-row"><span>Date</span><strong>{esc(o.eventDate)}</strong></div> : null}
                {o.eventVenue ? <div className="lookup-order-row"><span>Venue</span><strong>{esc(o.eventVenue)}</strong></div> : null}
                <div className="lookup-order-row">
                  <span>Quantity</span>
                  <strong>{o.qty} ticket{o.qty > 1 ? 's' : ''}</strong>
                </div>
                <div className="lookup-order-row"><span>Total</span><strong>{fmtN(o.amount)}</strong></div>
                <div className="lookup-order-row"><span>Payment</span><strong>Flutterwave</strong></div>
                {o.status === 'verified'
                  ? <div className="lookup-order-row"><span>Verified</span><strong>{fmtDate(o.verifiedAt)}</strong></div>
                  : null}
                <div className="lookup-actions">
                  {ticketLinks(o)}
                  <a className="btn-cta-ghost" style={{ display: 'inline-flex', padding: '12px 26px' }} href="/events.html">
                    Browse Events
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}