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
      sessionStorage.setItem('referralCode', referralCode.toUpperCase()); localStorage.setItem('unn_referral_code', referralCode.toUpperCase());
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
    const bonusReg = parseFloat(opt.dataset.bonusPrice || 0);
    const vip = parseFloat(opt.dataset.vipPrice || 0);
    const bonusVip = parseFloat(opt.dataset.bonusVipPrice || 0);
    const vvip = parseFloat(opt.dataset.vvipPrice || 0);
    const bonusVvip = parseFloat(opt.dataset.bonusVvipPrice || 0);
    const table = parseFloat(opt.dataset.tablePrice || 0);
    const bonusTable = parseFloat(opt.dataset.bonusTablePrice || 0);
    if (tier === 'vip') return bonusVip > 0 ? bonusVip : (vip > 0 ? vip : reg);
    if (tier === 'vvip') return bonusVvip > 0 ? bonusVvip : (vvip > 0 ? vvip : reg);
    if (tier === 'table') return bonusTable > 0 ? bonusTable : (table > 0 ? table : reg);
    return bonusReg > 0 ? bonusReg : reg;
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
    var selectedOpt = document.querySelector('input[name=\"ticketTier\"][value=\"'+tier+'\"]');
    var selectedCard = selectedOpt && selectedOpt.closest ? selectedOpt.closest('.ticket-type-option') : null;
    if (selectedCard && selectedCard.classList.contains('sold-out')) { alert(tier.toUpperCase() + ' tickets are sold out.'); return; }
    const tierPrice = getTierPrice();
    const tierOriginalPrice = (function(){
      const reg=parseFloat(opt.dataset.price||0), vip=parseFloat(opt.dataset.vipPrice||0), vvip=parseFloat(opt.dataset.vvipPrice||0), table=parseFloat(opt.dataset.tablePrice||0);
      if (tier==='vip') return vip>0?vip:reg;
      if (tier==='vvip') return vvip>0?vvip:reg;
      if (tier==='table') return table>0?table:reg;
      return reg;
    })();
    const tierBonusPrice = (function(){
      const reg=parseFloat(opt.dataset.bonusPrice||0), vip=parseFloat(opt.dataset.bonusVipPrice||0), vvip=parseFloat(opt.dataset.bonusVvipPrice||0), table=parseFloat(opt.dataset.bonusTablePrice||0);
      const bonus = tier==='vip' ? vip : (tier==='vvip' ? vvip : (tier==='table' ? table : reg));
      return bonus>0 ? bonus : 0;
    })();

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
      eventId: opt.value,
      eventName: opt.dataset.name,
      eventDate: opt.dataset.date,
      eventTime: opt.dataset.time,
      eventVenue: opt.dataset.venue,
      eventCategory: opt.dataset.category || '',
      eventPrice: tierBonusPrice || tierPrice,
      originalEventPrice: tierOriginalPrice,
      bonusEventPrice: tierBonusPrice,
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
    // A referral link can intentionally open checkout before an event has been
    // selected. In that case, keep the visitor on checkout, let them choose
    // an available event, and carry the referral code into the selected order.
    const checkoutSection = document.querySelector('.checkout-section');
    if (checkoutSection) {
      const container = checkoutSection.querySelector('.container') || checkoutSection;
      const refFromUrl = (new URLSearchParams(window.location.search).get('ref') || sessionStorage.getItem('referralCode') || localStorage.getItem('unn_referral_code') || '').trim().toUpperCase();
      if (refFromUrl) {
        try { sessionStorage.setItem('referralCode', refFromUrl); localStorage.setItem('unn_referral_code', refFromUrl); } catch(e) {}
      }
      container.innerHTML = '<div class="checkout-event-picker" style="max-width:980px;margin:0 auto;">' +
        '<div style="text-align:center;margin-bottom:26px;"><div class="section-label">Choose an event</div><h2 style="margin:8px 0 8px;">Select the event you want to attend</h2><p style="color:var(--text-3);margin:0;">Your referral code will be applied automatically after you choose an event.</p>' +
        (refFromUrl ? '<div style="display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:9px 14px;border-radius:999px;background:var(--accent-ghost);border:1px solid var(--accent-border);color:var(--accent);font-weight:700;font-size:.84rem;">🎁 Referral code: ' + refFromUrl.replace(/[<>]/g,'') + '</div>' : '') +
        '</div><div id="checkoutEventList" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;"><div style="grid-column:1/-1;text-align:center;padding:34px;color:var(--text-3);">Loading available events…</div></div></div>';
      const list = document.getElementById('checkoutEventList');
      fetch('/api/events').then(function(r){ return r.json(); }).then(function(payload){
        const events = (payload && payload.success && Array.isArray(payload.events)) ? payload.events : [];
        if (!events.length) {
          list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;border:1px solid var(--border);border-radius:16px;background:var(--surface-2);"><strong>No events are currently available.</strong><p style="color:var(--text-3);margin:8px 0 18px;">Please check back later.</p><a href="events.html" class="btn-primary">Browse Events</a></div>';
          return;
        }
        list.innerHTML = events.map(function(ev){
          const id = String(ev.id || '');
          const name = String(ev.name || ev.title || 'Event');
          const date = String(ev.date || '');
          const time = String(ev.time || '');
          const venue = String(ev.venue || '');
          const price = Number(ev.price || 0);
          const bonus = Number(ev.bonusPrice || 0);
          return '<article style="border:1px solid var(--border);border-radius:16px;background:var(--surface-2);padding:20px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:12px;">' +
            '<div><h3 style="margin:0 0 7px;">' + name.replace(/[<>]/g,'') + '</h3><div style="color:var(--text-3);font-size:.85rem;line-height:1.6;">' + (date ? date + (time ? ' · ' + time : '') : 'Date TBA') + (venue ? '<br>' + venue.replace(/[<>]/g,'') : '') + '</div></div>' +
            '<div style="font-weight:800;color:var(--accent);">From ₦' + (bonus > 0 ? bonus : price).toLocaleString() + '</div>' +
            '<button type="button" class="btn-primary checkout-choose-event" data-event-id="' + id.replace(/[<>"']/g,'') + '" style="width:100%;justify-content:center;">Choose this event</button>' +
          '</article>';
        }).join('');
        list.querySelectorAll('.checkout-choose-event').forEach(function(btn){
          btn.addEventListener('click', function(){
            const ev = events.find(function(item){ return String(item.id || '') === String(btn.getAttribute('data-event-id') || ''); });
            if (!ev) return;
            const tier = 'regular';
            const original = Number(ev.price || 0);
            const bonus = Number(ev.bonusPrice || 0);
            sessionStorage.setItem('checkoutData', JSON.stringify({
              eventValue: ev.id, eventId: ev.id, eventName: ev.name || ev.title || 'Event',
              eventDate: ev.date || '', eventTime: ev.time || '', eventVenue: ev.venue || '',
              eventCategory: ev.category || '', eventPrice: bonus > 0 ? bonus : original,
              originalEventPrice: original, bonusEventPrice: bonus, ticketTier: tier,
              included: ev.includedRegular || '', qty: 1, buyerName: '', buyerEmail: '', buyerPhone: '',
              buyerFaculty: '', universityId: '', universityName: '', universitySlug: ''
            }));
            const ref = (new URLSearchParams(window.location.search).get('ref') || sessionStorage.getItem('referralCode') || localStorage.getItem('unn_referral_code') || '').trim().toUpperCase();
            window.location.href = 'checkout.html' + (ref ? '?ref=' + encodeURIComponent(ref) : '');
          });
        });
      }).catch(function(){
        list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;border:1px solid var(--border);border-radius:16px;background:var(--surface-2);"><strong>Unable to load events right now.</strong><p style="color:var(--text-3);margin:8px 0 18px;">Please try again.</p><button type="button" class="btn-primary" onclick="location.reload()">Retry</button></div>';
      });
    }
    return;
  }

  // Bonus price is the default checkout price. A VALID referral switches the
  // selected tier back to its original price. Coupons are applied after that.
  const storedOriginal = Number(checkoutData.originalEventPrice || checkoutData.eventPrice || 0);
  const storedBonus = Number(checkoutData.bonusEventPrice || 0);
  let referralApplied = false;
  let baseUnitPrice = storedBonus > 0 ? storedBonus : storedOriginal;
  let baseTotal = baseUnitPrice * Number(checkoutData.qty || 1);
  let total = baseTotal;
  let appliedCoupon = null;
  let appliedReferralCode = '';

  if (summaryEventName) summaryEventName.textContent = checkoutData.eventName || 'Not selected';
  if (summaryDate) summaryDate.textContent = checkoutData.eventDate ? (checkoutData.eventDate + ' \u00B7 ' + (checkoutData.eventTime || '')) : '\u2014';
  if (summaryVenue) summaryVenue.textContent = checkoutData.eventVenue || '\u2014';
  if (summaryQty) summaryQty.textContent = checkoutData.qty + ' ticket' + (checkoutData.qty > 1 ? 's' : '');
  if (summaryTier) {
    const tierMap = { regular: '🎟 Regular', vip: '⭐ VIP', vvip: '👑 VVIP', table: '🪑 Table' };
    summaryTier.textContent = tierMap[checkoutData.ticketTier] || '🎟 Regular';
  }
  if (summaryUnitPrice) {
    const payablePrice = Number(checkoutData.eventPrice || 0);
    const originalPrice = Number(checkoutData.originalEventPrice || 0);
    summaryUnitPrice.innerHTML = (originalPrice > payablePrice && payablePrice > 0)
      ? '<span style="text-decoration:line-through;opacity:.55;margin-right:7px;">₦' + originalPrice.toLocaleString() + '</span><strong style="color:var(--accent);font-size:1.12em;">₦' + payablePrice.toLocaleString() + '</strong><small style="display:block;color:var(--text-3);font-size:.72em;margin-top:3px;">Bonus price</small>'
      : '<strong style="color:var(--accent);font-size:1.12em;">₦' + payablePrice.toLocaleString() + '</strong>';
  }
  if (summaryTotal) summaryTotal.textContent = '\u20A6' + total.toLocaleString();

  // Always refresh checkout pricing from the server so the checkout page uses
  // the event's current original + bonus price, even if the ticket page was
  // opened from an older browser tab/session.
  (async function refreshAuthoritativePricing() {
    try {
      const eventId = checkoutData.eventId || checkoutData.eventValue || '';
      if (!eventId) return;
      const r = await fetch('/api/events');
      const payload = await r.json();
      const events = (payload && payload.success && payload.events) || [];
      const ev = events.find(function(item) { return String(item.id || '') === String(eventId); });
      if (!ev) return;
      const tier = String(checkoutData.ticketTier || 'regular').toLowerCase();
      const originals = { regular:Number(ev.price||0), vip:Number(ev.vipPrice||0), vvip:Number(ev.vvipPrice||0), table:Number(ev.tablePrice||0) };
      const bonuses = { regular:Number(ev.bonusPrice||0), vip:Number(ev.bonusVipPrice||0), vvip:Number(ev.bonusVvipPrice||0), table:Number(ev.bonusTablePrice||0) };
      const original = originals[tier] > 0 ? originals[tier] : originals.regular;
      const bonus = bonuses[tier] || 0;
      const payable = referralApplied ? original : (bonus > 0 ? bonus : original);
      checkoutData.originalEventPrice = original;
      checkoutData.bonusEventPrice = bonus;
      checkoutData.eventPrice = payable;
      try { sessionStorage.setItem('checkoutData', JSON.stringify(checkoutData)); } catch(e) {}
      baseUnitPrice = payable;
      total = payable * Number(checkoutData.qty || 1);
      baseTotal = total;
      if (summaryUnitPrice) {
        summaryUnitPrice.innerHTML = (!referralApplied && original > payable && payable > 0)
          ? '<span style="text-decoration:line-through;opacity:.55;margin-right:7px;">₦' + original.toLocaleString() + '</span><strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong><small class="referral-price-note">✨ Bonus price</small>'
          : (referralApplied && original > 0 ? '<strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong><small class="referral-price-note">🎁 Referral price</small>' : '<strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong>');
      }
      renderCouponTotal();
    } catch (e) {
      // Keep the already stored checkout price if the refresh request fails.
    }
  })();

  function renderCheckoutPrice(original, bonus) {
    const payable = referralApplied ? original : (bonus > 0 ? bonus : original);
    baseUnitPrice = payable;
    baseTotal = payable * Number(checkoutData.qty || 1);
    total = appliedCoupon ? Math.max(0, baseTotal - Number(appliedCoupon.amount || 0)) : baseTotal;
    checkoutData.originalEventPrice = original;
    checkoutData.bonusEventPrice = bonus;
    checkoutData.eventPrice = payable;
    try { sessionStorage.setItem('checkoutData', JSON.stringify(checkoutData)); } catch(e) {}
    if (summaryUnitPrice) {
      summaryUnitPrice.innerHTML = (!referralApplied && original > payable && payable > 0)
        ? '<span style="text-decoration:line-through;opacity:.55;margin-right:7px;">₦' + original.toLocaleString() + '</span><strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong><small class="referral-price-note">✨ Bonus price</small>'
        : (referralApplied && original > 0 ? '<strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong><small class="referral-price-note">🎁 Referral price</small>' : '<strong style="color:var(--accent);font-size:1.12em;">₦' + payable.toLocaleString() + '</strong>');
    }
    renderCouponTotal();
  }

  async function applyReferralCode() {
    const input = document.getElementById('referralCodeInput');
    const btn = document.getElementById('applyReferralBtn');
    const msg = document.getElementById('referralMessage');
    const code = String(input && input.value || '').trim().toUpperCase();
    if (!code) {
      referralApplied = false; appliedReferralCode = '';
      if (msg) { msg.textContent = 'No referral applied. Your bonus price remains active.'; msg.className = 'form-hint referral-message'; }
      await refreshReferralPricing();
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    try {
      const r = await fetch('/api/referrals/validate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || 'Invalid referral code.');
      referralApplied = true; appliedReferralCode = code;
      sessionStorage.setItem('referralCode', code); localStorage.setItem('unn_referral_code', code);
      if (msg) { msg.textContent = '✓ Referral applied — original ticket price unlocked.'; msg.className = 'form-hint referral-message success'; }
      await refreshReferralPricing();
    } catch (e) {
      referralApplied = false; appliedReferralCode = '';
      if (msg) { msg.textContent = e.message || 'Invalid referral code.'; msg.className = 'form-hint referral-message error'; }
      await refreshReferralPricing();
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Apply'; } }
  }

  async function refreshReferralPricing() {
    try {
      const eventId = checkoutData.eventId || checkoutData.eventValue || '';
      if (!eventId) return;
      const r = await fetch('/api/events'); const payload = await r.json();
      const events = (payload && payload.success && payload.events) || [];
      const ev = events.find(function(item) { return String(item.id || '') === String(eventId); });
      if (!ev) return;
      const tier = String(checkoutData.ticketTier || 'regular').toLowerCase();
      const originals = {regular:Number(ev.price||0),vip:Number(ev.vipPrice||0),vvip:Number(ev.vvipPrice||0),table:Number(ev.tablePrice||0)};
      const bonuses = {regular:Number(ev.bonusPrice||0),vip:Number(ev.bonusVipPrice||0),vvip:Number(ev.bonusVvipPrice||0),table:Number(ev.bonusTablePrice||0)};
      const original = originals[tier] > 0 ? originals[tier] : originals.regular;
      const bonus = bonuses[tier] || 0;
      renderCheckoutPrice(original, bonus);
    } catch(e) {}
  }

  const referralInput = document.getElementById('referralCodeInput');
  const applyReferralBtn = document.getElementById('applyReferralBtn');
  const removeReferralBtn = document.getElementById('removeReferralBtn');
  if (applyReferralBtn) applyReferralBtn.addEventListener('click', applyReferralCode);
  if (removeReferralBtn) removeReferralBtn.addEventListener('click', async function() {
    referralApplied = false;
    appliedReferralCode = '';
    if (referralInput) referralInput.value = '';
    try { sessionStorage.removeItem('referralCode'); } catch (e) {}
    try { localStorage.removeItem('unn_referral_code'); } catch (e) {}
    const msg = document.getElementById('referralMessage');
    if (msg) {
      msg.textContent = 'Referral removed. Your bonus price is active.';
      msg.className = 'form-hint referral-message';
    }
    await refreshReferralPricing();
  });
  if (referralInput) referralInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); applyReferralCode(); } });

  function renderCouponTotal() {
    if (summaryTotal) summaryTotal.textContent = '\u20A6' + total.toLocaleString();
    if (placeOrderTotal) placeOrderTotal.textContent = '\u20A6' + total.toLocaleString();
    if (mobileBarTotal) mobileBarTotal.textContent = '\u20A6' + total.toLocaleString();
    const box=document.getElementById('couponSummary'), baseEl=document.getElementById('couponBaseTotal'), discEl=document.getElementById('couponDiscountTotal'), finalEl=document.getElementById('couponFinalTotal');
    if (box && appliedCoupon) { box.style.display='block'; if(baseEl)baseEl.textContent='\u20A6'+baseTotal.toLocaleString(); if(discEl)discEl.textContent='−\u20A6'+Number(appliedCoupon.amount||0).toLocaleString(); if(finalEl)finalEl.textContent='\u20A6'+total.toLocaleString(); }
    else if(box) box.style.display='none';
  }

  const couponInput=document.getElementById('couponCodeInput');
  const applyCouponBtn=document.getElementById('applyCouponBtn');
  const couponMessage=document.getElementById('couponMessage');
  if(applyCouponBtn) applyCouponBtn.addEventListener('click', function(){
    const code=(couponInput&&couponInput.value||'').trim().toUpperCase();
    if(!code){ appliedCoupon=null; total=baseTotal; renderCouponTotal(); if(couponMessage)couponMessage.textContent='Enter a coupon code first.'; return; }
    applyCouponBtn.disabled=true; applyCouponBtn.textContent='Checking…';
    fetch('/api/coupons/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,eventId:checkoutData.eventId||checkoutData.eventValue||'',ticketTier:checkoutData.ticketTier||'regular',qty:checkoutData.qty,referralCode:appliedReferralCode})})
      .then(r=>r.json().then(d=>({ok:r.ok,data:d}))).then(function(x){
        if(!x.ok||!x.data.success) throw new Error(x.data.error||'Invalid coupon');
        appliedCoupon=x.data.coupon; total=Number(x.data.total)||baseTotal; if(couponMessage) {couponMessage.textContent='✓ Coupon applied — saved ₦'+Number(appliedCoupon.amount||0).toLocaleString(); couponMessage.style.color='var(--accent)';} renderCouponTotal();
      }).catch(function(err){ appliedCoupon=null; total=baseTotal; renderCouponTotal(); if(couponMessage){couponMessage.textContent=err.message||'Invalid coupon code.';couponMessage.style.color='#B71C1C';} })
      .finally(function(){applyCouponBtn.disabled=false;applyCouponBtn.textContent='Apply Coupon';});
  });
  if(couponInput) couponInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();if(applyCouponBtn)applyCouponBtn.click();}});

  if (summaryBuyer) summaryBuyer.textContent = checkoutData.buyerName || '\u2014';
  if (summaryEmail) summaryEmail.textContent = checkoutData.buyerEmail || '\u2014';

  // Pre-fill and automatically apply referral code from URL/session when present.
  const refInput = document.getElementById('referralCodeInput');
  if (refInput) {
    const savedRef = (new URLSearchParams(window.location.search).get('ref') || sessionStorage.getItem('referralCode') || localStorage.getItem('unn_referral_code') || '').trim();
    if (savedRef) { refInput.value = savedRef.toUpperCase(); setTimeout(function(){ applyReferralCode(); }, 50); }
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
      // A code typed by the buyer must take priority over a previously stored
      // referral code. This prevents one buyer/session from accidentally
      // attributing a later purchase to an old influencer.
      const inputEl = document.getElementById('referralCodeInput');
      let referralCode = inputEl && inputEl.value ? inputEl.value.trim() : '';
      if (!referralCode) referralCode = (urlParams.get('ref') || '').trim();
      if (!referralCode) referralCode = (sessionStorage.getItem('referralCode') || localStorage.getItem('unn_referral_code') || '').trim();
      if (referralCode) {
        referralCode = referralCode.toUpperCase();
        sessionStorage.setItem('referralCode', referralCode);
        localStorage.setItem('unn_referral_code', referralCode);
      }
      return referralCode;
    } catch (e) {
      return '';
    }
  }

  function createOrderViaApi(orderId, orderTotal, successCallback) {
    // Manual referral input takes priority; otherwise use the saved referral URL/session code.
    // Referral is optional. If a referral link/session code exists, attach it;
    // otherwise the order proceeds without a referral code.
    const referralCode = getReferralCodeFromUrlOrSessionOrInput();

    fetch('/api/orders', {
      method: 'POST',
      headers: window.UNNAuth ? window.UNNAuth.authHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: orderId,
        eventId: checkoutData.eventId || checkoutData.eventValue || '',
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
        referralCode: referralCode,  // Add referral code to order
        couponCode: appliedCoupon ? appliedCoupon.code : ''
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (successCallback) successCallback(data && data.success, data && data.order ? data.order.ticketCodes : null, data && data.order ? Number(data.order.amount || 0) : 0);
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
    createOrderViaApi(orderId, total, function(success, ticketCodes, serverAmount) {
      if (!success) {
        alert('Could not create your order. Please try again.');
        if (placeBtn) { placeBtn.disabled = false; placeBtn.textContent = '🛒 Place Order — ₦' + total.toLocaleString(); }
        return;
      }
      // 2) Open Flutterwave to pay for that exact order id
      const paymentAmount = serverAmount > 0 ? serverAmount : total;
      total = paymentAmount;
      renderCouponTotal();
      startFlutterwavePayment(orderId, eventName, qty, paymentAmount, name, email, phone);
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

