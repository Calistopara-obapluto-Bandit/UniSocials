import { useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { esc, fmtN } from '../lib/utils.jsx';

/*
 * React port of tickets.html — step 1 of the purchase funnel.
 *
 * It reads the same query params (?event=, ?university=, ?ref=) and writes the
 * same sessionStorage payload ("checkoutData") under the same key and shape as
 * the legacy page, so the legacy tickets.html and this page can be swapped by
 * simply changing which route the server serves. Checkout.jsx re-derives
 * authoritative pricing from /api/events on mount, so the stored prices here
 * only need to be plausible — the ids, tier, quantity and buyer details are
 * what actually matter.
 */

const TIERS = ['regular', 'vip', 'vvip', 'table'];
const TIER_LABELS = { regular: '🎟 Regular', vip: '⭐ VIP', vvip: '👑 VVIP', table: '🪑 Table' };

// Same rules the legacy page enforced with setCustomValidity().
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,79}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9 ()-]{7,20}$/;

function tierPrice(ev, tier) {
  if (!ev) return 0;
  const map = {
    regular: Number(ev.price || 0),
    vip: Number(ev.vipPrice || 0),
    vvip: Number(ev.vvipPrice || 0),
    table: Number(ev.tablePrice || 0),
  };
  return map[tier] || 0;
}

function tierBonus(ev, tier) {
  if (!ev) return 0;
  const map = {
    regular: Number(ev.bonusPrice || 0),
    vip: Number(ev.bonusVipPrice || 0),
    vvip: Number(ev.bonusVvipPrice || 0),
    table: Number(ev.bonusTablePrice || 0),
  };
  return map[tier] || 0;
}

function tierIncluded(ev, tier) {
  if (!ev) return '';
  const map = {
    regular: ev.includedRegular || '',
    vip: ev.includedVip || '',
    vvip: ev.includedVVIP || '',
    table: ev.includedTable || '',
  };
  return map[tier] || '';
}

function tierInventory(ev, tier) {
  const inv = (ev && ev.inventory) || {};
  const slot = inv[tier] || {};
  return {
    total: Number(slot.total || 0),
    sold: Number(slot.sold || 0),
    remaining: Number(slot.remaining || 0),
    soldOut: !!slot.soldOut,
  };
}

// "What's Included" — comma/pipe separated list rendered as bullets.
function includedItems(raw) {
  if (!raw) return [];
  let items = String(raw).split(',');
  if (items.length === 1) items = String(raw).split('|');
  return items.map((s) => s.trim()).filter(Boolean);
}

