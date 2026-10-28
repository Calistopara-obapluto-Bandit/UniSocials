import { useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { esc, fmtN } from '../lib/utils.jsx';

/*
 * React port of ticket.html — the per-ticket QR page.
 *
 * Same ?orderId=&code= contract and same /api/ticket payload. The QR library
 * (qrcode.min.js, a root-level script exposing window.QRCode) is loaded on
 * demand so every other React page doesn't pay for it, and falls back to the
 * external QR image API exactly like the legacy page did.
 */

const PAGE_CSS = `
.ticket-section { padding: 56px 0 80px; }
.ticket-card { max-width: 560px; margin: 0 auto; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-lg); }
.ticket-header { background: linear-gradient(135deg, var(--accent), var(--accent-mid)); color: #fff; padding: 32px 36px; text-align: center; position: relative; }
.ticket-header h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 6px; }
.ticket-header p { font-size: 0.85rem; opacity: 0.9; }
.ticket-code { display: inline-block; margin-top: 14px; background: rgba(255,255,255,0.18); border: 1px dashed rgba(255,255,255,0.5); padding: 8px 20px; border-radius: 100px; font-family: monospace; font-size: 1rem; letter-spacing: 0.08em; font-weight: 700; }
.ticket-body { padding: 32px 36px; }
.ticket-event { text-align: center; font-size: 1.15rem; font-weight: 700; color: var(--text-1); margin-bottom: 4px; }
.ticket-detail { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed var(--border); font-size: 0.9rem; }
.ticket-detail:last-child { border-bottom: none; }
.ticket-detail span { color: var(--text-3); }
.ticket-detail strong { color: var(--text-1); }
.ticket-qr { text-align: center; margin: 28px 0 8px; }
.ticket-qr-holder { display: inline-block; background: #ffffff; padding: 12px; border-radius: 12px; border: 1px solid var(--border); box-shadow: var(--shadow-sm); line-height: 0; }
.ticket-qr canvas, .ticket-qr img { max-width: 240px; width: 100%; height: auto; display: block; background: #ffffff; }
.ticket-qr.used .ticket-qr-holder { border-color: #D1D5DB; background: #F9FAFB; opacity: 0.7; }
.ticket-qr-hint { font-size: 0.78rem; color: var(--text-3); margin-top: 10px; }
.ticket-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 24px; }
.ticket-note { margin-top: 18px; background: var(--accent-ghost); border: 1px solid var(--accent-border); border-radius: var(--radius); padding: 14px 18px; font-size: 0.82rem; color: var(--text-2); line-height: 1.6; text-align: center; }
.ticket-used-banner { margin: 14px 0 0; background: #F3F4F6; border: 1px solid #D1D5DB; border-radius: var(--radius); padding: 16px 18px; text-align: center; color: #4B5563; font-size: 0.88rem; line-height: 1.6; }
.ticket-used-banner strong { color: #374151; }
.ticket-used-stamp { display: inline-block; margin-top: 8px; border: 2px solid #6B7280; color: #6B7280; font-weight: 800; font-size: 1.05rem; letter-spacing: 0.18em; text-transform: uppercase; padding: 4px 18px; border-radius: 8px; transform: rotate(-6deg); }
.ticket-error { max-width: 560px; margin: 0 auto; text-align: center; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 56px 32px; box-shadow: var(--shadow-md); }
.ticket-error span { font-size: 3rem; display: block; margin-bottom: 14px; }
.ticket-error h2 { font-size: 1.4rem; font-weight: 700; color: var(--text-1); margin-bottom: 10px; }
.ticket-error p { font-size: 0.9rem; color: var(--text-3); margin-bottom: 24px; line-height: 1.6; }
@media (max-width: 480px) {
  .ticket-header, .ticket-body { padding: 24px 16px; }
  .ticket-detail { font-size: 0.82rem; gap: 8px; }
  .ticket-detail strong { min-width: 0; max-width: 62%; overflow-wrap: anywhere; word-break: break-word; line-height: 1.45; }
  .ticket-actions .btn-primary, .ticket-actions .btn-cta-ghost { width: 100%; }
}
@media (max-width: 360px) {
  .ticket-header, .ticket-body { padding-left: 12px; padding-right: 12px; }
  .ticket-detail { grid-template-columns: 1fr; gap: 3px; }
  .ticket-detail strong { max-width: 100%; }
}
@media print {
  body * { visibility: hidden; }
  .ticket-card, .ticket-card * { visibility: visible; }
  .ticket-card { position: absolute; left: 50%; top: 24px; transform: translateX(-50%); width: 100%; max-width: 560px; box-shadow: none !important; border: 2px solid #222; border-radius: 14px; }
  .ticket-card .ticket-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ticket-card .ticket-actions, .ticket-card .ticket-note { display: none !important; }
  .ticket-qr canvas, .ticket-qr img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const TIER_LABELS = { regular: 'Regular', vip: 'VIP', vvip: 'VVIP', table: 'Table' };

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Load qrcode.min.js at most once per page load.
let qrLibPromise = null;
function loadQrLib() {
  if (window.QRCode && typeof window.QRCode.toCanvas === 'function') return Promise.resolve(true);
  if (qrLibPromise) return qrLibPromise;
  qrLibPromise = new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = '/qrcode.min.js';
    const timer = setTimeout(() => resolve(false), 10000);
    el.onload = () => {
      clearTimeout(timer);
      resolve(!!(window.QRCode && typeof window.QRCode.toCanvas === 'function'));
    };
    el.onerror = () => { clearTimeout(timer); resolve(false); };
    document.head.appendChild(el);
  });
  return qrLibPromise;
}

export default function Ticket() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const orderId = (params.get('orderId') || '').trim();
  const code = (params.get('code') || '').trim();

  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [qrLibReady, setQrLibReady] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const qrBoxRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!orderId || !code) {
      setError({
        title: 'Missing link details',
        message: 'Please open this page from your order confirmation email or the My Tickets page.',
      });
      return undefined;
    }
    fetch('/api/ticket?orderId=' + encodeURIComponent(orderId) + '&code=' + encodeURIComponent(code))
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data && data.success && data.ticket) {
          setTicket(data.ticket);
          return;
        }
        const status = (data && data.status) || '';
        setError(status === 'pending'
          ? { title: 'Payment pending', message: 'Your order is awaiting payment confirmation. Your ticket will unlock once verified.' }
          : { title: 'Ticket not found', message: 'This ticket link is invalid or expired. Check your link or look up your order.' });
      })
      .catch(() => {
        if (!cancelled) setError({ title: 'Cannot load ticket', message: 'Network error. Please check your connection and try again.' });
      });
    return () => { cancelled = true; };
  }, [orderId, code]);

  useEffect(() => {
    let cancelled = false;
    loadQrLib().then((ok) => { if (!cancelled) setQrLibReady(ok); });
    return () => { cancelled = true; };
  }, []);

  // Draw the QR once we have both the ticket and the library.
  useEffect(() => {
    if (!ticket || !qrLibReady || qrFailed) return;
    const box = qrBoxRef.current;
    if (!box) return;
    const url = window.location.origin + '/ticket.html?orderId=' +
      encodeURIComponent(ticket.orderId || orderId) + '&code=' + encodeURIComponent(ticket.ticketCode || code);
    box.innerHTML = '';
    const canvas = document.createElement('canvas');
    box.appendChild(canvas);
    try {
      window.QRCode.toCanvas(canvas, url, {
        width: 264,
        margin: 4,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' },
      }, (err) => { if (err) setQrFailed(true); });
    } catch (e) {
      setQrFailed(true);
    }
  }, [ticket, qrLibReady, qrFailed, orderId, code]);

  const qrUrl = ticket
    ? 'https://api.qrserver.com/v1/create-qr-code/?size=264x264&margin=16&qzone=4&data=' +
      encodeURIComponent(window.location.origin + '/ticket.html?orderId=' +
        encodeURIComponent(ticket.orderId || orderId) + '&code=' + encodeURIComponent(ticket.ticketCode || code))
    : '';

  const tier = ticket ? (ticket.ticketTier || 'regular') : 'regular';
  const tierLabel = TIER_LABELS[tier] || tier.charAt(0).toUpperCase() + tier.slice(1);

  return (
    <>
      <style>{PAGE_CSS}</style>
      <Nav />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">My Ticket</div>
          <h1 className="section-title reveal reveal-delay-1">Your <em>digital ticket</em></h1>
          <p className="section-sub reveal reveal-delay-2">Present this ticket at the entrance. Scan it to verify your booking.</p>
        </div>
      </section>

      <section className="ticket-section">
        <div className="container">
          {error && (
            <div className="ticket-error" id="ticketError">
              <span>🔒</span>
              <h2 id="ticketErrorTitle">{esc(error.title)}</h2>
              <p id="ticketErrorMsg">{esc(error.message)}</p>
              <a href="/lookup.html" className="btn-primary" style={{ display: 'inline-flex', padding: '12px 28px' }}>Find My Ticket</a>
            </div>
          )}

          {ticket && (
            <div className="ticket-card reveal" id="ticketCard">
              <div className="ticket-header">
                <h2>🎟️ Unisocials Ticket</h2>
                <p>Official Entry Pass</p>
                <div className="ticket-code" id="ticketCode">{esc(ticket.ticketCode)}</div>
              </div>
              <div className="ticket-body">
                <div className="ticket-event" id="ticketEventName">{esc(ticket.eventName)}</div>

                <div style={{ marginTop: 18 }}>
                  <div className="ticket-detail"><span>Order ID</span><strong id="ticketOrderId">{esc(ticket.orderId)}</strong></div>
                  <div className="ticket-detail"><span>📅 Date</span><strong id="ticketDate">{esc(ticket.eventDate)}</strong></div>
                  <div className="ticket-detail"><span>🏛 University</span><strong id="ticketUniversity">{esc(ticket.universityName || '—')}</strong></div>
                  <div className="ticket-detail"><span>📍 Venue</span><strong id="ticketVenue">{esc(ticket.eventVenue)}</strong></div>
                  <div className="ticket-detail"><span>🎟 Ticket Type</span><strong id="ticketTier">{esc(tierLabel)}</strong></div>
                  <div className="ticket-detail"><span>🎁 Included</span><strong id="ticketIncluded">{esc(ticket.included || '—')}</strong></div>
                  <div className="ticket-detail"><span>🎟 Quantity</span><strong id="ticketQty">{ticket.qty} ticket{Number(ticket.qty) > 1 ? 's' : ''}</strong></div>
                  <div className="ticket-detail"><span>💳 Amount</span><strong id="ticketAmount">{fmtN(ticket.amount)}</strong></div>
                  <div className="ticket-detail"><span>👤 Ticket Holder</span><strong id="ticketHolder">{esc(ticket.buyerName)}</strong></div>
                  <div className="ticket-detail"><span>✅ Verified</span><strong id="ticketVerified">{fmtDate(ticket.verifiedAt)}</strong></div>
                </div>

                <div className={'ticket-qr' + (ticket.used ? ' used' : '')} id="ticketQrWrap">
                  <div className="ticket-qr-holder">
                    {qrFailed
                      ? <img src={qrUrl} alt="Ticket QR code" />
                      : <div id="qrBox" ref={qrBoxRef}></div>}
                  </div>
                  <p className="ticket-qr-hint">Show this QR code at the gate for scanning.</p>
                </div>

                {ticket.used && (
                  <div className="ticket-used-banner" id="ticketUsedBanner">
                    <strong>This ticket has already been used.</strong>
                    <div>It was checked in at the gate.</div>
                    <span className="ticket-used-stamp">USED</span>
                    <div id="ticketUsedAt" style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 6 }}>
                      Used on: {fmtDate(ticket.usedAt)}
                    </div>
                  </div>
                )}

                <div className="ticket-actions">
                  <button className="btn-primary" style={{ display: 'inline-flex', gap: 8, padding: '12px 28px' }} onClick={() => window.print()}>
                    🖨 Print Ticket
                  </button>
                  <a href="/lookup.html" className="btn-cta-ghost" style={{ display: 'inline-flex' }}>Find My Ticket</a>
                </div>

                <div className="ticket-note">
                  💡 Keep this page safe. One QR code is generated per ticket. For support, contact us on WhatsApp.
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </>
  );
}
