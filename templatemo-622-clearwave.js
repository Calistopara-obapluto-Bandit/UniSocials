/*
Unisocials — Event Ticket Selling Platform for Universities
Rebranded from TemplateMo 622 Clearwave
https://templatemo.com/tm-622-clearwave
Free for personal and commercial use
*/

/* ══════════════════════════════════════════
   SITE CONFIGURATION — apply centralized values
   ══════════════════════════════════════════ */
(function() {
  const cfg = window.SITE_CONFIG || {};

  // Preserve referral tracking when a user lands on a referral link on any page,
  // then continues to checkout or another page in the same browser session.
  try {
    const params = new URLSearchParams(window.location.search);
    const referralCode = (params.get('ref') || '').trim();
    if (referralCode) {
      sessionStorage.setItem('referralCode', referralCode.toUpperCase());
    }
  } catch (e) {}

  // WhatsApp floating buttons — update all wa.me links to the configured number
  const floatNumber = cfg.WHATSAPP_FLOAT_NUMBER || '2348122104576';
  document.querySelectorAll('.whatsapp-float').forEach(function(link) {
    link.setAttribute('href', 'https://wa.me/' + floatNumber);
  });

  // Contact page — phone link
  const contactPhoneLink = document.getElementById('contactPhoneLink');
  if (contactPhoneLink) {
    const num = cfg.WHATSAPP_FLOAT_NUMBER || '2348122104576';
    contactPhoneLink.setAttribute('href', 'https://wa.me/' + num);
    contactPhoneLink.textContent = '+' + num.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
  }

  // FAQ — contact email
  const faqEmail = document.getElementById('faqEmail');
  if (faqEmail) {
    faqEmail.textContent = cfg.CONTACT_EMAIL || 'support.sbiamautos@gmail.com';
  }

  // Contact form — FormSubmit email endpoint & redirect URL
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    const key = cfg.FORMSUBMIT_KEY || 'support.sbiamautos@gmail.com';
    contactForm.setAttribute('action', 'https://formsubmit.co/' + key);
  }
  const formNext = document.getElementById('formNext');
  if (formNext) {
    formNext.value = cfg.REDIRECT_URL || 'https://unisocials.onrender.com/thank-you.html';
  }
})();

/* ══════════════════════════════════════════
   UNIVERSITY — selected campus (multi-tenant)
   Persists the user's chosen university in localStorage so
   events, categories, and tickets reflect their campus.
   ══════════════════════════════════════════ */
(function() {
const UNI_KEY = 'selected_university';

  function getUniversity() {
    try {
      const raw = localStorage.getItem(UNI_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setUniversity(uni) {
    try {
      if (uni) localStorage.setItem(UNI_KEY, JSON.stringify(uni));
      else localStorage.removeItem(UNI_KEY);
    } catch (e) {}
    // Notify any page (e.g. home featured events) to re-render for the new campus.
    if (typeof window.onUniversityChange === 'function') {
      try { window.onUniversityChange(); } catch (e) {}
    }
  }
  function clearUniversity() {
    try { localStorage.removeItem(UNI_KEY); } catch (e) {}
    if (typeof window.onUniversityChange === 'function') {
      try { window.onUniversityChange(); } catch (e) {}
    }
  }

window.UNUniversity = {
    getUniversity: getUniversity,
    setUniversity: setUniversity,
    clearUniversity: clearUniversity,
    getKey: function() { return UNI_KEY; },
    universityId: function() {
      var u = getUniversity();
      return u ? (u.id || u.slug || '') : '';
    }
  };
})();

/* ══════════════════════════════════════════
   UNIVERSITY SEARCH — searchable selector
   Adds a live search box + "Search" button beside a
   university <select>. Filters the options as you type
   (matched by name/shortName/state/location) and keeps
   the placeholder option ("Select your campus…") visible.
   Usage: window.UNUniversitySearch(document.getElementById('...'));
   ══════════════════════════════════════════ */
(function() {
  function UNUniversitySearch(selectEl) {
    if (!selectEl || !selectEl.tagName || selectEl.tagName.toLowerCase() !== 'select') return;
    if (selectEl.dataset.uniSearchReady === '1') return; // guard against double-init
    selectEl.dataset.uniSearchReady = '1';

    // Wrap the select so we can prepend the search box + button.
    var wrap = document.createElement('div');
    wrap.className = 'uni-search-wrap';
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);

    // Search button
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'uni-search-btn';
    btn.innerHTML = '\uD83D\uDD0D Search';
    btn.setAttribute('aria-label', 'Search universities');

    // Search input inside a pill container
    var box = document.createElement('div');
    box.className = 'uni-search-box';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'uni-search-input';
    input.placeholder = 'Search for your university\u2026';
    input.setAttribute('aria-label', 'Search universities');
    box.appendChild(input);
    box.appendChild(btn);

    // Result count hint
    var count = document.createElement('div');
    count.className = 'uni-search-count';
    count.style.display = 'none';

    wrap.appendChild(box);
    wrap.appendChild(count);

    function applyFilter() {
      var q = (input.value || '').toLowerCase().trim();
      var options = selectEl.options;
      var firstOpt = options.length ? options[0] : null;
      var visible = 0;

      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        // Always keep the placeholder ("Select your campus…") visible.
        if (i === 0) { opt.style.display = ''; continue; }
        var text = (opt.textContent || opt.text || '').toLowerCase();
        var match = !q || text.indexOf(q) !== -1;
        opt.style.display = match ? '' : 'none';
        if (match) visible++;
      }

      // If the currently selected option is being filtered out, reset to placeholder.
      if (selectEl.selectedIndex > 0 && options[selectEl.selectedIndex].style.display === 'none') {
        selectEl.selectedIndex = 0;
        if (selectEl.onchange) selectEl.onchange();
      }

      if (q) {
        count.style.display = '';
        count.textContent = visible === 0
          ? 'No universities match \u201C' + input.value + '\u201D.'
          : visible + ' universit' + (visible === 1 ? 'y' : 'ies') + ' match \u201C' + input.value + '\u201D.';
      } else {
        count.style.display = 'none';
      }
    }

    input.addEventListener('input', applyFilter);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); applyFilter(); }
    });
    btn.addEventListener('click', applyFilter);

    // Expose a way to clear the search (e.g. after choosing from another page).
    selectEl.clearSearch = function() {
      input.value = '';
      applyFilter();
    };

    // Re-run whenever new options are loaded (after /api/universities fills the select).
    selectEl.addEventListener('change', function() {
      // Keep the filter applied in case options changed.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyFilter);
    });
  }

  window.UNUniversitySearch = UNUniversitySearch;
})();