function sortEvents(list) {
  return list.slice().sort((a, b) => {
    const ua = String(a.universityName || a.university || '').trim()
      .localeCompare(String(b.universityName || b.university || '').trim(), undefined, { sensitivity: 'base' });
    if (ua) return ua;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
}

const PAGE_CSS = `
.ticket-type-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 4px; }
.ticket-type-option { position: relative; border: 1.5px solid var(--border); border-radius: var(--radius); padding: 14px 12px; text-align: center; cursor: pointer; background: var(--surface-2); transition: border-color 0.3s, background 0.3s; }
.ticket-type-option:hover { border-color: var(--accent-border); background: var(--accent-ghost); }
.ticket-type-option.selected { border-color: var(--accent); background: var(--accent-ghost); box-shadow: 0 0 0 3px var(--accent-ghost); }
.ticket-type-option input { position: absolute; opacity: 0; pointer-events: none; }
.ticket-type-name { display: block; font-size: 0.85rem; font-weight: 700; color: var(--text-1); margin-bottom: 4px; }
.ticket-type-price { display: block; font-size: 0.78rem; font-weight: 600; color: var(--accent); }
.ticket-type-badge { display: inline-block; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; background: var(--unn-gold); padding: 2px 8px; border-radius: 100px; margin-bottom: 6px; }
.ticket-availability { display: inline-flex; margin-top: 6px; padding: 4px 9px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); font-size: .72rem; font-weight: 700; }
.ticket-availability.sold-out { color: #ff7d88; background: rgba(220,53,69,.10); border-color: rgba(220,53,69,.3); }
.ticket-type-option.sold-out { opacity: .55; }
.tier-included-panel { position: relative; margin-top: 14px; padding: 18px 20px; border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: linear-gradient(135deg, var(--surface-2), var(--surface)); box-shadow: var(--shadow-sm); overflow: hidden; animation: tierPanelIn .22s ease-out; }
.tier-included-panel::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--accent); border-radius: 4px 0 0 4px; }
.tier-included-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.tier-included-kicker { display: inline-flex; align-items: center; gap: 6px; font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--accent); }
.tier-included-kicker::before { content: '\\2713'; font-size: .78rem; }
.tier-included-title { margin: 0; font-size: 1.05rem; line-height: 1.3; font-weight: 700; color: var(--text-1); }
.tier-included-content { color: var(--text-2); }
.tier-included-content ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
.tier-included-content li { position: relative; margin: 0; padding-left: 22px; line-height: 1.5; font-size: .84rem; overflow-wrap: anywhere; }
.tier-included-content li::before { content: '\\2713'; position: absolute; left: 0; top: .05em; width: 16px; height: 16px; display: inline-grid; place-items: center; border-radius: 50%; background: var(--accent-ghost); color: var(--accent); font-size: .66rem; font-weight: 800; }
.tier-included-empty { margin: 0; font-size: .82rem; color: var(--text-3); }
@keyframes tierPanelIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 640px) {
  .ticket-type-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .ticket-type-option { min-width: 0; padding: 12px 8px; }
  .ticket-type-name, .ticket-type-price { overflow-wrap: anywhere; }
  .tier-included-panel { padding: 15px 16px; }
  .tier-included-header { align-items: flex-start; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .tier-included-content ul { grid-template-columns: 1fr; gap: 8px; }
}
@media (max-width: 380px) { .ticket-type-grid { grid-template-columns: 1fr; } }
`;

export default function Tickets() {
  const [universities, setUniversities] = useState([]);
  const [selectedUniValue, setSelectedUniValue] = useState('');
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [tier, setTier] = useState('regular');
  const [qty, setQty] = useState('1');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerFaculty, setBuyerFaculty] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const previewRef = useRef(null);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const eventParam = (params.get('event') || '').trim();
  const universityParam = (params.get('university') || '').trim();
  const referralCode = (params.get('ref') || '').trim().toUpperCase();

  // Remember the referral code the same way the legacy pages do, so it survives
  // into Checkout.jsx (which reads ?ref= first, then these keys).
  useEffect(() => {
    if (!referralCode) return;
    try { sessionStorage.setItem('referralCode', referralCode); } catch (e) {}
    try { localStorage.setItem('unn_referral_code', referralCode); } catch (e) {}
  }, [referralCode]);

  // ── Campus list ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch('/api/universities', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data && data.success && Array.isArray(data.universities)) ? data.universities : [];
        setUniversities(list);
        if (universityParam) {
          setSelectedUniValue(universityParam);
          return;
        }
        // Same restore rule as the legacy page: ?university= wins, otherwise the
        // campus the visitor already picked on the Events page.
        try {
          const raw = localStorage.getItem('selected_university');
          const saved = raw ? JSON.parse(raw) : null;
          if (saved && (saved.slug || saved.id)) setSelectedUniValue(String(saved.slug || saved.id));
        } catch (e) {}
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [universityParam]);

  // ── Event list, scoped to the chosen campus ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const uni = universities.find((u) => String(u.slug || u.id) === String(selectedUniValue));

    const load = async () => {
      setLoadingEvents(true);
      // With ?event= the exact "Buy Now" event must render immediately instead
      // of waiting for the whole campus catalogue.
      let head = [];
      if (eventParam) {
        try {
          const r = await fetch('/api/event?id=' + encodeURIComponent(eventParam), { cache: 'no-store' });
          const d = await r.json();
          if (d && d.success && d.event) head = [d.event];
        } catch (e) { /* fall through to the catalogue */ }
      }
      let rest = [];
      try {
        const url = '/api/events' + (uni ? '?university=' + encodeURIComponent(uni.slug || uni.id) : '');
        const r = await fetch(url, { cache: 'no-store' });
        const d = await r.json();
        rest = (d && d.success && Array.isArray(d.events)) ? d.events : [];
      } catch (e) { rest = []; }

      if (cancelled) return;
      const merged = head.concat(rest.filter((ev) => !eventParam || String(ev.id) !== eventParam));
      setEvents(sortEvents(merged));
      setSelectedEventId((prev) => prev || eventParam);
      setLoadingEvents(false);
    };

    // Don't fetch before the campus list resolves, otherwise we'd race the
    // selection the visitor restored from localStorage.
    if (universities.length || universityParam === '') load();
    else if (universities.length === 0 && selectedUniValue === '' && !universityParam) load();
    return () => { cancelled = true; };
  }, [universities, selectedUniValue, eventParam, universityParam]);

  const selectedEvent = events.find((e) => String(e.id) === String(selectedEventId)) || null;
  const hasEvent = !!selectedEvent;

  // Fall back to a tier the event actually sells (VIP hidden when it has no
  // VIP price, etc.), exactly like the legacy updateTierPicker() did.
  useEffect(() => {
    if (!selectedEvent) return;
    if (tier !== 'regular' && tierPrice(selectedEvent, tier) <= 0) setTier('regular');
  }, [selectedEvent, tier]);

  // Highlight the event card when it arrives from a "Buy Now" deep link.
  useEffect(() => {
    if (!hasEvent || !eventParam || !previewRef.current) return;
    const card = previewRef.current.closest('.checkout-card');
    if (!card) return;
    const t1 = setTimeout(() => {
      card.classList.add('checkout-card-highlight');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    const t2 = setTimeout(() => card.classList.remove('checkout-card-highlight'), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [hasEvent, eventParam]);

  const qtyNum = Math.max(1, Math.min(100, parseInt(qty, 10) || 1));
  const valid =
    hasEvent &&
    NAME_RE.test(buyerName.trim()) &&
    EMAIL_RE.test(buyerEmail.trim()) &&
    PHONE_RE.test(buyerPhone.trim()) && /\d{7}/.test(buyerPhone.replace(/\D/g, ''));

  function onUniversityChange(value) {
    setSelectedUniValue(value);
    const found = universities.find((u) => String(u.slug || u.id) === String(value));
    try {
      if (found) localStorage.setItem('selected_university', JSON.stringify(found));
      else localStorage.removeItem('selected_university');
    } catch (e) {}
    setSelectedEventId('');
  }

  function continueToCheckout() {
    if (!valid || !selectedEvent) return;
    const ev = selectedEvent;
    const original = tierPrice(ev, tier) > 0 ? tierPrice(ev, tier) : tierPrice(ev, 'regular');
    const bonus = tierBonus(ev, tier);
    const payable = bonus > 0 ? bonus : original;
    const uniId = ev.universityId || '';
    const uniName = ev.universityName || '';
    const uniSlug = ev.universitySlug || '';

    const payload = {
      eventValue: String(ev.id),
      eventId: String(ev.id),
      eventName: ev.name || '',
      eventDate: ev.date || '',
      eventTime: ev.time || '',
      eventVenue: ev.venue || '',
      eventCategory: ev.category || '',
      eventPrice: payable,
      originalEventPrice: original,
      bonusEventPrice: bonus,
      ticketTier: tier,
      included: tierIncluded(ev, tier),
      qty: qtyNum,
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim(),
      buyerPhone: buyerPhone.trim(),
      buyerFaculty: buyerFaculty.trim(),
      universityId: uniId,
      universityName: uniName,
      universitySlug: uniSlug,
    };
    try { sessionStorage.setItem('checkoutData', JSON.stringify(payload)); } catch (e) {}

    let ref = referralCode;
    if (!ref) {
      try {
        ref = (sessionStorage.getItem('referralCode') || localStorage.getItem('unn_referral_code') || '').trim().toUpperCase();
      } catch (e) { ref = ''; }
    }
    window.location.href = '/checkout' + (ref ? '?ref=' + encodeURIComponent(ref) : '');
  }

  const currentIncluded = includedItems(tierIncluded(selectedEvent, tier));

  return (
    <>
      <style>{PAGE_CSS}</style>
      <Nav active="Tickets" />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Get Tickets</div>
          <h1 className="section-title reveal reveal-delay-1">Pick your <em>event</em></h1>
          <p className="section-sub reveal reveal-delay-2">
            Choose an event, tell us who&apos;s attending, then continue to secure your tickets.
          </p>
        </div>
      </section>

      <div className="container">
        <div className="step-indicator reveal">
          <div className="step active"><span>1</span> Select Event</div>
          <div className="step-line"></div>
          <div className="step"><span>2</span> Checkout &amp; Pay</div>
        </div>
      </div>

      <section className="checkout-section">
        <div className="container">
          <div className="checkout-form reveal" style={{ maxWidth: '760px', margin: '0 auto' }}>

            <div className="checkout-card">
              <h3 className="checkout-card-title">🎓 Select Your Campus</h3>
              <div className="form-group">
                <label htmlFor="ticketUniversity">University</label>
                <select
                  id="ticketUniversity"
                  className="uni-selector"
                  value={selectedUniValue}
                  onChange={(e) => onUniversityChange(e.target.value)}
                >
                  <option value="">Select your campus…</option>
                  {universities.map((u) => (
                    <option key={String(u.slug || u.id)} value={String(u.slug || u.id)}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="checkout-card">
              <h3 className="checkout-card-title">🎟️ Select Event</h3>
              <div className="form-group">
                <label htmlFor="eventSelect">Event</label>
                <select
                  id="eventSelect"
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                >
                  <option value="">{loadingEvents ? 'Loading available events…' : 'Choose an event...'}</option>
                  {events.map((ev) => {
                    const price = Number(ev.price || 0);
                    const bonus = Number(ev.bonusPrice || 0);
                    const label = bonus > 0
                      ? `${ev.name} — ${fmtN(ev.price)} → ${fmtN(bonus)}`
                      : `${ev.name} — ${price > 0 ? fmtN(ev.price) : 'FREE'}`;
                    return <option key={String(ev.id)} value={String(ev.id)}>{label}</option>;
                  })}
                </select>
              </div>

              {hasEvent && (
                <div id="eventPreview" className="event-preview" ref={previewRef}>
                  <div className="event-preview-row"><span>📅</span> <span>{selectedEvent.date || 'Date TBA'}</span></div>
                  <div className="event-preview-row"><span>📍</span> <span>{selectedEvent.venue || '—'}</span></div>
                </div>
              )}

              {hasEvent && (
                <div id="ticketTypeCard" style={{ display: 'block' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
                    Ticket Type
                  </label>
                  <div className="ticket-type-grid" id="ticketTypeGrid">
                    {TIERS.map((t) => {
                      const price = tierPrice(selectedEvent, t);
                      const bonus = tierBonus(selectedEvent, t);
                      const inv = tierInventory(selectedEvent, t);
                      if (t !== 'regular' && price <= 0) return null;
                      const selected = tier === t;
                      return (
                        <label
                          key={t}
                          className={
                            'ticket-type-option' +
                            (selected ? ' selected' : '') +
                            (inv.soldOut ? ' sold-out' : '')
                          }
                        >
                          <input
                            type="radio"
                            name="ticketTier"
                            value={t}
                            checked={selected}
                            disabled={inv.soldOut}
                            onChange={() => setTier(t)}
                          />
                          {t !== 'regular' && <span className="ticket-type-badge">{t.toUpperCase()}</span>}
                          <span className="ticket-type-name">{TIER_LABELS[t]}</span>
                          <span className="ticket-type-price">
                            {price > 0 && bonus > 0 ? (
                              <>
                                <span style={{ textDecoration: 'line-through', opacity: 0.55, marginRight: 6 }}>{fmtN(price)}</span>
                                <strong>{fmtN(bonus)}</strong>
                                <small style={{ display: 'block', fontSize: '0.68em', opacity: 0.72 }}>Bonus price</small>
                              </>
                            ) : (
                              price > 0 ? fmtN(price) : (t === 'regular' ? 'FREE' : '—')
                            )}
                          </span>
                          {inv.total > 0 && (
                            <div className={'ticket-availability' + (inv.soldOut ? ' sold-out' : '')}>
                              {inv.soldOut
                                ? 'SOLD OUT'
                                : `${inv.sold.toLocaleString()}/${inv.total.toLocaleString()} sold`}
                            </div>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {hasEvent && (
                <div id="tierIncludedPanel" className="tier-included-panel">
                  <div className="tier-included-header">
                    <div className="tier-included-kicker">What&apos;s included</div>
                    <div id="tierIncludedTitle" className="tier-included-title">{TIER_LABELS[tier]}</div>
                  </div>
                  <div id="tierIncludedContent" className="tier-included-content">
                    {currentIncluded.length ? (
                      <ul>{currentIncluded.map((item, i) => <li key={i}>{esc(item)}</li>)}</ul>
                    ) : (
                      <p className="tier-included-empty">No additional inclusions listed for this ticket.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginTop: 16 }}>
                <label htmlFor="qtySelect">Quantity (1 – 100 tickets)</label>
                <input
                  type="number"
                  id="qtySelect"
                  min="1"
                  max="100"
                  step="1"
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <p className="form-hint" style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 6 }}>
                  Enter how many tickets you want — up to 100 per order.
                </p>
              </div>
            </div>

            <div className="checkout-card">
              <h3 className="checkout-card-title">👤 Buyer Information</h3>
              <div className="form-group">
                <label htmlFor="buyerName">Full Name</label>
                <input
                  type="text"
                  id="buyerName"
                  placeholder="e.g. Chidi Okonkwo"
                  autoComplete="name"
                  maxLength={80}
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="buyerEmail">Email Address</label>
                  <input
                    type="email"
                    id="buyerEmail"
                    placeholder="you@university.edu.ng"
                    autoComplete="email"
                    maxLength={254}
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="buyerPhone">Phone Number</label>
                  <input
                    type="tel"
                    id="buyerPhone"
                    placeholder="0812 345 6789"
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength={20}
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="buyerFaculty">Faculty / Department</label>
                <input
                  type="text"
                  id="buyerFaculty"
                  placeholder="e.g. Faculty of Engineering"
                  value={buyerFaculty}
                  onChange={(e) => setBuyerFaculty(e.target.value)}
                />
              </div>
            </div>

            <div className="checkout-card">
              <button
                className="btn-submit btn-submit-lg"
                id="continueBtn"
                disabled={!valid}
                onClick={continueToCheckout}
              >
                Continue to Checkout <span style={{ marginLeft: 8 }}>→</span>
              </button>
              <p className="summary-note" style={{ marginTop: 14 }}>
                You&apos;ll review your order and choose a payment method on the next page.
              </p>
            </div>

          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
