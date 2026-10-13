import { useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { authHeaders } from '../lib/api.js';
import { esc, fmtN as fmtMoney } from '../lib/utils.jsx';

/*
 * React port of pending.html — order tracking.
 *
 * Same ?orderId= contract, same 4s poll of /api/orders/status, same three
 * outcomes (pending / verified / rejected / missing order id). The legacy page
 * read a `pendingOrder` sessionStorage key that nothing ever wrote, so this
 * version also falls back to the `checkoutData` payload the checkout just
 * stored, which makes the card paint immediately instead of after the first
 * poll.
 */

const PAGE_CSS = `
.pending-section { padding: 56px 0 80px; }
.pending-card { max-width: 640px; margin: 0 auto; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 48px 40px; text-align: center; box-shadow: var(--shadow-md); position: relative; overflow: hidden; }
.pending-spinner { width: 72px; height: 72px; border-radius: 50%; border: 4px solid var(--accent-ghost); border-top-color: var(--accent); animation: spin 0.9s linear infinite; margin: 0 auto 20px; }
@keyframes spin { to { transform: rotate(360deg); } }
.pending-card h2 { font-size: clamp(1.4rem, 3vw, 1.8rem); font-weight: 700; letter-spacing: -0.03em; color: var(--text-1); margin-bottom: 10px; }
.pending-card .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 18px; border-radius: 100px; font-size: 0.82rem; font-weight: 600; margin: 16px 0 20px; }
.status-badge.pending { background: #FFF3E0; color: #E65100; border: 1px solid #FFE0B2; }
.status-badge.verified { background: #E8F5E9; color: #1B5E20; border: 1px solid #C8E6C9; }
.status-badge.rejected { background: #FDECEA; color: #B71C1C; border: 1px solid #F5C6CB; }
.pending-info { background: var(--bg); border-radius: var(--radius); padding: 16px 20px; text-align: left; margin: 16px 0; }
.pending-info div { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.85rem; color: var(--text-2); }
.pending-info div strong { color: var(--text-1); }
.pending-progress { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 24px 0; }
.pending-step { text-align: center; font-size: 0.75rem; color: var(--text-3); }
.pending-step .dot { width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; margin-bottom: 6px; border: 2px solid var(--border); background: var(--surface-2); }
.pending-step.active .dot { background: var(--accent); border-color: var(--accent); color: #fff; }
.pending-step.done .dot { background: var(--accent-light); border-color: var(--accent-light); color: #fff; }
.pending-step.done { color: var(--accent); }
.pending-step.active { color: var(--text-1); font-weight: 600; }
.ticket-codes { margin: 18px 0; text-align: left; }
.ticket-codes .tc-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; font-size: 0.85rem; }
.ticket-codes .tc-row code { font-family: monospace; font-weight: 700; color: var(--accent); }
@media (max-width: 480px) { .pending-card { padding: 32px 20px; } .pending-progress { gap: 8px; } }
@media (max-width: 600px) {
  .pending-card, .pending-info, .pending-info div, .ticket-codes, .ticket-codes .tc-row { min-width: 0; max-width: 100%; }
  .pending-info div { flex-wrap: wrap; }
  .pending-info div strong { overflow-wrap: anywhere; word-break: break-word; }
  .ticket-codes .tc-row { flex-wrap: wrap; }
  .ticket-codes .tc-row code { word-break: break-all; min-width: 0; }
}
`;

const seed = () => {
  const out = {};
  try {
    const raw = sessionStorage.getItem('pendingOrder');
    if (raw) {
      const d = JSON.parse(raw);
      out.orderId = d.orderId || '';
      out.eventName = d.eventName || '';
      out.qty = Number(d.qty || 0);
      out.amount = Number(d.amount || 0);
    }
  } catch (e) { /* ignore */ }
  if (!out.eventName) {
    try {
      const raw = sessionStorage.getItem('checkoutData');
      if (raw) {
        const d = JSON.parse(raw);
        const unit = Number(d.bonusEventPrice || d.eventPrice || d.originalEventPrice || 0);
        out.eventName = d.eventName || '';
        out.qty = Number(d.qty || 0);
        out.amount = unit * Number(d.qty || 0);
      }
    } catch (e) { /* ignore */ }
  }
  return out;
};

export default function Pending() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const orderId = (params.get('orderId') || '').trim();

  const [phase, setPhase] = useState(orderId ? 'pending' : 'missing');
  const [info, setInfo] = useState(() => seed());
  const [codes, setCodes] = useState([]);
  const [legacyTicketCode, setLegacyTicketCode] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    if (orderId) setInfo((prev) => ({ ...prev, orderId }));
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return undefined;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/api/orders/status?orderId=' + encodeURIComponent(orderId), { headers: authHeaders() });
        const data = await res.json();
        if (cancelled || !data || !data.success || !data.order) return;
        const order = data.order;
        setInfo({
          orderId,
          eventName: order.eventName || '',
          qty: Number(order.qty || 0),
          amount: Number(order.amount || 0),
          paymentMethod: order.paymentMethod || '',
        });
        if (order.status === 'verified') {
          setCodes(Array.isArray(order.ticketCodes) ? order.ticketCodes : []);
          setLegacyTicketCode(order.ticketCode || '');
          setPhase('verified');
          if (timerRef.current) clearInterval(timerRef.current);
        } else if (order.status === 'rejected') {
          setPhase('rejected');
          if (timerRef.current) clearInterval(timerRef.current);
        } else {
          setPhase('pending');
        }
      } catch (e) { /* transient network error — keep polling */ }
    };

    check();
    timerRef.current = setInterval(check, 4000);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [orderId]);

  const waNumber = (window.SITE_CONFIG && window.SITE_CONFIG.WHATSAPP_FLOAT_NUMBER) || '2348122104576';
  const showSpinner = phase === 'pending';
  const badgeClass = phase === 'verified' ? 'verified' : (phase === 'rejected' ? 'rejected' : 'pending');

  let title = 'Awaiting Payment';
  let badge = '⏳ Pending';
  let message = 'Your order has been placed. Complete your payment and your tickets will be issued automatically once verified.';
  let icon = null;
  if (phase === 'missing') {
    title = 'No order to track';
    badge = '⚠️ Missing Order ID';
    message = 'Open this page from your checkout confirmation or from the My Tickets page.';
  } else if (phase === 'verified') {
    title = 'Order Verified!';
    badge = '✅ Verified';
    message = 'Payment confirmed. Your digital ticket(s) will be sent to your email shortly and also appear in your My Tickets dashboard.';
    icon = '✅';
  } else if (phase === 'rejected') {
    title = 'Payment Not Confirmed';
    badge = '❌ Rejected';
    message = 'We could not confirm your payment. Please contact support on WhatsApp with your Order ID.';
    icon = '⚠️';
  }

  const step2Class = phase === 'pending' ? 'pending-step active' : 'pending-step done';
  const step3Class = phase === 'verified' ? 'pending-step done' : 'pending-step';

  return (
    <>
      <style>{PAGE_CSS}</style>
      <Nav />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Order Status</div>
          <h1 className="section-title reveal reveal-delay-1">Order <em>status</em></h1>
          <p className="section-sub reveal reveal-delay-2">This page refreshes automatically as your order is verified.</p>
        </div>
      </section>

      <section className="pending-section">
        <div className="container">
          <div className="pending-card reveal" id="pendingCard">
            {showSpinner && <div className="pending-spinner" id="pendingSpinner"></div>}
            {icon && (
              <div id="pendingIcon" style={{ fontSize: '3.5rem', marginBottom: 12 }}>{icon}</div>
            )}
            <h2 id="statusTitle">{title}</h2>
            <div className={'status-badge ' + badgeClass} id="statusBadge">{badge}</div>
            <p style={{ color: 'var(--text-2)', fontSize: '0.9rem', lineHeight: 1.6 }} id="statusMessage">{message}</p>

            <div className="pending-info">
              <div><strong>Order ID</strong> <span id="pOrderId">{esc(info.orderId || orderId || '—')}</span></div>
              <div><strong>Event</strong> <span id="pEventName">{esc(info.eventName || '—')}</span></div>
              <div><strong>Quantity</strong> <span id="pQty">{info.qty ? info.qty + ' ticket' + (info.qty > 1 ? 's' : '') : '—'}</span></div>
              <div><strong>Total</strong> <span id="pTotal">{info.amount ? fmtMoney(info.amount) : '—'}</span></div>
              <div><strong>Payment Method</strong> <span id="pPayment">Flutterwave</span></div>
            </div>

            <div className="pending-progress">
              <div className="pending-step done"><div className="dot">1</div>Order Placed</div>
              <div className={step2Class} id="step2"><div className="dot">{phase === 'pending' ? '2' : '✓'}</div>Payment</div>
              <div className={step3Class} id="step3"><div className="dot">{phase === 'verified' ? '✓' : '3'}</div>Verified</div>
            </div>

            {phase === 'pending' && (
              <div id="pendingActions">
                <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: 16 }}>
                  💡 If you&apos;ve already paid, you&apos;ll be redirected automatically once the payment is confirmed. This page refreshes every few seconds.
                </p>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 14, marginBottom: 0 }}>
                  <a href="/lookup.html" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Check my tickets →</a> &nbsp;|&nbsp;
                  <a href="/events.html" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Browse more events →</a>
                </p>
              </div>
            )}

            {phase === 'rejected' && (
              <div id="pendingActions">
                <a
                  href={'https://wa.me/' + waNumber + '?text=' + encodeURIComponent('Hello, I need help with my order ' + orderId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-cta-primary"
                  style={{ fontSize: '0.85rem', padding: '12px 28px' }}
                >
                  💬 Contact Support
                </a>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 12 }}>
                  <a href="/events.html" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Browse more events →</a>
                </p>
              </div>
            )}

            {phase === 'verified' && (
              <div id="verifiedActions">
                <div className="ticket-codes" id="verifiedTicketCodes">
                  {codes.length > 0 && (
                    <>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: 8 }}>
                        Your digital ticket(s):
                      </div>
                      {codes.map((tc, i) => (
                        <div className="tc-row" key={i}>
                          <span>Ticket {i + 1} / {codes.length}</span>
                          <a
                            href={'/ticket.html?orderId=' + encodeURIComponent(orderId) + '&code=' + encodeURIComponent(tc.code)}
                            style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}
                          >
                            <code>{esc(tc.code)}</code> →
                          </a>
                        </div>
                      ))}
                    </>
                  )}
                  {!codes.length && legacyTicketCode && (
                    <a
                      href={'/ticket.html?orderId=' + encodeURIComponent(orderId) + '&code=' + encodeURIComponent(legacyTicketCode)}
                      className="btn-primary"
                      style={{ display: 'inline-flex', padding: '12px 26px' }}
                    >
                      🎟 View My Ticket ({esc(legacyTicketCode)})
                    </a>
                  )}
                </div>
                <a href="/lookup.html" className="btn-cta-primary" style={{ fontSize: '0.85rem', padding: '12px 28px', marginRight: 8 }}>
                  🎟 Find My Ticket
                </a>
                <a href="/events.html" className="btn-cta-ghost" style={{ display: 'inline-flex', marginTop: 8 }}>
                  Browse More Events →
                </a>
              </div>
            )}

            {phase === 'missing' && (
              <div id="pendingActions">
                <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 14, marginBottom: 0 }}>
                  <a href="/events.html" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Browse events →</a>
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
