import { useEffect, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { esc, fmtN, fmtDate } from '../lib/utils.jsx';

/*
 * React thank-you page.
 *
 * This page renders its own confirmation card using the same checkoutData
 * object the checkout wrote to sessionStorage. The legacy thank-you page
 * (thank-you.html) is still served separately and is untouched, so both
 * versions can coexist.
 */

export default function ThankYou() {
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('orderId');
    let targetId = fromUrl ? fromUrl.trim() : '';

    if (!targetId) {
      try {
        const raw = sessionStorage.getItem('checkoutData');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.orderId) targetId = parsed.orderId;
        }
      } catch (e) {}
    }

    if (!targetId) {
      setChecking(false);
      return;
    }

    setOrderId(targetId);

    // The legacy thank-you page doesn't fetch the order from the API on load;
    // it relies on the Flutterwave callback having already created it. To keep
    // the React page informative without changing the contract, we try a quiet
    // lookup via the lookup endpoint using the URL/session phone fallback only
    // when we have one. If that fails, we still render the confirmation card
    // with what we have from checkoutData / the URL.
    let checkoutData = null;
    try {
      const raw = sessionStorage.getItem('checkoutData');
      if (raw) checkoutData = JSON.parse(raw);
    } catch (e) {}

    if (checkoutData && checkoutData.buyerPhone) {
      api('/api/orders/lookup', {
        method: 'POST',
        body: JSON.stringify({
          orderId: targetId,
          phone: checkoutData.buyerPhone,
        }),
      })
        .then((data) => {
          if (!cancelled) {
            if (data && data.success && data.order) {
              setOrder(data.order);
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            // If lookup fails, still render what we have from checkoutData.
          }
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    } else {
      setChecking(false);
    }

    return () => { cancelled = true; };
  }, []);

  const eventName = order?.eventName || (() => {
    try {
      const raw = sessionStorage.getItem('checkoutData');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed && parsed.eventName ? parsed.eventName : null;
      }
    } catch (e) {}
    return null;
  })();

  const buyerEmail = order?.buyerEmail || (() => {
    try {
      const raw = sessionStorage.getItem('checkoutData');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed && parsed.buyerEmail ? parsed.buyerEmail : null;
      }
    } catch (e) {}
    return null;
  })();

  const totalPaid = order?.amount || (() => {
    try {
      const raw = sessionStorage.getItem('checkoutData');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed && parsed.eventPrice ? Number(parsed.eventPrice) : 0;
      }
    } catch (e) {}
    return 0;
  })();

  const ticketCodes = order?.ticketCodes || [];

  return (
    <>
      <Nav />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Payment Received</div>
          <h1 className="section-title reveal reveal-delay-1">Thank <em>you!</em></h1>
          <p className="section-sub reveal reveal-delay-2">Thank you for your purchase. Your order is awaiting verification.</p>
        </div>
      </section>

      <section className="success-section">
        <div className="container">
          <div className="success-card reveal">
            <div className="success-icon">✅</div>
            <h2>Your tickets will be sent shortly</h2>
            <p>
              We have received your payment. You will receive a confirmation email now, and your actual ticket(s) will be sent to your email after your payment is verified. Please check your inbox and spam or junk folder.
            </p>

            {orderId && (
              <div className="success-summary" style={{ textAlign: 'left', marginTop: '22px', padding: '16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-3)' }}>Order ID</span>
                  <strong style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{esc(orderId)}</strong>
                </div>
                {eventName && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '10px' }}>
                    <span style={{ color: 'var(--text-3)' }}>Event</span>
                    <strong>{esc(eventName)}</strong>
                  </div>
                )}
                {buyerEmail && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '10px' }}>
                    <span style={{ color: 'var(--text-3)' }}>Email</span>
                    <strong style={{ color: 'var(--accent)' }}>{esc(buyerEmail)}</strong>
                  </div>
                )}
                {totalPaid > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '10px' }}>
                    <span style={{ color: 'var(--text-3)' }}>Total Paid</span>
                    <strong>{fmtN(totalPaid)}</strong>
                  </div>
                )}
                {ticketCodes.length > 0 && (
                  <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: '8px' }}>
                      🎟 Your ticket(s):
                    </div>
                    {ticketCodes.map((tc, i) => (
                      <a
                        key={i}
                        href={`/ticket.html?orderId=${encodeURIComponent(orderId)}&code=${encodeURIComponent(tc.code)}`}
                        className="btn-primary"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 16px',
                          marginBottom: '8px',
                          fontSize: '0.85rem',
                        }}
                      >
                        <span>Ticket {tc.index || (i + 1)}</span>
                        <span style={{ fontFamily: 'monospace' }}>{esc(tc.code)} →</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}              {order && (
                <div className="success-actions" style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid var(--border)' }}>
                  <a href="/my-tickets" className="btn-cta-primary" data-ticket-hub>
                    🎟 View My Tickets
                    <span>→</span>
                  </a>
                  <a href="/events.html" className="btn-cta-ghost">Browse More Events</a>
                </div>
              )}
              <div className="success-actions">
                <a href="/events.html" className="btn-cta-primary">
                  Browse Events
                  <span>→</span>
                </a>
                <a href="/events.html" className="btn-cta-ghost">View Events</a>
              </div>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container">
          <div className="cta-inner reveal">
            <div className="cta-content">
              <h2 className="cta-title">Ready to join the next<br /><em>big event?</em></h2>
              <p className="cta-sub">Grab your tickets now before they sell out.</p>
            </div>
            <div className="cta-actions">
              <a href="/events.html" className="btn-cta-primary">
                Get Tickets
                <span>→</span>
              </a>
              <a href="/faq.html" className="btn-cta-ghost">Visit FAQ</a>
            </div>
          </div>
        </div>
      </section>

      {!order && checkoutData?.buyerPhone && checkoutData?.orderId && (
        <section className="lookup-section" style={{ padding: '40px 0 80px' }}>
          <div className="container">
            <div className="lookup-card reveal" style={{ maxWidth: '640px', margin: '0 auto', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px 30px', boxShadow: 'var(--shadow-md)' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-1)', marginBottom: '6px' }}>Can't see your tickets yet?</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-3)', marginBottom: '22px', lineHeight: '1.6' }}>
                If your payment was just confirmed, your order may still be processing. Try looking it up directly — no account needed.
              </p>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: '6px' }}>Order ID</label>
                <input type="text" id="thankYouLookupOrderId" placeholder="UNI-XXXX-XXXX" autoComplete="off" style={{ width: '100%', padding: '11px 13px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg)', color: 'var(--text-1)', fontSize: '0.92rem' }} />
              </div>
              <div className="form-group" style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: '6px' }}>Phone Number</label>
                <input type="tel" id="thankYouLookupPhone" placeholder="0812 345 6789" autoComplete="tel" style={{ width: '100%', padding: '11px 13px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg)', color: 'var(--text-1)', fontSize: '0.92rem' }} />
              </div>
              <button className="btn-submit" id="thankYouLookupBtn" style={{ width: '100%', justifyContent: 'center' }}>Find My Ticket</button>
              <div className="lookup-error" id="thankYouLookupError" style={{ display: 'none', marginTop: '14px', background: '#FDECEA', border: '1px solid #F5C6CB', color: '#B71C1C', padding: '11px 14px', borderRadius: '10px', fontSize: '0.85rem' }} />
            </div>
          </div>
        </section>
      )}

      <Footer />
    </>
  );
}