/* ══════════════════════════════════════════
   NOTIFY — subscribe to event email notifications
   ══════════════════════════════════════════ */
(function() {
  function subscribe(email, universityId, universityName, eventId, btn) {
    if (!email || !universityId) {
      if (btn) {
        btn.textContent = '⚠️ Select your campus first';
        setTimeout(function() { btn.textContent = '🔔 Notify me'; }, 2000);
      }
      return Promise.reject(new Error('email+university required'));
    }
    // If an eventId is given, we still store the subscription at the university
    // level so the user gets notified about all events at that campus (announcements
    // + reminders). The eventId is kept for reference.
    return fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        universityId: universityId,
        universityName: universityName || '',
        source: 'button'
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.success) {
        if (btn) {
          btn.textContent = '✅ Subscribed!';
          btn.disabled = true;
          setTimeout(function() { btn.textContent = '🔔 Notify me'; btn.disabled = false; }, 2500);
        }
        return data;
      }
      throw new Error((data && data.error) || 'subscribe failed');
    })
    .catch(function(err) {
      if (btn) {
        btn.textContent = '⚠️ Error';
        setTimeout(function() { btn.textContent = '🔔 Notify me'; }, 2000);
      }
      throw err;
    });
  }

  function unsubscribe(email, universityId, btn) {
    return fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, universityId: universityId || '' })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (btn) btn.textContent = data && data.success ? '✅ Unsubscribed' : '⚠️ Error';
      return data;
    });
  }

  window.UNNotify = {
    subscribe: subscribe,
    unsubscribe: unsubscribe
  };
})();

/* ══════════════════════════════════════════
   AUTH — buyer accounts (persistent login)
   ══════════════════════════════════════════ */
