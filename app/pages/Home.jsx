import { useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { isLoggedIn } from '../lib/api.js';
import { subscribeToEvent } from '../lib/notify.js';
import { esc, fmtN } from '../lib/utils.jsx';

/*
 * React port of index.html — the landing page.
 *
 * Everything the legacy page did through the shared templatemo bundle is now
 * local to this component: the campus picker reads and writes the same
 * localStorage key the Events page uses, the stat counters animate themselves,
 * and the subscribe box calls the same /api/subscribe endpoint through
 * app/lib/notify.js. Styles come from landing.css, linked in app/index.html.
 */

function safeImg(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v || /^(?:https?:\/\/|\/[^\/]|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*)$/.test(v)) return v;
  return '';
}

// Count-up used by the four stat cards. Animates only when the target changes,
// so the initial "0" -> real value transition plays like the legacy counters.
function Counter({ value, suffix }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value || 0);
    if (from === to) return undefined;
    const duration = 1100;
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (to - from) * eased);
      setShown(next);
      fromRef.current = next;
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span>{shown.toLocaleString()}{suffix ? <span className="stat-suffix">{suffix}</span> : null}</span>;
}

function EventCard({ ev, delay }) {
  const img = String(ev.image || '').trim();
  const badge = esc(ev.category || 'General');
  const price = Number(ev.price || 0);
  const bonus = Number(ev.bonusPrice || 0);
  const isFree = !(price > 0) && !(bonus > 0);
  const dateLine = (ev.date || '') + (ev.time ? ' · ' + ev.time : '');

  let priceLabel;
  if (isFree) priceLabel = <strong>FREE</strong>;
  else if (bonus > 0 && bonus < price) {
    priceLabel = (
      <>
        <span style={{ textDecoration: 'line-through', opacity: 0.55, marginRight: 6 }}>{fmtN(ev.price)}</span>
        <strong>{fmtN(ev.bonusPrice)}</strong>
      </>
    );
  } else priceLabel = fmtN(ev.price);

  return (
    <div className={'event-card reveal' + (delay || '')}>
      {img ? (
        <div className="event-card-image has-photo">
          <img className="event-card-image-photo" src={esc(safeImg(img))} alt={esc(ev.name || 'Event image')} />
          <div className="event-card-badge">{badge}</div>
        </div>
      ) : (
        <div className="event-card-image" style={{ background: 'linear-gradient(135deg, #E8F5E9, #C8E6C9)' }}>
          <span className="event-card-fallback">{esc(ev.icon || '🎉')}</span>
          <div className="event-card-badge">{badge}</div>
        </div>
      )}
      <div className="event-card-body">
        <div className="event-card-date">📅 {esc(dateLine)}</div>
        <h3 className="event-card-title">{esc(ev.name)}</h3>
        <p className="event-card-desc">{esc(ev.description || '')}</p>
        {ev.tags && ev.tags.length ? (
          <div className="event-card-tags">
            {ev.tags.map((t, i) => <span className="event-tag" key={i}>{esc(t)}</span>)}
          </div>
        ) : null}
      </div>        <div className="event-card-footer">
          <div className="event-card-price">
            {priceLabel}
            {isFree ? null : <> <small>/ ticket</small></>}
          </div>
        <a href={'/tickets.html?event=' + encodeURIComponent(ev.id || '')} className="btn-buy">Buy Now</a>
      </div>
    </div>
  );
}