function thankYouLookupOrder() {
  const orderId = document.getElementById('thankYouLookupOrderId');
  const phone = document.getElementById('thankYouLookupPhone');
  const btn = document.getElementById('thankYouLookupBtn');
  const errBox = document.getElementById('thankYouLookupError');
  const orderIdVal = (orderId && orderId.value || '').trim();
  const phoneVal = (phone && phone.value || '').trim();

  errBox.style.display = 'none';

  if (!orderIdVal || !phoneVal) {
    errBox.textContent = 'Please enter both your Order ID and phone number.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Searching…';

  fetch('/api/orders/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: orderIdVal, phone: phoneVal }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data || !data.success || !data.order) {
        errBox.textContent = (data && data.error) || 'Order not found. Check your details and try again.';
        errBox.style.display = 'block';
        return;
      }
      const firstCode = (data.order.ticketCodes && data.order.ticketCodes[0] && data.order.ticketCodes[0].code) || '';
      window.location.href = '/ticket.html?orderId=' + encodeURIComponent(data.order.orderId) +
        '&code=' + encodeURIComponent(firstCode);
    })
    .catch(() => {
      errBox.textContent = 'Cannot reach server. Please try again.';
      errBox.style.display = 'block';
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Find My Ticket';
    });
}

if (typeof window !== 'undefined') {
  try {
    const btn = document.getElementById('thankYouLookupBtn');
    if (btn) btn.addEventListener('click', thankYouLookupOrder);
  } catch (e) {}
}