(function() {
  const AUTH_KEY = 'unn_auth_token';
  const USER_KEY = 'unn_auth_user';

  function getToken() {
    try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; }
  }
  function setAuth(token, user) {
    try {
      if (token) localStorage.setItem(AUTH_KEY, token);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {}
  }
  function getCachedUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearAuth() {
    try {
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }
  function authHeaders() {
    const t = getToken();
    const h = { 'Content-Type': 'application/json' };
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  window.UNNAuth = {
    getToken: getToken,
    getCachedUser: getCachedUser,
    setAuth: setAuth,
    clearAuth: clearAuth,
    authHeaders: authHeaders,
    isLoggedIn: function() { return !!getToken(); },
    currentUser: getCachedUser
  };

  // Inject/update the account link in the nav (Sign In / My Account)
  function renderNavAccount() {
    document.querySelectorAll('.nav-account-slot').forEach(function(slot) {
      var user = getCachedUser();
      if (user) {
        var firstName = (user.name || 'Account').split(' ')[0];
        slot.innerHTML =
          '<a href="my-tickets.html" class="nav-account-link" title="My Tickets">🎟 ' + esc(firstName) + '</a>' +
          '<a href="#" class="nav-account-logout" onclick="UNNAuth.logout(event)" title="Log out">⎋</a>';
      } else {
        slot.innerHTML =
          '<a href="login.html" class="nav-signin">Sign In</a>';
      }
    });

// Mobile top-bar auth cluster — visible on small screens (CSS hides it on desktop).
    // Shows Sign In when logged out, or the account link + a logout button when
    // logged in. Injected here so it stays in sync with login/logout state on every page.
    document.querySelectorAll('.nav-inner').forEach(function(inner) {
      var existing = inner.querySelector('.nav-mobile-auth');
      if (existing) existing.remove();
      var user = getCachedUser();
      var cluster = document.createElement('div');
      cluster.className = 'nav-mobile-auth';
      if (user) {
        var accLink = document.createElement('a');
        accLink.href = 'my-tickets.html';
        accLink.title = 'My Tickets';
        accLink.className = 'nav-mobile-signin';
        accLink.textContent = '🎟 ' + esc((user.name || 'Account').split(' ')[0]);
        var logoutBtn = document.createElement('a');
        logoutBtn.href = '#';
        logoutBtn.className = 'nav-mobile-logout';
        logoutBtn.title = 'Log out';
        logoutBtn.setAttribute('aria-label', 'Log out');
        logoutBtn.innerHTML = '⎋';
        logoutBtn.addEventListener('click', function(e) { window.UNNAuth.logout(e); });
        cluster.appendChild(accLink);
        cluster.appendChild(logoutBtn);
      } else {
        var signin = document.createElement('a');
        signin.href = 'login.html';
        signin.className = 'nav-mobile-signin';
        signin.textContent = 'Sign In';
        cluster.appendChild(signin);
      }
      var hamburger = inner.querySelector('.nav-hamburger');
      if (hamburger) inner.insertBefore(cluster, hamburger);
      else inner.appendChild(cluster);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c];
    });
  }

window.UNNAuth.renderNavAccount = renderNavAccount;
  window.UNNAuth.logout = function(e) {
    if (e) e.preventDefault();
    var token = getToken();
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      }).catch(function() {});
    }
    clearAuth();
    renderNavAccount();
    syncMobileMenuLogout();
    if (window.location.pathname.endsWith('my-tickets.html')) window.location.reload();
  };

  // Inject + sync a "Log out" link inside the mobile menu on every page.
  // Keeps the in-menu logout consistent with the top-bar logout button.
  function syncMobileMenuLogout() {
    var menu = document.getElementById('mobileMenu');
    if (!menu) return;
    var existing = menu.querySelector('.mobile-menu-logout');
    if (!existing) {
      var link = document.createElement('a');
      link.href = '#';
      link.className = 'mobile-menu-logout';
      link.id = 'mobileMenuLogout';
      link.textContent = 'Log out';
      link.addEventListener('click', function(e) {
        e.preventDefault();
        window.UNNAuth.logout(e);
        if (menu.classList) menu.classList.remove('open');
        if (document.body) document.body.style.overflow = '';
      });
      menu.appendChild(link);
      existing = link;
    }
    var loggedIn = !!getToken();
    existing.style.display = loggedIn ? 'block' : 'none';
  }

// Render on every page load (handles login.html/register.html too)
  document.addEventListener('DOMContentLoaded', function() {
    renderNavAccount();
    syncMobileMenuLogout();
  });
  window.addEventListener('load', syncMobileMenuLogout);
})();

/* ── MOBILE MENU ── */
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');

function openMobileMenu() {
  hamburger.classList.add('open');
  mobileMenu.classList.add('open');
  hamburger.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}
function closeMobileMenu() {
  hamburger.classList.remove('open');
  mobileMenu.classList.remove('open');
  hamburger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}
if (hamburger) {
  hamburger.addEventListener('click', () => {
    mobileMenu.classList.contains('open') ? closeMobileMenu() : openMobileMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileMenu(); });
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => closeMobileMenu());
  });
}

/* ── FAQ ACCORDION ── */
const faqItems = document.querySelectorAll('.faq-item');
faqItems.forEach(item => {
  const question = item.querySelector('.faq-question');
  if (question) {
    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      item.classList.toggle('open', !isOpen);
      question.setAttribute('aria-expanded', !isOpen);
    });
  }
});

/* ── STAT COUNTERS ── */
function animateCounter(el) {
  const target = parseFloat(el.dataset.target);
  const decimal = el.dataset.decimal;
  const duration = 1800;
  const start = performance.now();
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    const val = eased * target;
    el.textContent = decimal ? val.toFixed(1) : Math.floor(val);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = decimal ? target.toFixed(1) : target;
  }
  requestAnimationFrame(step);
}
const statObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.stat-num').forEach(animateCounter);
      statObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.4 });
document.querySelectorAll('.stats-grid').forEach(el => statObserver.observe(el));

/* ── SCROLL REVEAL ── */
const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
revealEls.forEach(el => revealObserver.observe(el));

/* ── SMOOTH SCROLL ── */
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const href = link.getAttribute('href');
    if (href === '#') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
});

/* ── NAV SCROLL ── */
const nav = document.getElementById('mainNav');
if (nav) {
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
}