export default function Home() {
  const [introHiding, setIntroHiding] = useState(false);
  const [introGone, setIntroGone] = useState(false);
  const [universities, setUniversities] = useState([]);
  const [selectedUniValue, setSelectedUniValue] = useState('');
  const [events, setEvents] = useState(null);
  const [eventsFailed, setEventsFailed] = useState(false);
  const [stats, setStats] = useState(null);
  const [subEmail, setSubEmail] = useState('');
  const [subStatus, setSubStatus] = useState(null);
  const [subBusy, setSubBusy] = useState(false);

  const selectedUni = useMemo(
    () => universities.find((u) => String(u.slug || u.id) === String(selectedUniValue)) || null,
    [universities, selectedUniValue]
  );

  // The branded first-load intro: identical timing to the legacy index.html —
  // 4s on screen, then the 800ms fade, then unmounted so it can never trap the
  // page if something later throws.
  useEffect(() => {
    const hide = setTimeout(() => setIntroHiding(true), 4000);
    const unmount = setTimeout(() => setIntroGone(true), 4900);
    return () => { clearTimeout(hide); clearTimeout(unmount); };
  }, []);

  // Campus list + restore the visitor's saved campus.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/universities', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data && data.success && Array.isArray(data.universities)) ? data.universities : [];
        setUniversities(list);
        try {
          const raw = localStorage.getItem('selected_university');
          const saved = raw ? JSON.parse(raw) : null;
          if (saved && (saved.slug || saved.id)) setSelectedUniValue(String(saved.slug || saved.id));
        } catch (e) { /* ignore */ }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Featured events, scoped to the chosen campus.
  useEffect(() => {
    let cancelled = false;
    const uni = universities.find((u) => String(u.slug || u.id) === String(selectedUniValue));
    const url = '/api/events' + (uni ? '?university=' + encodeURIComponent(uni.slug || uni.id) : '');
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setEvents((data && data.success && Array.isArray(data.events)) ? data.events : []);
        setEventsFailed(false);
      })
      .catch(() => { if (!cancelled) { setEvents([]); setEventsFailed(true); } });
    return () => { cancelled = true; };
  }, [universities, selectedUniValue]);

  // Live stats behind the hero and the counters.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { if (!cancelled && data && data.success) setStats(data.stats || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const featured = useMemo(() => {
    if (!events) return [];
    const withFeatured = events.filter((e) => e.featured);
    return (withFeatured.length ? withFeatured : events).slice(0, 3);
  }, [events]);

  const heroEvent = events && events.length ? events[0] : null;
  const heroTicketHref = isLoggedIn() ? '/my-tickets' : '/lookup';
  const waNumber = (window.SITE_CONFIG && window.SITE_CONFIG.WHATSAPP_FLOAT_NUMBER) || '2348122104576';

  function onUniversityChange(value) {
    setSelectedUniValue(value);
    const found = universities.find((u) => String(u.slug || u.id) === String(value));
    try {
      if (found) localStorage.setItem('selected_university', JSON.stringify(found));
      else localStorage.removeItem('selected_university');
    } catch (e) { /* ignore */ }
  }

  async function onSubscribe(e) {
    e.preventDefault();
    const value = subEmail.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setSubStatus({ text: '⚠️ Please enter a valid email address.', warn: true });
      return;
    }
    if (!selectedUni) {
      setSubStatus({ text: '⚠️ Please select your campus above first.', warn: true });
      return;
    }
    setSubBusy(true);
    const res = await subscribeToEvent({
      email: value,
      universityId: selectedUni.id || selectedUni.slug,
      universityName: selectedUni.name,
    });
    if (res.ok) {
      setSubStatus({ text: `✅ You're subscribed! We'll email you about events at ${selectedUni.name || 'your campus'}.`, warn: false });
      setSubEmail('');
    } else {
      setSubStatus({ text: '⚠️ Could not subscribe. Please try again.', warn: true });
    }
    setSubBusy(false);
  }

  return (
    <>
      {!introGone && (
        <div
          id="unisocials-intro"
          aria-label="Loading UniSocials"
          role="status"
          className={introHiding ? 'is-hidden' : ''}
        >
          <div className="un-intro-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div className="un-intro-shell">
            <div className="un-intro-logo-wrap">
              <img className="un-intro-logo" src="/images/unisocials-logo.jpg" alt="UniSocials logo" />
            </div>
            <div className="un-intro-name"><span>UNI</span>SOCIALS</div>
            <div className="un-intro-rule"><div className="un-intro-tagline">Connect. <b>Engage.</b> Experience.</div></div>
            <p className="un-intro-copy">Your university events, communities and connections — made simple.</p>
            <div className="un-intro-loader" aria-hidden="true"><span></span></div>
            <div className="un-intro-status">Welcome to UniSocials</div>
          </div>
        </div>
      )}

      <a
        href={'https://wa.me/' + waNumber}
        target="_blank"
        rel="noopener noreferrer"
        className="whatsapp-float"
        aria-label="Chat on WhatsApp"
      >
        <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
        <span className="wa-tooltip">Chat with us</span>
      </a>

      <Nav active="Home" />

      {/* ── HERO ── */}
      <section className="hero">
        <div className="container">
          <div className="hero-inner">
            <div className="hero-content">
              <div className="hero-badge reveal">
                <div className="hero-badge-dot">✦</div>
                <span>Your University&apos;s <strong>Official Event Platform</strong></span>
              </div>
              <h1 className="hero-title reveal reveal-delay-1">
                Your campus,<br /><em>one event at a time.</em>
              </h1>
              <p className="hero-sub reveal reveal-delay-2">
                Unisocials is the ticket selling platform for university events across Nigeria. From department dinners to faculty galas — discover, book, and attend with ease.
              </p>
              <div className="hero-actions reveal reveal-delay-3">
                <a href="/events.html" className="btn-primary-lg">
                  Browse Events <span className="btn-arrow">→</span>
                </a>
                <a href={heroTicketHref} className="btn-outline-lg" data-ticket-hub>
                  <span>✦</span> My Tickets
                </a>
              </div>
              <div className="hero-uni-picker reveal reveal-delay-4">
                <label htmlFor="homeUniversity" className="hero-uni-label">🎓 Your campus:</label>
                <select
                  id="homeUniversity"
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
              <div className="hero-stats reveal reveal-delay-4">
                <div className="hero-stat">
                  <div className="hero-stat-val" id="heroTicketsSold">{stats ? Number(stats.ticketsSold || 0).toLocaleString() : '0'}</div>
                  <div className="hero-stat-label">Tickets Sold</div>
                </div>
                <div className="hero-stat">
                  <div className="hero-stat-val" id="heroUpcomingEvents">{stats ? Number(stats.upcomingEvents || 0).toLocaleString() : '0'}</div>
                  <div className="hero-stat-label">Upcoming Events</div>
                </div>
                <div className="hero-stat">
                  <div className="hero-stat-val" id="heroFaculties">{stats ? Number(stats.faculties || 0).toLocaleString() : '0'}</div>
                  <div className="hero-stat-label">Faculties</div>
                </div>
              </div>
            </div>
            <div className="hero-visual reveal reveal-delay-2">
              <div className="hero-card">
                <div className="hero-card-media" id="heroEventMedia">
                  {heroEvent && String(heroEvent.image || '').trim() ? (
                    <img src={esc(safeImg(heroEvent.image))} alt={esc(heroEvent.name || 'Featured event')} />
                  ) : (
                    <div className="hero-card-fallback" id="heroEventIcon">{esc((heroEvent && heroEvent.icon) || '🎉')}</div>
                  )}
                </div>
                <div className="hero-card-title">Next Big Event</div>
                <div className="hero-card-sub" id="heroEventSub">
                  {heroEvent ? esc(heroEvent.name) : <>Loading the next<br />campus event…</>}
                </div>
                <div className="hero-card-date">
                  <span>📅</span>{' '}
                  <span id="heroEventDate">
                    {heroEvent ? (heroEvent.date || '') + (heroEvent.time ? ' · ' + heroEvent.time : '') : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="stats-section">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-card reveal">
              <div className="stat-value"><span className="stat-num"><Counter value={stats ? Number(stats.eventsThisMonth || 0) : 0} /></span></div>
              <div className="stat-label">Events This Month</div>
            </div>
            <div className="stat-card reveal reveal-delay-1">
              <div className="stat-value"><span className="stat-num"><Counter value={stats ? Number(stats.ticketsSold || 0) : 0} suffix="+" /></span></div>
              <div className="stat-label">Tickets Sold</div>
            </div>
            <div className="stat-card reveal reveal-delay-2">
              <div className="stat-value"><span className="stat-num"><Counter value={stats ? Number(stats.faculties || 0) : 0} /></span></div>
              <div className="stat-label">Faculties Participating</div>
            </div>
            <div className="stat-card reveal reveal-delay-3">
              <div className="stat-value"><span className="stat-num">15</span><span className="stat-suffix">k+</span></div>
              <div className="stat-label">Social Reach</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURED EVENTS ── */}
      <section className="events-section" id="events">
        <div className="container">
          <div className="section-label reveal">Featured Events</div>
          <h2 className="section-title reveal reveal-delay-1">Popular <em>upcoming</em> events</h2>
          <p className="section-sub reveal reveal-delay-2">Don&apos;t miss out on the biggest campus events this month.</p>

          <div className="events-grid" id="featuredGrid">
            {events === null ? null : eventsFailed ? (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: 12 }}>🚚</span>
                <p style={{ color: 'var(--text-3)' }}>Could not load featured events. Please refresh the page.</p>
              </div>
            ) : !featured.length ? (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: 12 }}>🎉</span>
                <p style={{ color: 'var(--text-3)' }}>No featured events yet for this campus. Check back soon!</p>
              </div>
            ) : (
              featured.map((ev, i) => <EventCard key={String(ev.id)} ev={ev} delay={i === 0 ? '' : ' reveal-delay-' + i} />)
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: 48 }} className="reveal">
            <a href="/events.html" className="btn-primary-lg">
              View All Events <span className="btn-arrow">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-inner reveal">
            <div className="cta-content">
              <h2 className="cta-title">Want to host an event?<br /><em>We make it easy.</em></h2>
              <p className="cta-sub">
                Faculty associations and student organizations can create and sell tickets on Unisocials with ease.
              </p>
            </div>
            <div className="cta-actions">
              <a href="/contact.html" className="btn-cta-primary">Contact Us <span>→</span></a>
              <a href="/about.html" className="btn-cta-ghost">Learn More</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── NEWSLETTER / SUBSCRIBE ── */}
      <section className="subscribe-section">
        <div className="container">
          <div className="subscribe-inner reveal">
            <h2 className="subscribe-title">Get notified when <em>events go live</em></h2>
            <p className="subscribe-sub">
              Pick your campus and we&apos;ll email you the moment a new event is announced — plus reminders before it happens.
            </p>
            <form className="subscribe-form" id="subscribeForm" noValidate onSubmit={onSubscribe}>
              <input
                type="email"
                id="subscribeEmail"
                className="subscribe-input"
                placeholder="Your email address"
                value={subEmail}
                onChange={(e) => setSubEmail(e.target.value)}
              />
              <button type="submit" className="subscribe-btn" id="subscribeBtn" disabled={subBusy}>
                {subBusy ? 'Subscribing…' : '🔔 Notify me'}
              </button>
            </form>
            <p
              className="subscribe-status"
              id="subscribeStatus"
              style={subStatus ? { color: subStatus.warn ? 'var(--unn-gold)' : 'var(--accent)' } : undefined}
            >
              {subStatus ? subStatus.text : ''}
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
