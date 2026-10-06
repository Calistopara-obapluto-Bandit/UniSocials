import { useEffect, useRef, useState, useCallback } from 'react';
import { esc, fmtN } from '../lib/utils.jsx';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function safeImg(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v || /^(?:https?:\/\/|\/[^\/]|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*)$/.test(v)) return v;
  return '';
}

function eventImageHtml(ev) {
  const img = String(ev.image || '').trim();
  const badge = esc(ev.category || 'General');
  if (img) {
    return (
      <div className="event-card-image has-photo">
        <img className="event-card-image-photo" src={esc(safeImg(img))} alt={esc(ev.name || 'Event image')} />
        <div className="event-card-badge">{badge}</div>
      </div>
    );
  }
  return (
    <div
      className="event-card-image"
      style={{ background: 'linear-gradient(135deg, #E8F5E9, #C8E6C9)' }}
    >
      <span className="event-card-fallback">{esc(ev.icon || '🎉')}</span>
      <div className="event-card-badge">{badge}</div>
    </div>
  );
}

function monthSummary(events) {
  if (!events || !events.length) return null;
  const counts = {};
  events.forEach(ev => {
    if (!ev.date) return;
    const d = new Date(ev.date);
    if (isNaN(d)) return;
    const key = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    counts[key] = (counts[key] || 0) + 1;
  });
  const keys = Object.keys(counts);
  if (!keys.length) return null;
  keys.sort((a, b) => new Date(a) - new Date(b));
  return (
    <div className="events-month-summary">
      <span style={{ fontSize: '0.8rem', color: 'var(--text-3)', fontWeight: 600, marginRight: 4 }}>By month:</span>
      {keys.map(k => (
        <span key={k} className="month-chip">
          <span className="month-name">{esc(k)}</span>&nbsp;·&nbsp;
          <span className="month-count">{counts[k]} event{counts[k] !== 1 ? 's' : ''}</span>
        </span>
      ))}
    </div>
  );
}