/* ══════════════════════════════════════════
   EVENTS — SEARCH & FILTER
   ══════════════════════════════════════════ */
(function() {
  const searchInput = document.getElementById('eventSearch');
  const categoryFilter = document.getElementById('categoryFilter');
  const priceFilter = document.getElementById('priceFilter');
  const eventsGrid = document.getElementById('eventsGrid');
  const eventsCount = document.getElementById('eventsCount');
  const noResults = document.getElementById('noResults');

  if (!eventsGrid) return; // Not on events page

  function filterEvents() {
    const search = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const category = categoryFilter ? categoryFilter.value : 'all';
    const price = priceFilter ? priceFilter.value : 'all';

    const cards = eventsGrid.querySelectorAll('.event-card');
    let visibleCount = 0;

    cards.forEach(card => {
      const cat = card.dataset.category;
      const p = parseInt(card.dataset.price);
      const title = card.querySelector('.event-card-title')?.textContent?.toLowerCase() || '';
      const desc = card.querySelector('.event-card-desc')?.textContent?.toLowerCase() || '';
      const tags = card.querySelector('.event-card-tags')?.textContent?.toLowerCase() || '';
      const searchText = title + ' ' + desc + ' ' + tags;

      const catMatch = category === 'all' || cat === category;

      let priceMatch = true;
      if (price === 'low') priceMatch = p < 2000;
      else if (price === 'mid') priceMatch = p >= 2000 && p <= 4000;
      else if (price === 'high') priceMatch = p > 4000;

      const searchMatch = !search || searchText.includes(search);

      if (catMatch && priceMatch && searchMatch) {
        card.style.display = '';
        visibleCount++;
        card.classList.remove('visible');
        setTimeout(() => card.classList.add('visible'), 50);
      } else {
        card.style.display = 'none';
      }
    });

    if (eventsCount) {
      eventsCount.innerHTML = 'Showing <strong>' + visibleCount + '</strong> event' + (visibleCount !== 1 ? 's' : '');
    }
    if (noResults) {
      noResults.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  }

  if (searchInput) searchInput.addEventListener('input', filterEvents);
  if (categoryFilter) categoryFilter.addEventListener('change', filterEvents);
  if (priceFilter) priceFilter.addEventListener('change', filterEvents);

  window.resetFilters = function() {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (priceFilter) priceFilter.value = 'all';
    filterEvents();
  };

  // Exposed so dynamically-loaded event cards (from /api/events) can re-run filtering
  window.filterEvents = filterEvents;
})();

/* ══════════════════════════════════════════
   TICKETS — TICKET SELECTION (Step 1)
   ══════════════════════════════════════════ */
(function() {
  const eventSelect = document.getElementById('eventSelect');
  const qtySelect = document.getElementById('qtySelect');
  const buyerName = document.getElementById('buyerName');
  const buyerEmail = document.getElementById('buyerEmail');
  const buyerPhone = document.getElementById('buyerPhone');
  const buyerFaculty = document.getElementById('buyerFaculty');
  const continueBtn = document.getElementById('continueBtn');

  if (!eventSelect) return; // Not on ticket selection page

  const eventPreview = document.getElementById('eventPreview');
  const previewDate = document.getElementById('previewDate');
  const previewVenue = document.getElementById('previewVenue');

  // Prefill buyer info if logged in
  (function prefill() {
    const u = window.UNNAuth && window.UNNAuth.getCachedUser();
    if (!u) return;
    if (buyerName && !buyerName.value) buyerName.value = u.name || '';
    if (buyerEmail && !buyerEmail.value) buyerEmail.value = u.email || '';
    if (buyerPhone && !buyerPhone.value) buyerPhone.value = u.phone || '';
    updateContinueBtn();
  })();

  function getSelectedOption() {
    return eventSelect.options[eventSelect.selectedIndex];
  }

  function updateEventDetails() {
    const opt = getSelectedOption();
    const date = opt.dataset.date || '';
    const time = opt.dataset.time || '';
    const venue = opt.dataset.venue || '';

    if (eventPreview && opt.value) {
      eventPreview.style.display = 'block';
      if (previewDate) previewDate.textContent = date + ' \u00B7 ' + time;
      if (previewVenue) previewVenue.textContent = venue;
    } else if (eventPreview) {
      eventPreview.style.display = 'none';
    }
    updateContinueBtn();
  }

  function getQty() {
    const raw = qtySelect ? qtySelect.value : '1';
    let q = parseInt(raw, 10);
    if (!q || isNaN(q)) q = 1;
    if (q < 1) q = 1;
    if (q > 100) q = 100;
    return q;
  }

  function updateContinueBtn() {
    const opt = getSelectedOption();
    const name = buyerName ? buyerName.value.trim() : '';
    const email = buyerEmail ? buyerEmail.value.trim() : '';
    const phone = buyerPhone ? buyerPhone.value.trim() : '';
    const qty = getQty();
    const canContinue = !!opt.value && name.length > 0 && email.length > 0 && phone.length > 0 && qty >= 1 && qty <= 100;
    if (continueBtn) continueBtn.disabled = !canContinue;
  }

function getSelectedTier() {
    var checked = document.querySelector('input[name="ticketTier"]:checked');
    return checked ? checked.value : 'regular';
  }

  // Resolve the per-ticket price for the selected tier (Regular / VIP / VVIP / Table).
  function getTierPrice() {
    const opt = getSelectedOption();
    const tier = getSelectedTier();
    const reg = parseFloat(opt.dataset.price || 0);
    const vip = parseFloat(opt.dataset.vipPrice || 0);
    const vvip = parseFloat(opt.dataset.vvipPrice || 0);
    const table = parseFloat(opt.dataset.tablePrice || 0);
    if (tier === 'vip') return vip > 0 ? vip : reg;
    if (tier === 'vvip') return vvip > 0 ? vvip : reg;
    if (tier === 'table') return table > 0 ? table : reg;
    return reg;
  }

  window.continueToCheckout = function() {
    const opt = getSelectedOption();
    if (!opt.value) { alert('Please select an event.'); return; }
    const name = buyerName ? buyerName.value.trim() : '';
    const email = buyerEmail ? buyerEmail.value.trim() : '';
    const phone = buyerPhone ? buyerPhone.value.trim() : '';
    if (!name || !email || !phone) { alert('Please fill in your name, email, and phone number.'); return; }
    const qty = getQty();
    if (qty < 1 || qty > 100) { alert('Please enter a quantity between 1 and 100 tickets.'); return; }

const tier = getSelectedTier();
    const tierPrice = getTierPrice();

    // Resolve the "What's Included" list for the selected tier.
    const included = tier === 'vip' ? (opt.dataset.includedVip || '')
      : tier === 'vvip' ? (opt.dataset.includedVvip || '')
      : tier === 'table' ? (opt.dataset.includedTable || '')
      : (opt.dataset.includedRegular || '');

    // Attach the selected university (from the campus selector) to the order.
    const uni = window.UNUniversity ? window.UNUniversity.getUniversity() : null;
    const universityObj = uni && (uni.id || uni.slug) ? uni : null;

    sessionStorage.setItem('checkoutData', JSON.stringify({
      eventValue: opt.value,
      eventName: opt.dataset.name,
      eventDate: opt.dataset.date,
      eventTime: opt.dataset.time,
      eventVenue: opt.dataset.venue,
      eventCategory: opt.dataset.category || '',
      eventPrice: tierPrice,
      ticketTier: tier,
      included: included,
      qty: qty,
      buyerName: name,
      buyerEmail: email,
      buyerPhone: phone,
      buyerFaculty: buyerFaculty ? buyerFaculty.value.trim() : '',
      universityId: universityObj ? (universityObj.id || universityObj.slug || '') : '',
      universityName: universityObj ? (universityObj.name || '') : '',
      universitySlug: universityObj ? (universityObj.slug || universityObj.id || '') : ''
    }));

    window.location.href = 'checkout.html';
  };

  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const eventParam = params.get('event');
    if (eventParam && eventSelect) {
      for (const opt of eventSelect.options) {
        if (opt.value === eventParam) { opt.selected = true; break; }
      }
      // Focus attention on the chosen event like popular ticket sites:
      // highlight the selection card and scroll it into view.
      const card = eventSelect.closest('.checkout-card');
      if (card) {
        setTimeout(function() {
          card.classList.add('checkout-card-highlight');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(function() {
            card.classList.remove('checkout-card-highlight');
          }, 2600);
        }, 400);
      }
    }
    updateEventDetails();
  }

  if (eventSelect) eventSelect.addEventListener('change', updateEventDetails);
  if (qtySelect) {
    qtySelect.addEventListener('change', updateContinueBtn);
    qtySelect.addEventListener('input', updateContinueBtn);
    // Keep the value clamped between 1 and 100 as the user types
    qtySelect.addEventListener('blur', function() {
      const q = getQty();
      if (qtySelect.value !== String(q)) qtySelect.value = String(q);
      updateContinueBtn();
    });
  }
  if (buyerName) buyerName.addEventListener('input', updateContinueBtn);
  if (buyerEmail) buyerEmail.addEventListener('input', updateContinueBtn);
  if (buyerPhone) buyerPhone.addEventListener('input', updateContinueBtn);

  window.updateEventDetails = updateEventDetails;
  readUrlParams();
})();

