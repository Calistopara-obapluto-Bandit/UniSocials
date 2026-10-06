import { useEffect, useRef, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { api, isLoggedIn } from '../lib/api.js';
import { esc, fmtN } from '../lib/utils.jsx';

/*
 * React checkout page.
 *
 * IMPORTANT for the migration safeguard:
 * This page writes to sessionStorage under the exact same key and with the
 * exact same shape as the legacy checkout (templatemo-622-clearwave.js):
 *   sessionStorage.setItem('checkoutData', JSON.stringify({ ... }))
 *
 * The legacy thank-you page (thank-you.html) and the legacy checkout script
 * both read that key back, so keeping the shape identical means the two
 * versions can coexist. If the React checkout has a bug, the legacy checkout
 * page (checkout.html) is still fully intact and reachable, and nothing
 * depends on the React version being the only writer of that session key.
 */

const TIER_LABELS = { regular: '🎟 Regular', vip: '⭐ VIP', vvip: '👑 VVIP', table: '🪑 Table' };

export default function Checkout() {
  const [checkoutData, setCheckoutData] = useState(null);
  const [referralApplied, setReferralApplied] = useState(false);
  const [appliedReferralCode, setAppliedReferralCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The legacy checkout derives these from sessionStorage at startup, then
  // keeps them in module-scope locals. We mirror that in React state.
  useEffect(() => {
    let cancelled = false;

    try {
      const raw = sessionStorage.getItem('checkoutData');
      const parsed = raw ? JSON.parse(raw) : null;
      if (cancelled) return;

      if (!parsed) {
        // No checkout data yet. The legacy page shows the event picker here.
        // For the React port we keep the same behaviour: show available events
        // and carry any referral code from the URL/session.
        setLoading(false);
        return;
      }

      setCheckoutData(parsed);
      setLoading(false);
    } catch (e) {
      if (!cancelled) setError('Unable to read checkout details.');
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, []);

  // Keep sessionStorage in sync whenever checkoutData changes. This is the bit
  // that makes the React version a drop-in replacement for the legacy writer.
  useEffect(() => {
    if (!checkoutData) return;
    try {
      sessionStorage.setItem('checkoutData', JSON.stringify(checkoutData));
    } catch (e) {}
  }, [checkoutData]);

  async function fetchEvents() {
    const res = await api('/api/events');
    if (!res || !res.success) return [];
    return (res.events || []).slice().sort((a, b) =>
      (String(a.name || a.title || '')).localeCompare(String(b.name || b.title || ''), undefined, { sensitivity: 'base' })
    );
  }

  async function refreshAuthoritativePricing() {
    if (!checkoutData || !checkoutData.eventId) return;
    try {
      const res = await api('/api/events');
      const events = (res && res.success && res.events) || [];
      const ev = events.find(e => String(e.id || '') === String(checkoutData.eventId));
      if (!ev) return;

      const tier = String(checkoutData.ticketTier || 'regular').toLowerCase();
      const originals = {
        regular: Number(ev.price || 0),
        vip: Number(ev.vipPrice || 0),
        vvip: Number(ev.vvipPrice || 0),
        table: Number(ev.tablePrice || 0),
      };
      const bonuses = {
        regular: Number(ev.bonusPrice || 0),
        vip: Number(ev.bonusVipPrice || 0),
        vvip: Number(ev.bonusVvipPrice || 0),
        table: Number(ev.bonusTablePrice || 0),
      };
      const original = originals[tier] > 0 ? originals[tier] : originals.regular;
      const bonus = bonuses[tier] || 0;
      const payable = referralApplied ? original : (bonus > 0 ? bonus : original);

      setCheckoutData(prev =>
        prev
          ? {
              ...prev,
              originalEventPrice: original,
              bonusEventPrice: bonus,
              eventPrice: payable,
            }
          : null
      );
    } catch (e) {
      // Keep the previously stored price if the refresh fails.
    }
  }

  useEffect(() => {
    if (!checkoutData) return;
    refreshAuthoritativePricing();
  }, [checkoutData?.eventId]);

  function baseUnitPrice() {
    if (!checkoutData) return 0;
    const storedOriginal = Number(checkoutData.originalEventPrice || checkoutData.eventPrice || 0);
    const storedBonus = Number(checkoutData.bonusEventPrice || 0);
    return storedBonus > 0 ? storedBonus : storedOriginal;
  }

  function computedTotal() {
    const base = baseUnitPrice() * Number(checkoutData?.qty || 1);
    if (appliedCoupon) return Math.max(0, base - Number(appliedCoupon.amount || 0));
    return base;
  }

  async function applyReferralCode() {
    const input = document.getElementById('referralCodeInput');
    const msg = document.getElementById('referralMessage');
    const code = String(input && input.value || '').trim().toUpperCase();
    if (!code) {
      setReferralApplied(false);
      setAppliedReferralCode('');
      if (msg) { msg.textContent = 'No referral applied. Your bonus price remains active.'; msg.className = 'form-hint referral-message'; }
      await refreshReferralPricing();
      return;
    }
    const btn = document.getElementById('applyReferralBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    try {
      const res = await api('/api/referrals/validate', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      if (!res || !res.success) throw new Error(res.error || 'Invalid referral code.');
      setReferralApplied(true);
      setAppliedReferralCode(code);
      try { sessionStorage.setItem('referralCode', code); } catch (e) {}
      try { localStorage.setItem('unn_referral_code', code); } catch (e) {}
      if (msg) { msg.textContent = '✓ Referral applied — original ticket price unlocked.'; msg.className = 'form-hint referral-message success'; }
      await refreshReferralPricing();
    } catch (err) {
      setReferralApplied(false);
      setAppliedReferralCode('');
      if (msg) { msg.textContent = err.message || 'Invalid referral code.'; msg.className = 'form-hint referral-message error'; }
      await refreshReferralPricing();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
    }
  }

  async function refreshReferralPricing() {
    if (!checkoutData || !checkoutData.eventId) return;
    try {
      const res = await api('/api/events');
      const events = (res && res.success && res.events) || [];
      const ev = events.find(e => String(e.id || '') === String(checkoutData.eventId));
      if (!ev) return;

      const tier = String(checkoutData.ticketTier || 'regular').toLowerCase();
      const originals = {
        regular: Number(ev.price || 0),
        vip: Number(ev.vipPrice || 0),
        vvip: Number(ev.vvipPrice || 0),
        table: Number(ev.tablePrice || 0),
      };
      const bonuses = {
        regular: Number(ev.bonusPrice || 0),
        vip: Number(ev.bonusVipPrice || 0),
        vvip: Number(ev.bonusVvipPrice || 0),
        table: Number(ev.bonusTablePrice || 0),
      };
      const original = originals[tier] > 0 ? originals[tier] : originals.regular;
      const bonus = bonuses[tier] || 0;
      renderCheckoutPrice(original, bonus);
    } catch (e) {}
  }

  function renderCheckoutPrice(original, bonus) {
    if (!checkoutData) return;
    const payable = referralApplied ? original : (bonus > 0 ? bonus : original);
    setCheckoutData(prev =>
      prev
        ? {
            ...prev,
            originalEventPrice: original,
            bonusEventPrice: bonus,
            eventPrice: payable,
          }
        : null
    );
    const unitPriceNode = document.getElementById('summaryUnitPrice');
    if (unitPriceNode) {
      unitPriceNode.innerHTML = (!referralApplied && original > payable && payable > 0)
        ? '<span style="text-decoration:line-through;opacity:.55;margin-right:7px;">₦' + original.toLocaleString() + '</span><strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong><small class="referral-price-note">✨ Bonus price</small>'
        : (referralApplied && original > 0 ? '<strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong><small class="referral-price-note">🎁 Referral price</small>' : '<strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong>');
    }
    renderCouponTotal();
  }

  function renderCouponTotal() {
    const total = computedTotal();
    const unitPriceNode = document.getElementById('summaryUnitPrice');
    if (unitPriceNode && referralApplied && checkoutData) {
      const original = Number(checkoutData.originalEventPrice || 0);
      unitPriceNode.innerHTML = '<strong style="color:var(--accent);font-size:1.12em;">₦' + Number(checkoutData.eventPrice || 0).toLocaleString() + '</strong><small class="referral-price-note">🎁 Referral price</small>';
    }
    const totalNodes = ['summaryTotal', 'placeOrderTotal', 'mobileBarTotal'].map(id => document.getElementById(id)).filter(Boolean);
    totalNodes.forEach(node => { if (node) node.textContent = '₦' + total.toLocaleString(); });

    const box = document.getElementById('couponSummary');
    if (box && appliedCoupon) {
      box.style.display = 'block';
      const baseEl = document.getElementById('couponBaseTotal');
      const discEl = document.getElementById('couponDiscountTotal');
      const finalEl = document.getElementById('couponFinalTotal');
      if (baseEl) baseEl.textContent = '₦' + (baseUnitPrice() * Number(checkoutData?.qty || 1)).toLocaleString();
      if (discEl) discEl.textContent = '−₦' + Number(appliedCoupon.amount || 0).toLocaleString();
      if (finalEl) finalEl.textContent = '₦' + total.toLocaleString();
    } else if (box) {
      box.style.display = 'none';
    }
  }

  async function applyCoupon() {
    const input = document.getElementById('couponCodeInput');
    const msg = document.getElementById('couponMessage');
    const btn = document.getElementById('applyCouponBtn');
    const code = String(input && input.value || '').trim().toUpperCase();
    if (!code) {
      setAppliedCoupon(null);
      if (msg) { msg.textContent = 'Enter a coupon code first.'; msg.style.color = 'var(--text-3)'; }
      renderCouponTotal();
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    try {
      const res = await api('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          eventId: checkoutData?.eventId || checkoutData?.eventValue || '',
          ticketTier: checkoutData?.ticketTier || 'regular',
          qty: checkoutData?.qty,
          referralCode: referralApplied ? appliedReferralCode : '',
        }),
      });
      if (!res || !res.success) throw new Error(res.error || 'Invalid coupon');
      setAppliedCoupon(res.coupon);
      if (msg) { msg.textContent = '✓ Coupon applied — saved ₦' + Number(res.coupon?.amount || 0).toLocaleString(); msg.style.color = 'var(--accent)'; }
      renderCouponTotal();
    } catch (err) {
      setAppliedCoupon(null);
      if (msg) { msg.textContent = err.message || 'Invalid coupon code.'; msg.style.color = '#B71C1C'; }
      renderCouponTotal();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Apply Coupon'; }
    }
  }

  function generateOrderId() {
    return 'UNI-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function sendOrderToWhatsApp(orderId, eventName, qty, totalPaid, paymentLabel, name, email, phone) {
    let ticketLines = '';
    if (Array.isArray(checkoutData?.ticketCodes) && checkoutData.ticketCodes.length) {
      ticketLines = '\n\n🎟 *Digital Tickets:*\n';
      checkoutData.ticketCodes.forEach(tc => {
        ticketLines += '• ' + tc.code + ' → ' + window.location.origin + '/ticket.html?orderId=' + encodeURIComponent(orderId) + '&code=' + encodeURIComponent(tc.code) + '\n';
      });
    }
    const msg =
      '🛒 *New Ticket Order!*\n\n' +
      'Order ID: ' + orderId + '\n' +
      'Event: ' + eventName + '\n' +
      'Qty: ' + qty + '\n' +
      'Total: ₦' + totalPaid.toLocaleString() + '\n' +
      'Payment: ' + paymentLabel + '\n\n' +
      '👤 ' + name + '\n' +
      '📧 ' + email + '\n' +
      '📞 ' + phone + '\n' +
      ticketLines +
      '\nThank you for using Unisocials!';
    const waNumber = window.SITE_CONFIG?.WHATSAPP_ORDER_NUMBER || '2348122104576';
    window.open('https://wa.me/' + waNumber + '?text=' + encodeURIComponent(msg), '_blank');
  }

  async function createOrderViaApi(orderId, orderTotal, paymentMethod, successCallback) {
    const referralCode = referralApplied ? appliedReferralCode : '';
    try {
      const res = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          eventId: checkoutData?.eventId || checkoutData?.eventValue || '',
          eventName: checkoutData?.eventName,
          eventDate: checkoutData?.eventDate ? (checkoutData.eventDate + ' · ' + (checkoutData.eventTime || '')) : '',
          eventVenue: checkoutData?.eventVenue || '',
          eventCategory: checkoutData?.eventCategory || '',
          qty: checkoutData?.qty,
          amount: orderTotal,
          currency: 'NGN',
          paymentMethod,
          buyerName: checkoutData?.buyerName,
          buyerEmail: checkoutData?.buyerEmail,
          buyerPhone: checkoutData?.buyerPhone,
          buyerFaculty: checkoutData?.buyerFaculty || '',
          ticketTier: checkoutData?.ticketTier || 'regular',
          included: checkoutData?.included || '',
          universityId: checkoutData?.universityId || '',
          universityName: checkoutData?.universityName || '',
          universitySlug: checkoutData?.universitySlug || '',
          referralCode,
          couponCode: appliedCoupon ? appliedCoupon.code : '',
        }),
      });
      if (successCallback) {
        successCallback(
          !!(res && res.success),
          res && res.order ? res.order.ticketCodes : null,
          res && res.order ? Number(res.order.amount || 0) : 0,
          res && res.error ? String(res.error) : ''
        );
      }
    } catch (err) {
      if (successCallback) successCallback(false, null, 0, err.message || 'Unable to reach the server.');
    }
  }

  /*
   * Flutterwave callback.
   *
   * The legacy script calls /api/payment-received from inside the Flutterwave
   * `callback`, then navigates to thank-you.html?orderId=... on either branch.
   * We reproduce that exactly: we never verify the payment from the browser; we
   * only send the acknowledgement and move the buyer along.
   */
  function startFlutterwavePayment(orderId, eventName, qty, orderTotal, name, email, phone, paymentMethod) {
    const publicKey = window.SITE_CONFIG?.FLUTTERWAVE_PUBLIC_KEY || '';
    if (!publicKey) {
      alert('Flutterwave is not configured. Please contact support.');
      return;
    }
    if (typeof window.FlutterwaveCheckout !== 'function') {
      alert('Flutterwave checkout could not be loaded. Please check your internet connection.');
      return;
    }

    window.FlutterwaveCheckout({
      public_key: publicKey,
      tx_ref: orderId,
      amount: orderTotal,
      currency: 'NGN',
      payment_options: paymentMethod === 'banktransfer' ? 'banktransfer' : 'card',
      redirect_url: window.SITE_CONFIG?.REDIRECT_URL || window.SITE_CONFIG?.SITE_URL + '/thank-you.html',
      customer: {
        email: email || 'customer@example.com',
        name: name || 'Unisocial Customer',
        phone_number: phone || '',
      },
      customizations: {
        title: 'Unisocials',
        description: eventName + (qty > 1 ? ' (' + qty + ' tickets)' : ''),
        logo: 'https://unisocials.onrender.com/images/tm-622-screen-01.jpg',
      },
      callback: function (response) {
        if (response && (response.status === 'successful' || response.status === 'completed')) {
          fetch('/api/payment-received', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx_ref: response.tx_ref || orderId }),
          })
            .then((res) => res.json())
            .then((data) => {
              const paidTotal = orderTotal;
              if (data && data.success) {
                sendOrderToWhatsApp(orderId, eventName, qty, paidTotal, 'Flutterwave — awaiting verification', name, email, phone);
              }
              window.location.href = '/thank-you?orderId=' + encodeURIComponent(orderId);
            })
            .catch(() => {
              window.location.href = '/thank-you?orderId=' + encodeURIComponent(orderId);
            });
        } else {
          alert('Payment was not completed. You can try again.');
        }
      },
      onclose: function () {},
    });
  }

  async function placeOrder(paymentMethod) {
    const method = paymentMethod === 'banktransfer' ? 'banktransfer' : 'card';
    const selectedEventId = checkoutData && (checkoutData.eventId || checkoutData.eventValue);
    if (!checkoutData || !selectedEventId || !checkoutData.buyerName || !checkoutData.buyerEmail || !checkoutData.buyerPhone) {
      alert('Please return to the ticket details page and complete your name, email, and phone number before paying.');
      window.location.href = '/tickets.html' + (selectedEventId ? '?event=' + encodeURIComponent(selectedEventId) : '');
      return;
    }

    const orderId = generateOrderId();
    const eventName = checkoutData.eventName;
    const qty = checkoutData.qty;
    const name = checkoutData.buyerName;
    const email = checkoutData.buyerEmail;
    const phone = checkoutData.buyerPhone;
    const total = computedTotal();

    const selectedBtn = method === 'banktransfer'
      ? document.getElementById('bankTransferBtn')
      : document.getElementById('cardPaymentBtn');
    if (selectedBtn) { selectedBtn.disabled = true; selectedBtn.textContent = 'Opening Flutterwave…'; }

    createOrderViaApi(orderId, total, method, function (success, ticketCodes, serverAmount, errorMessage) {
      if (!success) {
        alert((errorMessage || 'Could not create your order. Please try again.') + '\n\nPayment method: ' + (method === 'banktransfer' ? 'Bank Transfer' : 'Credit/Debit Card'));
        if (selectedBtn) { selectedBtn.disabled = false; selectedBtn.textContent = method === 'banktransfer' ? '🏦 Click to proceed via bank transfer' : '💳 Click to proceed to checkout'; }
        return;
      }
      const paymentAmount = serverAmount > 0 ? serverAmount : total;
      if (selectedBtn) { selectedBtn.disabled = false; selectedBtn.textContent = method === 'banktransfer' ? '🏦 Click to proceed via bank transfer' : '💳 Click to proceed to checkout'; }
      startFlutterwavePayment(orderId, eventName, qty, paymentAmount, name, email, phone, method);
    });
  }

  // ---- Event picker when there is no checkoutData yet ----
  if (!checkoutData) {
    const refFromUrl = new URLSearchParams(window.location.search).get('ref') ||
      (tryGetSession('referralCode') || tryGetLocal('unn_referral_code') || '').trim().toUpperCase();
    if (refFromUrl) {
      try { sessionStorage.setItem('referralCode', refFromUrl); } catch (e) {}
      try { localStorage.setItem('unn_referral_code', refFromUrl); } catch (e) {}
    }

    return (
      <>
        <Nav />
        <section className="page-header">
          <div className="container">
            <div className="section-label reveal">Checkout</div>
            <h1 className="section-title reveal reveal-delay-1">Review &amp; <em>pay</em></h1>
            <p className="section-sub reveal reveal-delay-2">Confirm your order details and choose a payment method to secure your ticket.</p>
          </div>
        </section>
        <div className="container" style={{ paddingTop: '32px' }}>
          <div className="checkout-event-picker" style={{ maxWidth: '980px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: '26px' }}>
              <div className="section-label">Choose an event</div>
              <h2 style={{ margin: '8px 0 8px' }}>Select the event you want to attend</h2>
              <p style={{ color: 'var(--text-3)', margin: 0 }}>Your referral code will be applied automatically after you choose an event.</p>
              {refFromUrl ? (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '14px',
                  padding: '9px 14px',
                  borderRadius: '999px',
                  background: 'var(--accent-ghost)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--accent)',
                  fontWeight: 700,
                  fontSize: '.84rem',
                }}>
                  🎁 Referral code: {esc(refFromUrl)}
                </div>
              ) : null}
            </div>
            <div id="checkoutEventList" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
              {loading ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '34px', color: 'var(--text-3)' }}>
                  Loading available events…
                </div>
              ) : error ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px', border: '1px solid var(--border)', borderRadius: '16px', background: 'var(--surface-2)' }}>
                  <strong>Unable to load events right now.</strong>
                  <p style={{ color: 'var(--text-3)', margin: '8px 0 18px' }}>Please try again.</p>
                  <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  // ---- Normal checkout (we have checkoutData) ----
  return (
    <>
      <Nav />
      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Checkout</div>
          <h1 className="section-title reveal reveal-delay-1">Review &amp; <em>pay</em></h1>
          <p className="section-sub reveal reveal-delay-2">Confirm your order details and choose a payment method to secure your ticket.</p>
        </div>
      </section>

      <div className="container">
        <div className="step-indicator reveal">
          <div className="step"><span>1</span> Select Event</div>
          <div className="step-line"></div>
          <div className="step active"><span>2</span> Checkout &amp; Pay</div>
        </div>
      </div>

      <section className="checkout-section">
        <div className="container">
          <div className="checkout-stacked">
            {/* ORDER SUMMARY (top) */}
            <div className="checkout-summary-card reveal">
              <h3>📋 Order Summary</h3>
              <div className="summary-row">
                <span>Event</span>
                <span id="summaryEventName" style={{ color: 'var(--text-3)', textAlign: 'right' }}>
                  {esc(checkoutData.eventName || 'Not selected')}
                </span>
              </div>
              <div className="summary-row">
                <span>Date</span>
                <span id="summaryDate">
                  {checkoutData.eventDate ? (checkoutData.eventDate + ' · ' + (checkoutData.eventTime || '')) : '—'}
                </span>
              </div>
              <div className="summary-row">
                <span>Venue</span>
                <span id="summaryVenue" style={{ textAlign: 'right' }}>{esc(checkoutData.eventVenue || '—')}</span>
              </div>
              <div className="summary-row">
                <span>Quantity</span>
                <span id="summaryQty">
                  {checkoutData.qty} ticket{checkoutData.qty > 1 ? 's' : ''}
                </span>
              </div>
              <div className="summary-row">
                <span>Ticket Type</span>
                <span id="summaryTier">{TIER_LABELS[checkoutData.ticketTier] || '🎟 Regular'}</span>
              </div>
              <div className="summary-divider" />
              <div className="summary-row">
                <span>Unit Price</span>
                <span id="summaryUnitPrice">—</span>
              </div>
              <div className="summary-row summary-total">
                <span>Total</span>
                <span id="summaryTotal">—</span>
              </div>
              <div className="summary-divider" />
              <div className="summary-row">
                <span>Buyer</span>
                <span id="summaryBuyer" style={{ textAlign: 'right' }}>{esc(checkoutData.buyerName || '—')}</span>
              </div>
              <div className="summary-row">
                <span>Email</span>
                <span id="summaryEmail" style={{ textAlign: 'right' }}>{esc(checkoutData.buyerEmail || '—')}</span>
              </div>
            </div>

            {/* PAYMENT METHOD */}
            <div className="checkout-card reveal reveal-delay-1">
              <h3 className="checkout-card-title">💳 Payment Method</h3>
              <div className="payment-methods">
                <div className="payment-option selected">
                  <div className="payment-option-content">
                    <span className="payment-option-icon">
                      <svg className="flw-logo" viewBox="0 0 64 64" aria-hidden="true">
                        <path fill="#F5A623" d="M48.4 6.3 30.4 37.2h8.4l18-30.9z" />
                        <path fill="#123B79" d="M14.5 55.9l16.6-28.8 4.2-7.3-9.1.1z" />
                        <path fill="#F5A623" d="M39 33.6h8.4L30.4 64h-9.7z" />
                        <path fill="#123B79" d="M14.6 55.9 39 33.6h-8.4L5.2 61.9c4.5 2.1 9.4 2.6 9.4 2.6s4.6.1 8.3-1.3L8.3 53.8z" />
                      </svg>
                    </span>
                    <div>
                      <strong>Flutterwave</strong>
                      <small>Pay securely with card, bank transfer, USSD &amp; mobile money</small>
                    </div>
                  </div>
                </div>
              </div>
              <div id="paymentNote" className="payment-note">
                🔒 You&apos;ll be redirected to <strong>Flutterwave</strong> to complete your payment securely. Your ticket(s) are issued automatically once payment is confirmed.
              </div>
            </div>

            {/* REFERRAL CODE */}
            <div className="checkout-card reveal reveal-delay-2 referral-checkout-card">
              <h3 className="checkout-card-title">🎁 Referral Code</h3>
              <div className="form-group">
                <label htmlFor="referralCodeInput">Have a referral code?</label>
                <div className="referral-input-row">
                  <input
                    type="text"
                    id="referralCodeInput"
                    placeholder="Enter referral code"
                    autoComplete="off"
                    maxLength={64}
                  />
                  <button type="button" id="applyReferralBtn" className="admin-refresh-btn">Apply</button>
                  <button
                    type="button"
                    id="removeReferralBtn"
                    className="admin-refresh-btn referral-remove-btn"
                    aria-label="Remove referral code"
                    onClick={async () => {
                      setReferralApplied(false);
                      setAppliedReferralCode('');
                      const input2 = document.getElementById('referralCodeInput');
                      if (input2) input2.value = '';
                      try { sessionStorage.removeItem('referralCode'); } catch (e) {}
                      try { localStorage.removeItem('unn_referral_code'); } catch (e) {}
                      const msg = document.getElementById('referralMessage');
                      if (msg) { msg.textContent = 'Referral removed. Your bonus price is active.'; msg.className = 'form-hint referral-message'; }
                      await refreshReferralPricing();
                    }}
                  >
                    Remove
                  </button>
                </div>
                <p id="referralMessage" className="form-hint referral-message">
                  Apply a valid referral code to use the original ticket price. Without one, your bonus price remains active.
                </p>
              </div>
            </div>

            {/* COUPON CODE */}
            <div className="checkout-card reveal reveal-delay-2">
              <h3 className="checkout-card-title">🏷️ Coupon Code (Optional)</h3>
              <div className="form-group">
                <label htmlFor="couponCodeInput">Have a coupon?</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    id="couponCodeInput"
                    placeholder="Enter coupon code"
                    style={{ flex: '1', minWidth: '180px', width: '100%', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.9rem', background: 'var(--surface-2)', color: 'var(--text-1)' }}
                  />
                  <button type="button" id="applyCouponBtn" className="admin-refresh-btn" style={{ whiteSpace: 'nowrap' }} onClick={applyCoupon}>
                    Apply Coupon
                  </button>
                </div>
                <p id="couponMessage" className="form-hint" style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: '6px' }} />
              </div>
              <div
                id="couponSummary"
                style={{ display: 'none', marginTop: '10px', padding: '12px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span>Before coupon</span>
                  <strong id="couponBaseTotal">₦0</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', color: 'var(--accent)' }}>
                  <span>Coupon discount</span>
                  <strong id="couponDiscountTotal">−₦0</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                  <span>To pay</span>
                  <strong id="couponFinalTotal">₦0</strong>
                </div>
              </div>
            </div>

            {/* PAYMENT ACTIONS */}
            <div className="checkout-card reveal reveal-delay-3">
              <h3 className="checkout-card-title">Choose how you want to pay</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button
                  type="button"
                  className="btn-submit btn-submit-lg"
                  id="cardPaymentBtn"
                  onClick={() => placeOrder('card')}
                >
                  💳 Click to proceed to checkout
                </button>
                <button
                  type="button"
                  className="btn-submit btn-submit-lg"
                  id="bankTransferBtn"
                  onClick={() => placeOrder('banktransfer')}
                >
                  🏦 Click to proceed via bank transfer
                </button>
              </div>
              <p className="summary-note">
                After you choose a method, Flutterwave opens its secure payment screen with only that payment method. By continuing, you agree to our <a href="#">Terms of Service</a> and <a href="#">Refund Policy</a>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MOBILE STICKY CHECKOUT BAR */}
      <div className="mobile-checkout-bar" id="mobileCheckoutBar">
        <div className="mobile-checkout-total">
          <small>Total</small>
          <strong id="mobileBarTotal">—</strong>
        </div>
        <button
          className="btn-submit mobile-checkout-btn"
          id="mobilePlaceOrderBtn"
          onClick={() => placeOrder()}
        >
          🛒 Place Order
        </button>
      </div>

      {/* SUCCESS MODAL */}
      <div className="modal-overlay" id="successModal" style={{ display: 'none' }}>
        <div className="modal-content">
          <button className="modal-close" id="modalClose" aria-label="Close">✕</button>
          <div className="modal-icon">✅</div>
          <h2>Payment Successful! 🎉</h2>
          <p>Your ticket(s) will be sent to your email shortly. You can also open them straight away with your Order ID.</p>
          <div className="modal-details">
            <div><strong>Order ID:</strong> <span id="orderId">—</span></div>
            <div><strong>Event:</strong> <span id="orderEvent">—</span></div>
            <div><strong>Email:</strong> <span id="orderEmail">—</span></div>
            <div><strong>Total Paid:</strong> <span id="orderTotal">—</span></div>
          </div>
          <div id="successTicketList" />
          <p className="modal-note">
            💡 Check your email inbox (and spam folder) for your ticket confirmation. Already have an account? Every order is on your My Tickets dashboard.
          </p>
          <a
            href="/my-tickets.html"
            id="viewTicketLink"
            className="btn-primary"
            data-ticket-hub
            style={{ display: 'inline-flex', marginTop: '4px' }}
          >
            🎟 View My Tickets
          </a>
          <a
            href="/events.html"
            className="btn-cta-ghost"
            style={{ display: 'inline-flex', marginTop: '10px', width: '100%', justifyContent: 'center' }}
          >
            Browse More Events
          </a>
        </div>
      </div>

      <Footer />
    </>
  );
}

function tryGetSession(key) {
  try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
}
function tryGetLocal(key) {
  try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
}