function eventCard(ev, index, referralCode) {
  const delay = (index % 3) === 0 ? '' : ' reveal-delay-' + (index % 3);
  const tagsHtml = (ev.tags && ev.tags.length) ? (
    <div className="event-card-tags">
      {ev.tags.map(t => <span key={t} className="event-tag">{esc(t)}</span>)}
    </div>
  ) : null;
  const dateLine = (ev.date || '') + (ev.time ? ' · ' + ev.time : '');
  const uniName = ev.universityName || '';
  const price = Number(ev.price || 0);
  const bonus = Number(ev.bonusPrice || 0);
  const unitPrice = (bonus > 0 && bonus < price) ? (
    <>
      <span style={{ textDecoration: 'line-through', opacity: 0.55, marginRight: 6 }}>{fmtN(price)}</span>
      <strong>{fmtN(bonus)}</strong>
    </>
  ) : fmtN(price);

  const ticketsHref = '/tickets.html?event=' + encodeURIComponent(ev.id || '') +
    ((ev.universitySlug || ev.universityId) ? '&university=' + encodeURIComponent(ev.universitySlug || ev.universityId) : '') +
    (referralCode ? '&ref=' + encodeURIComponent(referralCode) : '');

  return (
    <div
      className={'event-card reveal' + delay}
      dataCategory={esc(ev.category || '')}
      dataPrice={ev.price || 0}
      dataDate={esc(ev.date || '')}
      dataUniversityId={esc(ev.universityId || '')}
      dataUniversitySlug={esc(ev.universitySlug || '')}
      dataUniversityName={esc(uniName)}
    >
      {eventImageHtml(ev)}
      <div className="event-card-body">
        <div className="event-card-meta">
          <span>🗓 {esc(dateLine)}</span>
          <span>📍 {esc(ev.venue || '—')}</span>
        </div>
        <h3 className="event-card-title">{esc(ev.name)}</h3>
        {uniName ? <div className="event-card-uni">{esc(uniName)}</div> : null}
        <p className="event-card-desc">{esc(ev.description || '')}</p>
        {tagsHtml}
      </div>
      <div className="event-card-footer">
        <div className="event-card-footer-left">
          <div className="event-card-price">{unitPrice} <small>/ ticket</small></div>
          <div className="event-card-capacity">🎟 {esc(ev.seats || '—')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
          <a href={ticketsHref} className="btn-buy">Get Tickets</a>
          <button
            type="button"
            className="btn-notify"
            onClick={e => notifyMe(e, ev)}
            dataEvent={esc(ev.id || '')}
            dataUni={esc(ev.universityId || '')}
            dataUniName={esc(uniName)}
          >
            🔔 Notify me
          </button>
        </div>
      </div>
    </div>
  );
}

function notifyMe(e, ev) {
  e.preventDefault();
  const email = prompt('Enter your email to get notified about events at this campus:');
  if (!email) return;
  const uniId = ev.universityId || '';
  const uniName = ev.universityName || '';
  const eventId = ev.id || '';
  if (typeof window !== 'undefined' && window.UNNotify && window.UNNotify.subscribe) {
    window.UNNotify.subscribe(email, uniId, uniName, eventId, e.currentTarget).catch(() => {});
  }
}

export default function Events() {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [university, setUniversity] = useState(null);
  const [universities, setUniversities] = useState(null);
  const [selectedUniValue, setSelectedUniValue] = useState('');
  const [userSelectedUniversity, setUserSelectedUniversity] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [price, setPrice] = useState('all');
  const [referralCode, setReferralCode] = useState('');
  const [showReferralNotice, setShowReferralNotice] = useState(false);
  const [categories, setCategories] = useState([]);
  const [monthSummaryEvents, setMonthSummaryEvents] = useState(null);

  const gridRef = useRef(null);
  const countRef = useRef(null);

  const setCount = useCallback((text) => {
    if (countRef.current) countRef.current.innerHTML = text;
  }, []);

  const populateUniversityFilter = useCallback((list) => {
    const seen = new Set();
    const deduped = list.filter(u => {
      const key = String(u && u.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const html = '<option value="">All Universities</option>' + deduped.map(u =>
      '<option value="' + esc(u.slug || u.id) + '">' + esc(u.name) + '</option>'
    ).join('');
    return { html, list: deduped };
  }, []);

  const rebuildCategoryFilter = useCallback((uni) => {
    const cats = (uni && uni.categories && uni.categories.length) ? uni.categories : [];
    const html = '<option value="all">All Categories</option>' + cats.map(c =>
      '<option value="' + esc(c) + '">' + esc(c) + '</option>'
    ).join('');
    return html;
  }, []);

  const universityKeySet = useCallback((uni) => {
    const keys = new Set();
    if (!uni) return keys;
    [uni.id, uni.slug, uni.name].forEach(value => {
      const key = String(value || '').trim().toLowerCase();
      if (key) keys.add(key);
    });
    return keys;
  }, []);

  const eventBelongsToUniversity = useCallback((ev, uni) => {
    if (!uni) return true;
    const keys = universityKeySet(uni);
    const fields = [ev.universityId, ev.universitySlug, ev.universityName]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    if (!fields.length) return false;
    return fields.some(value => keys.has(value));
  }, [universityKeySet]);

  const loadEvents = useCallback((uni) => {
    setUniversity(uni || null);
    const url = '/api/events' + ((uni && (uni.slug || uni.id || uni.name)) ? '?university=' + encodeURIComponent(uni.name || uni.slug || uni.id) : '');
    setLoading(true);
    setError(null);
    if (countRef.current) countRef.current.innerHTML = 'Loading events…';
    if (gridRef.current) gridRef.current.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;"><p style="color:var(--text-3);">Loading events…</p></div>';

    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        const returned = (data && data.success && Array.isArray(data.events)) ? data.events : [];
        let filtered = university ? returned.filter(ev => eventBelongsToUniversity(ev, university)) : returned;
        filtered = filtered.slice().sort((a, b) => {
          const ua = String(a.universityName || a.university || '').trim().localeCompare(String(b.universityName || b.university || '').trim(), undefined, { sensitivity: 'base' });
          if (ua) return ua;
          return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });
        setEvents(filtered);
        setMonthSummaryEvents(filtered);
        if (!filtered.length) {
          if (gridRef.current) gridRef.current.innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;"><span style="font-size:2.8rem;display:block;margin-bottom:12px;">🏘️</span><p style="color:var(--text-3);">No events available for this campus yet. Check back soon!</p></div>';
          setCount('Showing <strong>0</strong> events');
        }
      })
      .catch(() => {
        if (gridRef.current) gridRef.current.innerHTML =
          '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;"><span style="font-size:2.8rem;display:block;margin-bottom:12px;">😔</span><p style="color:var(--text-3);">Could not load events. Please refresh the page.</p></div>';
        setError('Could not load events. Please refresh the page.');
      })
      .finally(() => setLoading(false));
  }, [eventBelongsToUniversity]);

  useEffect(() => {
    const pageParams = new URLSearchParams(window.location.search);
    const codeFromUrl = (pageParams.get('ref') || '').trim().toUpperCase();
    let code = '';
    try {
      if (codeFromUrl) {
        sessionStorage.setItem('referralCode', codeFromUrl);
        localStorage.setItem('unn_referral_code', codeFromUrl);
        code = codeFromUrl;
      } else {
        code = (sessionStorage.getItem('referralCode') || localStorage.getItem('unn_referral_code') || '').trim().toUpperCase();
      }
    } catch (e) {}
    setReferralCode(code);
    setShowReferralNotice(!!code);
  }, []);

  useEffect(() => {
    if (!universities) return;
    const selected = universities.find(u => String(u.slug || u.id) === String(selectedUniValue));
    if (selected) {
      // Categories are rebuilt by the university-select handler below when a
    // university is chosen. No extra action needed here.
    }
  }, [universities, selectedUniValue, rebuildCategoryFilter]);

  useEffect(() => {
    if (!universities) return;
    const selectEl = document.getElementById('universityFilter');
    if (!selectEl) return;
    const result = populateUniversityFilter(universities);
    selectEl.innerHTML = result.html;

    const findSelected = () => result.list.find(u => String(u.slug || u.id) === String(selectEl.value)) || null;

    const selectUniversity = (selected) => {
      setUserSelectedUniversity(true);
      setCategories(rebuildCategoryFilter(selected));
      setUniversity(selected || null);
      try {
        if (selected) localStorage.setItem('selected_university', JSON.stringify(selected));
        else localStorage.removeItem('selected_university');
      } catch (e) {}
      loadEvents(selected || null);
    };

    let restored = null;
    try {
      const raw = localStorage.getItem('selected_university');
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.name) {
        restored = result.list.find(u => String(u.name || '').trim().toLowerCase() === String(saved.name).trim().toLowerCase()) || null;
      }
    } catch (e) {}

    if (restored) {
      selectEl.value = restored.slug || restored.id;
      setUniversity(restored);
      setCategories(rebuildCategoryFilter(restored));
    }
    if (!userSelectedUniversity) loadEvents(restored || null);

    selectEl.onchange = () => selectUniversity(findSelected());

    if (typeof window !== 'undefined' && window.UNUniversitySearch) {
      window.UNUniversitySearch(selectEl);
    }

    const searchWrap = selectEl.parentElement && selectEl.parentElement.querySelector('.uni-search-wrap');
    if (searchWrap) {
      const input = searchWrap.querySelector('.uni-search-input');
      const btn = searchWrap.querySelector('.uni-search-btn');
      if (btn && input) {
        btn.addEventListener('click', () => {
          const q = (input.value || '').trim().toLowerCase();
          if (!q) return;
          const matches = result.list.filter(u =>
            String(u.name || '').toLowerCase().indexOf(q) !== -1 ||
            String(u.shortName || '').toLowerCase().indexOf(q) !== -1 ||
            String(u.state || '').toLowerCase() === q ||
            String(u.location || '').toLowerCase().indexOf(q) !== -1
          );
          if (matches.length !== 1) return;
          selectEl.value = matches[0].slug || matches[0].id;
          input.value = '';
          if (typeof selectEl.clearSearch === 'function') selectEl.clearSearch();
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
    }
  }, [universities, userSelectedUniversity, loadEvents, populateUniversityFilter, rebuildCategoryFilter]);

  useEffect(() => {
    const initialUni = (typeof window !== 'undefined' && window.UNUniversity && window.UNUniversity.getUniversity) ? window.UNUniversity.getUniversity() : null;
    setUniversity(initialUni || null);

    const selectEl = document.getElementById('universityFilter');
    if (selectEl) {
      selectEl.addEventListener('change', () => setUserSelectedUniversity(true), true);
    }
  }, []);

  useEffect(() => {
    if (!universities) return;
    fetch('/api/universities', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        const rawList = (data && data.success && Array.isArray(data.universities)) ? data.universities : [];
        setUniversities(rawList);
      })
      .catch(() => setUniversities([]));
  }, []);

  useEffect(() => {
    if (!events) return;
    const observer = new IntersectionObserver(els => {
      els.forEach(el => {
        if (el.isIntersecting) {
          el.classList.add('visible');
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    const nodes = gridRef.current ? gridRef.current.querySelectorAll('.reveal') : [];
    nodes.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [events]);

  const filteredEvents = (() => {
    if (!events) return [];
    let out = events;
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(ev => {
        const text = [
          ev.name, ev.description, ev.venue,
          (ev.tags || []).join(' '),
          ev.universityName, ev.category
        ].join(' ').toLowerCase();
        return text.indexOf(q) !== -1;
      });
    }
    if (category !== 'all') {
      out = out.filter(ev => (ev.category || '').toLowerCase() === category.toLowerCase());
    }
    if (price !== 'all') {
      const p = Number(ev => ev.price || 0);
      out = out.filter(ev => {
        const priceNum = Number(ev.price || 0);
        if (price === 'low') return priceNum < 2000;
        if (price === 'mid') return priceNum >= 2000 && priceNum <= 4000;
        if (price === 'high') return priceNum > 4000;
        return true;
      });
    }
    return out;
  })();

  return (
    <>
      <a href="https://wa.me/2348122104576" target="_blank" rel="noopener" className="whatsapp-float" aria-label="Chat on WhatsApp">
        <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        <span className="wa-tooltip">Chat with us</span>
      </a>

      <div className="mobile-menu" id="mobileMenu" role="dialog" aria-modal="true" aria-label="Navigation">
        <a href="/index.html">Home</a>
        <a href="/events.html">Events</a>
        <a href="/tickets.html">Tickets</a>
        <a href="/about.html">About</a>
        <a href="/contact.html">Contact</a>
        <a href="/influencer-admin-signup.html" className="mobile-iaf">✨ Create or sign in to an Influencer Admin account</a>
        <a href="/events.html" className="mobile-cta btn-primary">Get Tickets</a>
      </div>

      <nav className="nav" id="mainNav" role="navigation" aria-label="Main navigation">
        <div className="nav-inner">
          <a href="/index.html" className="nav-logo">Uni<span>socials</span></a>
          <ul className="nav-links" role="list">
            <li><a href="/index.html">Home</a></li>
            <li><a href="/events.html" className="active">Events</a></li>
            <li><a href="/tickets.html">Tickets</a></li>
            <li><a href="/about.html">About</a></li>
            <li><a href="/contact.html">Contact</a></li>
          </ul>
          <div className="nav-cta">
            <span className="nav-account-slot"></span>
            <a href="/influencer-admin-signup.html" className="iaf-link" title="Create or sign in to an Influencer Admin account">
              <span aria-hidden="true">👤</span> Create or sign up
            </a>
            <a href="/events.html" className="btn-primary">Get Tickets</a>
          </div>
          <button className="nav-hamburger" id="hamburger" aria-label="Toggle menu" aria-expanded="false">
            <span></span><span></span><span></span>
          </button>
        </div>
      </nav>

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Events</div>
          <h1 className="section-title reveal reveal-delay-1">Discover <em>campus</em> events</h1>
          <p className="section-sub reveal reveal-delay-2">Browse, filter, and pick your next unforgettable experience.</p>
          {showReferralNotice ? (
            <div
              id="referralNotice"
              style={{ display: 'inline-flex', margin: '14px auto 0', padding: '9px 14px', borderRadius: '999px', background: 'var(--accent-ghost)', border: '1px solid var(--accent-border)', color: 'var(--accent)', fontWeight: 700, fontSize: '0.84rem', width: 'max-content', maxWidth: '100%' }}
            >
              🎁 Referral code: {esc(referralCode)}
            </div>
          ) : null}
        </div>
      </section>

      <section className="filter-section">
        <div className="container">
          <div className="filter-bar reveal">
            <div className="filter-search">
              <span className="filter-search-icon">🔍</span>
              <input
                type="text"
                id="eventSearch"
                placeholder="Search events by name, faculty, or category..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <select id="universityFilter" className="uni-selector" value={selectedUniValue} onChange={e => setSelectedUniValue(e.target.value)}>
                <option value="">All Universities</option>
                {universities && universities.map(u => (
                  <option key={u.id || u.slug} value={esc(u.slug || u.id)}>{esc(u.name)}</option>
                ))}
              </select>
              <select id="categoryFilter" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="all">All Categories</option>
                {categories.map(c => (
                  <option key={c} value={esc(c)}>{esc(c)}</option>
                ))}
              </select>
              <select id="priceFilter" value={price} onChange={e => setPrice(e.target.value)}>
                <option value="all">Any Price</option>
                <option value="low">Under ₦2,000</option>
                <option value="mid">₦2,000 – ₦4,000</option>
                <option value="high">Above ₦4,000</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="events-section">
        <div className="container">
          <div className="events-count reveal">
            {loading ? 'Loading events…' : error ? error : `Showing <strong>${filteredEvents.length}</strong> event${filteredEvents.length !== 1 ? 's' : ''}`}
          </div>
          {monthSummary(monthSummaryEvents)}
          <div className="events-grid" ref={gridRef}>
            {loading && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <p style={{ color: 'var(--text-3)' }}>Loading events…</p>
              </div>
            )}
            {!loading && !events && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: 12 }}>😔</span>
                <p style={{ color: 'var(--text-3)' }}>Could not load events. Please refresh the page.</p>
              </div>
            )}
            {!loading && events && !events.length && university && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: 12 }}>🏘️</span>
                <p style={{ color: 'var(--text-3)' }}>No events available for this campus yet. Check back soon!</p>
              </div>
            )}
            {!loading && events && events.length === 0 && !university && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: 12 }}>🏘️</span>
                <p style={{ color: 'var(--text-3)' }}>No events available for this campus yet. Check back soon!</p>
              </div>
            )}
            {filteredEvents.map((ev, i) => eventCard(ev, i, referralCode))}
            {filteredEvents.length === 0 && events && events.length > 0 && (
              <div id="noResults" className="no-results" style={{ display: 'block' }}>
                <span>😕</span>
                <p>No events match your search criteria.</p>
                <button className="btn-outline-lg" onClick={() => { setSearch(''); setCategory('all'); setPrice('all'); setSelectedUniValue(''); }}>
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container">
          <div className="cta-inner reveal">
            <div className="cta-content">
              <h2 className="cta-title">Want to host your own event?<br /><em>We make it easy.</em></h2>
              <p className="cta-sub">Faculty associations and student organizations can list and sell tickets on Unisocials with ease.</p>
            </div>
            <div className="cta-actions">
              <a href="/contact.html" className="btn-cta-primary">
                Contact Us
                <span>→</span>
              </a>
              <a href="/faq.html" className="btn-cta-ghost">Read FAQ</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <a href="/index.html" className="nav-logo">
                Uni<span style={{ color: 'var(--accent-light)' }}>socials</span>
              </a>
              <p className="footer-brand-desc">The event ticket selling platform for universities across Nigeria.</p>
            </div>
            <div>
              <div className="footer-col-label">Quick Links</div>
              <div className="footer-links">
                <a href="/events.html">Events</a>
                <a href="/tickets.html">Tickets</a>
                <a href="/lookup.html">Find My Ticket</a>
                <a href="/about.html">About Us</a>
                <a href="/contact.html">Contact</a>
                <a href="/faq.html">FAQ</a>
              </div>
            </div>
            <div>
              <div className="footer-col-label">Support</div>
              <div className="footer-links">
                <a href="/faq.html">Help Center</a>
                <a href="/contact.html">Report Issue</a>
                <a href="#">Privacy Policy</a>
                <a href="#">Terms of Service</a>
              </div>
            </div>
            <div>
              <div className="footer-col-label">Follow Us</div>
              <div className="footer-links">
                <a href="https://www.tiktok.com/@unisocialshq" target="_blank" rel="noopener noreferrer">TikTok</a>
                <a href="https://www.instagram.com/unisocialshq/" target="_blank" rel="noopener noreferrer">Instagram</a>
                <a href="https://whatsapp.com/channel/0029VbDCK4NG3R3mXiZzip27" target="_blank" rel="noopener noreferrer">WhatsApp Channel</a>
                <a href="https://x.com/unisocialshq" target="_blank" rel="noopener noreferrer">X</a>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <div className="footer-copy">&copy; 2026 Unisocials. All rights reserved.</div>
            <div className="footer-legal">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