/* ══════════════════════════════════════════
   CHECKOUT — PAYMENT (Flutterwave-only, per-ticket)
   ══════════════════════════════════════════ */
(function() {
  const summaryEventName = document.getElementById('summaryEventName');
  const summaryDate = document.getElementById('summaryDate');
  const summaryVenue = document.getElementById('summaryVenue');
  const summaryQty = document.getElementById('summaryQty');
  const summaryTier = document.getElementById('summaryTier');
  const summaryUnitPrice = document.getElementById('summaryUnitPrice');
  const summaryTotal = document.getElementById('summaryTotal');
  const summaryBuyer = document.getElementById('summaryBuyer');
  const summaryEmail = document.getElementById('summaryEmail');
  const placeOrderBtn = document.getElementById('placeOrderBtn');
  const placeOrderTotal = document.getElementById('placeOrderTotal');
  const mobilePlaceOrderBtn = document.getElementById('mobilePlaceOrderBtn');
  const mobileBarTotal = document.getElementById('mobileBarTotal');
  const paymentNote = document.getElementById('paymentNote');
  const successModal = document.getElementById('successModal');
  const modalClose = document.getElementById('modalClose');

  if (!summaryTotal) return;

  let checkoutData = null;
  try {
    const raw = sessionStorage.getItem('checkoutData');
    if (raw) checkoutData = JSON.parse(raw);
  } catch(e) {}

  if (!checkoutData) {
    if (summaryTotal) summaryTotal.textContent = 'No order data';
    if (summaryEventName) summaryEventName.textContent = 'Session expired';
    if (placeOrderBtn) placeOrderBtn.disabled = true;
    if (mobilePlaceOrderBtn) mobilePlaceOrderBtn.disabled = true;
    document.querySelectorAll('.checkout-form .checkout-card').forEach(function(card) {
      const p = document.createElement('p');
      p.style.textAlign = 'center';
      p.style.padding = '20px 0';
      p.innerHTML = '<a href="tickets.html" class="btn-primary" style="display:inline-flex;gap:8px;padding:12px 28px;">Start Over</a>';
      card.innerHTML = '';
      card.appendChild(p);
    });
    return;
  }

  const total = checkoutData.eventPrice * checkoutData.qty;

  if (summaryEventName) summaryEventName.textContent = checkoutData.eventName || 'Not selected';
  if (summaryDate) summaryDate.textContent = checkoutData.eventDate ? (checkoutData.eventDate + ' \u00B7 ' + (checkoutData.eventTime || '')) : '\u2014';
  if (summaryVenue) summaryVenue.textContent = checkoutData.eventVenue || '\u2014';
  if (summaryQty) summaryQty.textContent = checkoutData.qty + ' ticket' + (checkoutData.qty > 1 ? 's' : '');
  if (summaryTier) {
    const tierMap = { regular: '🎟 Regular', vip: '⭐ VIP', vvip: '👑 VVIP', table: '🪑 Table' };
    summaryTier.textContent = tierMap[checkoutData.ticketTier] || '🎟 Regular';
  }
  if (summaryUnitPrice) summaryUnitPrice.textContent = '\u20A6' + (checkoutData.eventPrice || 0).toLocaleString();
  if (summaryTotal) summaryTotal.textContent = '\u20A6' + total.toLocaleString();
  if (summaryBuyer) summaryBuyer.textContent = checkoutData.buyerName || '\u2014';
  if (summaryEmail) summaryEmail.textContent = checkoutData.buyerEmail || '\u2014';

  // Pre-fill referral code from session/URL if available
  const refInput = document.getElementById('checkoutReferralCode');
  if (refInput) {
    const savedRef = (sessionStorage.getItem('referralCode') || '').trim();
    if (savedRef) refInput.value = savedRef;
  }

  if (mobileBarTotal) mobileBarTotal.textContent = '\u20A6' + total.toLocaleString();
  if (placeOrderTotal) placeOrderTotal.textContent = '\u20A6' + total.toLocaleString();

  function updatePaymentNote() {
    const note = document.getElementById('paymentNote');
    if (note) {
      note.innerHTML = '🔒 You\'ll be redirected to <strong>Flutterwave</strong> to complete your payment securely. Your ticket(s) are issued automatically once payment is confirmed.';
    }
  }

  function generateOrderId() {
    return 'UNI-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function showSuccessModal(orderId, eventName, totalPaid, ticketCodes) {
    const idEl = document.getElementById('orderId');
    const evEl = document.getElementById('orderEvent');
    const emailEl = document.getElementById('orderEmail');
    const totalEl = document.getElementById('orderTotal');
    const ticketListEl = document.getElementById('successTicketList');

    if (idEl) idEl.textContent = orderId;
    if (evEl) evEl.textContent = eventName;
    if (totalEl) totalEl.textContent = '\u20A6' + totalPaid.toLocaleString();
    if (emailEl) emailEl.textContent = checkoutData && checkoutData.buyerEmail ? checkoutData.buyerEmail : '\u2014';

    // Per-ticket links
    if (ticketListEl && Array.isArray(ticketCodes) && ticketCodes.length) {
      let html = '<div style="margin-top:14px;text-align:left;">';
      html += '<div style="font-weight:700;font-size:0.85rem;color:var(--text-2);margin-bottom:8px;">🎟 Your ticket(s):</div>';
      ticketCodes.forEach(function(tc) {
        html += '<a href="ticket.html?orderId=' + encodeURIComponent(orderId) + '&code=' + encodeURIComponent(tc.code) +
          '" class="btn-primary" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 16px;margin-bottom:8px;font-size:0.85rem;">' +
          '<span>Ticket ' + (tc.index || '') + '</span><span style="font-family:monospace;">' + tc.code + ' →</span></a>';
      });
      html += '</div>';
      ticketListEl.innerHTML = html;
    }

    if (successModal) successModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeSuccessModal() {
    if (successModal) successModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function sendOrderToWhatsApp(orderId, eventName, qty, totalPaid, paymentLabel, name, email, phone, ticketCodes) {
    let ticketLines = '';
    if (Array.isArray(ticketCodes) && ticketCodes.length) {
      ticketLines = '\n\n🎟 *Digital Tickets:*\n';
      ticketCodes.forEach(function(tc) {
        ticketLines += '• ' + tc.code + ' → ' + window.location.origin + '/ticket.html?orderId=' + encodeURIComponent(orderId) + '&code=' + encodeURIComponent(tc.code) + '\n';
      });
    }
    var msg = '🛒 *New Ticket Order!*\n\n' +
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
    const cfg = window.SITE_CONFIG || {};
    const waNumber = cfg.WHATSAPP_ORDER_NUMBER || '2348122104576';
    window.open('https://wa.me/' + waNumber + '?text=' + encodeURIComponent(msg), '_blank');
  }

  function getReferralCodeFromUrlOrSessionOrInput() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let referralCode = (urlParams.get('ref') || '').trim();
      if (!referralCode) {
        referralCode = (sessionStorage.getItem('referralCode') || '').trim();
      }
      // Also check the input field on checkout page
      if (!referralCode) {
        const inputEl = document.getElementById('referralCodeInput');
        if (inputEl && inputEl.value) {
          referralCode = inputEl.value.trim();
        }
      }
      if (referralCode) {
        referralCode = referralCode.toUpperCase();
        sessionStorage.setItem('referralCode', referralCode);
      }
      return referralCode;
    } catch (e) {
      return '';
    }
  }

<<<<<<< HEAD
  function createOrderViaApi(orderId, orderTotal, successCallback) {
<<<<<<< HEAD
    // Extract referral code from URL or session so it survives navigation to checkout.
    const referralCode = getReferralCodeFromUrlOrSession();
=======
    // Extract referral code from URL, session, or input field so it survives navigation to checkout.
    const referralCode = getReferralCodeFromUrlOrSessionOrInput();
=======
    function createOrderViaApi(orderId, orderTotal, successCallback) {
    // Priority: 1. Manual Input field, 2. URL/Session
    let referralCode = '';
    const refInput = document.getElementById('checkoutReferralCode');
    if (refInput && refInput.value.trim()) {
      referralCode = refInput.value.trim();
    } else {
      referralCode = getReferralCodeFromUrlOrSession();
    }
>>>>>>> 8368b8a (Fix server logic for Render and implement referral tracking system)
>>>>>>> f232237 (Fix server logic for Render and implement referral tracking system)
    
    fetch('/api/orders', {
      method: 'POST',
      headers: window.UNNAuth ? window.UNNAuth.authHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: orderId,
        eventName: checkoutData.eventName,
        eventDate: checkoutData.eventDate ? (checkoutData.eventDate + ' · ' + (checkoutData.eventTime || '')) : '',
        eventVenue: checkoutData.eventVenue || '',
        eventCategory: checkoutData.eventCategory || '',
        qty: checkoutData.qty,
        amount: orderTotal,
        currency: 'NGN',
        paymentMethod: 'flutterwave',
        buyerName: checkoutData.buyerName,
        buyerEmail: checkoutData.buyerEmail,
        buyerPhone: checkoutData.buyerPhone,
        buyerFaculty: checkoutData.buyerFaculty || '',
        ticketTier: checkoutData.ticketTier || 'regular',
        included: checkoutData.included || '',
        universityId: checkoutData.universityId || '',
        universityName: checkoutData.universityName || '',
        universitySlug: checkoutData.universitySlug || '',
        referralCode: referralCode  // Add referral code to order
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (successCallback) successCallback(data && data.success, data && data.order ? data.order.ticketCodes : null);
    })
    .catch(function() {
      if (successCallback) successCallback(false, null);
    });
  }

  function startFlutterwavePayment(orderId, eventName, qty, orderTotal, name, email, phone) {
    const cfg = window.SITE_CONFIG || {};
    const publicKey = cfg.FLUTTERWAVE_PUBLIC_KEY || '';

    if (!publicKey) {
      alert('Flutterwave is not configured. Please contact support.');
      return;
    }

    const customerName = name || 'Unisocial Customer';

    const payload = {
      public_key: publicKey,
      tx_ref: orderId,
      amount: orderTotal,
      currency: 'NGN',
      payment_options: 'card, banktransfer, ussd, mobilemoney, account',
      redirect_url: cfg.REDIRECT_URL || 'https://unisocials.onrender.com/thank-you.html',
      customer: {
email: email || 'customer@example.com',
        name: customerName,
        phone_number: phone || ''
      },
      customizations: {
        title: 'Unisocials',
        description: eventName + (qty > 1 ? ' (' + qty + ' tickets)' : ''),
        logo: 'https://unisocials.onrender.com/images/tm-622-screen-01.jpg'
      },
      callback: function(response) {
        if (response && (response.status === 'successful' || response.status === 'completed')) {
          fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx_ref: response.tx_ref || orderId })
          })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data && data.success) {
              const verifiedAmount = parseFloat(data.order && data.order.amount) || orderTotal;
              const totalPaid = verifiedAmount > 0 ? verifiedAmount : orderTotal;
              const ticketCodes = (data.order && data.order.ticketCodes) || [];
              const withIndex = ticketCodes.map(function(tc, i) { return { code: tc.code, index: i + 1 }; });
              sendOrderToWhatsApp(orderId, eventName, qty, totalPaid, 'Flutterwave', name, email, phone, withIndex);
              showSuccessModal(orderId, eventName, totalPaid, withIndex);
            } else {
              // Payment not yet verified — redirect to pending tracker
              alert('Payment received but verification is still processing. We\'ll confirm shortly.');
              window.location.href = 'pending.html?orderId=' + encodeURIComponent(orderId);
            }
          })
          .catch(function() {
            window.location.href = 'pending.html?orderId=' + encodeURIComponent(orderId);
          });
        } else {
          alert('Payment was not completed. You can try again.');
        }
      },
      onclose: function() {}
    };

    if (typeof window.FlutterwaveCheckout === 'function') {
      window.FlutterwaveCheckout(payload);
    } else {
      alert('Flutterwave checkout could not be loaded. Please check your internet connection.');
    }
  }

  window.placeOrder = function() {
    const orderId = generateOrderId();
    const eventName = checkoutData.eventName;
    const qty = checkoutData.qty;
    const name = checkoutData.buyerName;
    const email = checkoutData.buyerEmail;
    const phone = checkoutData.buyerPhone;

    const placeBtn = document.getElementById('placeOrderBtn');
    if (placeBtn) { placeBtn.disabled = true; placeBtn.textContent = 'Starting payment…'; }

    // 1) Create the pending order server-side FIRST
    createOrderViaApi(orderId, total, function(success) {
      if (!success) {
        alert('Could not create your order. Please try again.');
        if (placeBtn) { placeBtn.disabled = false; placeBtn.textContent = '🛒 Place Order — ₦' + total.toLocaleString(); }
        return;
      }
      // 2) Open Flutterwave to pay for that exact order id
      startFlutterwavePayment(orderId, eventName, qty, total, name, email, phone);
      // Re-enable in case user closes modal
      setTimeout(function() {
        if (placeBtn) { placeBtn.disabled = false; placeBtn.textContent = '🛒 Place Order — ₦' + total.toLocaleString(); }
      }, 15000);
    });
  };

  // Bind events
  if (successModal) {
    successModal.addEventListener('click', function(e) {
      if (e.target === successModal) closeSuccessModal();
    });
  }
  if (modalClose) modalClose.addEventListener('click', closeSuccessModal);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSuccessModal();
  });

  window.updatePaymentNote = updatePaymentNote;
  updatePaymentNote();
})();

/* ══════════════════════════════════════════
   CONTACT — FORM VALIDATION
   ══════════════════════════════════════════ */
(function() {
  const contactForm = document.getElementById('contactForm');
  if (!contactForm) return;

  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const messageInput = document.getElementById('message');
  const submitBtn = contactForm.querySelector('.btn-submit');

  function validateForm() {
    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const message = messageInput ? messageInput.value.trim() : '';

    const valid = name.length > 0 && email.length > 0 && message.length > 0;
    if (submitBtn) submitBtn.disabled = !valid;
  }

  if (nameInput) nameInput.addEventListener('input', validateForm);
  if (emailInput) emailInput.addEventListener('input', validateForm);
  if (messageInput) messageInput.addEventListener('input', validateForm);
})();

/* ── TICKET QUANTITY ON INDEX ── */
document.querySelectorAll('.ticket-form').forEach(form => {
  const qtySelect = form.querySelector('select');
  const totalDisplay = form.querySelector('.ticket-total');
  const price = parseFloat(form.dataset.price || 0);

  if (qtySelect && totalDisplay) {
    qtySelect.addEventListener('change', () => {
      const qty = parseInt(qtySelect.value);
      totalDisplay.textContent = '\u20A6' + (price * qty).toLocaleString();
    });
  }
});

