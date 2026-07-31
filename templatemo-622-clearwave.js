/*
UNN Socials — Event Ticket Selling Platform for University of Nigeria
Rebranded from TemplateMo 622 Clearwave
https://templatemo.com/tm-622-clearwave
Free for personal and commercial use
*/

/* ══════════════════════════════════════════
   SITE CONFIGURATION — apply centralized values
   ══════════════════════════════════════════ */
(function() {
  const cfg = window.SITE_CONFIG || {};

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
    // Format display: +234 812 210 4576
    contactPhoneLink.textContent = '+' + num.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
  }

  // FAQ — contact email
  const faqEmail = document.getElementById('faqEmail');
  if (faqEmail) {
    faqEmail.textContent = cfg.CONTACT_EMAIL || 'events@unnsocials.com';
  }

  // Contact form — FormSubmit key & redirect URL
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    const key = cfg.FORMSUBMIT_KEY || '8d51333da2a9cfabfb087ffb615b7963';
    contactForm.setAttribute('action', 'https://formsubmit.co/' + key);
  }
  const formNext = document.getElementById('formNext');
  if (formNext) {
    formNext.value = cfg.REDIRECT_URL || 'https://unnsocials.com/thank-you.html';
  }
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

      // Category filter
      const catMatch = category === 'all' || cat === category;

      // Price filter
      let priceMatch = true;
      if (price === 'low') priceMatch = p < 2000;
      else if (price === 'mid') priceMatch = p >= 2000 && p <= 4000;
      else if (price === 'high') priceMatch = p > 4000;

      // Search text
      const searchMatch = !search || searchText.includes(search);

      if (catMatch && priceMatch && searchMatch) {
        card.style.display = '';
        visibleCount++;
        // Re-trigger reveal animation
        card.classList.remove('visible');
        setTimeout(() => card.classList.add('visible'), 50);
      } else {
        card.style.display = 'none';
      }
    });

    // Update count
    if (eventsCount) {
      eventsCount.innerHTML = `Showing <strong>${visibleCount}</strong> event${visibleCount !== 1 ? 's' : ''}`;
    }

    // Show no results
    if (noResults) {
      noResults.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  }

  // Bind events
  if (searchInput) searchInput.addEventListener('input', filterEvents);
  if (categoryFilter) categoryFilter.addEventListener('change', filterEvents);
  if (priceFilter) priceFilter.addEventListener('change', filterEvents);

  // Expose reset for "Clear Filters" button
  window.resetFilters = function() {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (priceFilter) priceFilter.value = 'all';
    filterEvents();
  };
})();

/* ══════════════════════════════════════════
   TICKETS — CHECKOUT
   ══════════════════════════════════════════ */
(function() {
  const eventSelect = document.getElementById('eventSelect');
  const qtySelect = document.getElementById('qtySelect');
  const buyerName = document.getElementById('buyerName');
  const buyerEmail = document.getElementById('buyerEmail');
  const buyerPhone = document.getElementById('buyerPhone');
  const buyerFaculty = document.getElementById('buyerFaculty');
  const placeOrderBtn = document.getElementById('placeOrderBtn');

  if (!eventSelect) return; // Not on checkout page

  // Summary elements
  const summaryEventName = document.getElementById('summaryEventName');
  const summaryQty = document.getElementById('summaryQty');
  const summaryUnitPrice = document.getElementById('summaryUnitPrice');
  const summaryTotal = document.getElementById('summaryTotal');
  const summaryPayment = document.getElementById('summaryPayment');

  // Preview elements
  const eventPreview = document.getElementById('eventPreview');
  const previewDate = document.getElementById('previewDate');
  const previewVenue = document.getElementById('previewVenue');

  // Payment note
  const paymentNote = document.getElementById('paymentNote');

  function getSelectedOption() {
    return eventSelect.options[eventSelect.selectedIndex];
  }

  function getPrice() {
    const opt = getSelectedOption();
    return parseFloat(opt.dataset.price || 0);
  }

  function updateEventDetails() {
    const opt = getSelectedOption();
    const name = opt.dataset.name || '';
    const date = opt.dataset.date || '';
    const time = opt.dataset.time || '';
    const venue = opt.dataset.venue || '';

    // Show preview
    if (eventPreview && opt.value) {
      eventPreview.style.display = 'block';
      if (previewDate) previewDate.textContent = date + ' · ' + time;
      if (previewVenue) previewVenue.textContent = venue;
    } else if (eventPreview) {
      eventPreview.style.display = 'none';
    }

    updateOrderSummary();
  }

  function updateOrderSummary() {
    const opt = getSelectedOption();
    const name = opt.dataset.name || '';
    const price = getPrice();
    const qty = parseInt(qtySelect ? qtySelect.value : 1);
    const total = price * qty;

    if (summaryEventName) summaryEventName.textContent = name || 'Not selected';
    if (summaryQty) summaryQty.textContent = opt.value ? qty + ' ticket' + (qty > 1 ? 's' : '') : '—';
    if (summaryUnitPrice) summaryUnitPrice.textContent = price ? '₦' + price.toLocaleString() : '—';
    if (summaryTotal) summaryTotal.textContent = total ? '₦' + total.toLocaleString() : '—';

    // Enable/disable order button
    if (placeOrderBtn) {
      const hasEvent = !!opt.value;
      const hasName = buyerName ? buyerName.value.trim().length > 0 : false;
      const hasEmail = buyerEmail ? buyerEmail.value.trim().length > 0 : false;
      const hasPhone = buyerPhone ? buyerPhone.value.trim().length > 0 : false;
      placeOrderBtn.disabled = !(hasEvent && hasName && hasEmail && hasPhone);
    }
  }

  function updatePaymentNote() {
    const selected = document.querySelector('input[name="payment"]:checked');
    if (!selected) return;
    const val = selected.value;
    const note = document.getElementById('paymentNote');
    const summaryPay = document.getElementById('summaryPayment');
    const cfg = window.SITE_CONFIG || {};

    if (summaryPay) {
      const labels = { 'bank-transfer': 'Bank Transfer', 'card': 'Debit / Credit Card', 'ussd': 'USSD' };
      summaryPay.textContent = labels[val] || 'Bank Transfer';
    }

    if (note) {
      const bankName = cfg.BANK_NAME || 'GTBank';
      const acctName = cfg.BANK_ACCOUNT_NAME || 'UNN Socials';
      const acctNum = cfg.BANK_ACCOUNT_NUMBER || '0123456789';
      const ussd = cfg.USSD_CODE || '*123*456*';
      const notes = {
        'bank-transfer': '💰 <strong>Bank Transfer:</strong> Transfer to <strong>' + acctName + '</strong> — ' + bankName + ' <strong>' + acctNum + '</strong>. Use your Order ID as reference.',
        'card': '💳 <strong>Card Payment:</strong> You will be redirected to a secure payment page after placing your order.',
        'ussd': '📱 <strong>USSD:</strong> Dial ' + ussd + '[OrderID]# on your registered mobile number to complete payment.'
      };
      note.innerHTML = notes[val] || notes['bank-transfer'];
    }
  }

  // Read URL params to pre-select event
  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const eventParam = params.get('event');
    if (eventParam && eventSelect) {
      for (const opt of eventSelect.options) {
        if (opt.value === eventParam) {
          opt.selected = true;
          break;
        }
      }
    }
    updateEventDetails();
  }

  function placeOrder() {
    const opt = getSelectedOption();
    if (!opt.value) {
      alert('Please select an event.');
      return;
    }
    const name = buyerName ? buyerName.value.trim() : '';
    const email = buyerEmail ? buyerEmail.value.trim() : '';
    const phone = buyerPhone ? buyerPhone.value.trim() : '';

    if (!name || !email || !phone) {
      alert('Please fill in your name, email, and phone number.');
      return;
    }

    // Generate order
    const orderId = 'UNN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const eventName = opt.dataset.name;
    const qty = parseInt(qtySelect ? qtySelect.value : 1);
    const price = getPrice();
    const total = price * qty;
    const payment = document.querySelector('input[name="payment"]:checked')?.value || 'bank-transfer';

    const paymentLabels = { 'bank-transfer': 'Bank Transfer', 'card': 'Card', 'ussd': 'USSD' };

    // Build order summary
    const summary = `
      Order ID: ${orderId}
      Event: ${eventName}
      Quantity: ${qty}
      Total: ₦${total.toLocaleString()}
      Payment: ${paymentLabels[payment] || payment}
      Name: ${name}
      Email: ${email}
      Phone: ${phone}
    `;

    // Show confirmation
    if (confirm(`🛒 Confirm Order?\n\n${summary}\n\nProceed with payment?`)) {
      const msg = encodeURIComponent(
        `🛒 *New Ticket Order!*\n\n` +
        `Order ID: ${orderId}\n` +
        `Event: ${eventName}\n` +
        `Qty: ${qty}\n` +
        `Total: ₦${total.toLocaleString()}\n` +
        `Payment: ${paymentLabels[payment]}\n\n` +
        `👤 ${name}\n` +
        `📧 ${email}\n` +
        `📞 ${phone}\n\n` +
        `Thank you for using UNN Socials! 🎉`
      );

      // Redirect to WhatsApp with order details
      const cfg = window.SITE_CONFIG || {};
      const waNumber = cfg.WHATSAPP_ORDER_NUMBER || '2348122104576';
      window.open(`https://wa.me/${waNumber}?text=${msg}`, '_blank');

      // Show success message
      alert(`✅ Order placed successfully!\n\nOrder ID: ${orderId}\n\nA confirmation has been sent to your WhatsApp. Please complete payment to confirm your ticket.`);
    }
  }

  // Bind events
  if (eventSelect) eventSelect.addEventListener('change', updateEventDetails);
  if (qtySelect) qtySelect.addEventListener('change', updateOrderSummary);
  if (buyerName) buyerName.addEventListener('input', updateOrderSummary);
  if (buyerEmail) buyerEmail.addEventListener('input', updateOrderSummary);
  if (buyerPhone) buyerPhone.addEventListener('input', updateOrderSummary);

  // Payment radio listeners
  document.querySelectorAll('input[name="payment"]').forEach(el => {
    el.addEventListener('change', updatePaymentNote);
  });

  // Expose functions
  window.updateEventDetails = updateEventDetails;
  window.updateOrderSummary = updateOrderSummary;
  window.updatePaymentNote = updatePaymentNote;
  window.placeOrder = placeOrder;

  // Init
  readUrlParams();
  updatePaymentNote();
})();

/* ══════════════════════════════════════════
   CONTACT — FORM VALIDATION
   ══════════════════════════════════════════ */
(function() {
  const contactForm = document.getElementById('contactForm');
  if (!contactForm) return;

  const nameInput = document.getElementById('contactName');
  const emailInput = document.getElementById('contactEmail');
  const subjectInput = document.getElementById('contactSubject');
  const messageInput = document.getElementById('contactMessage');
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

  contactForm.addEventListener('submit', function(e) {
    e.preventDefault();

    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const subject = subjectInput ? subjectInput.value.trim() : 'General Inquiry';
    const message = messageInput ? messageInput.value.trim() : '';

    const msg = encodeURIComponent(
      `📬 *New Contact Message*\n\n` +
      `From: ${name}\n` +
      `Email: ${email}\n` +
      `Subject: ${subject}\n\n` +
      `${message}\n\n` +
      `Sent via UNN Socials Contact Form`
    );

    const cfg = window.SITE_CONFIG || {};
    const waNumber = cfg.WHATSAPP_ORDER_NUMBER || '2348122104576';
    window.open(`https://wa.me/${waNumber}?text=${msg}`, '_blank');

    // Show confirmation
    alert(`✅ Message sent!\n\nThank you, ${name}. We'll get back to you within 24 hours.`);

    // Reset form
    contactForm.reset();
    if (submitBtn) submitBtn.disabled = true;
  });
})();

/* ── TICKET QUANTITY ON INDEX ── */
document.querySelectorAll('.ticket-form').forEach(form => {
  const qtySelect = form.querySelector('select');
  const totalDisplay = form.querySelector('.ticket-total');
  const price = parseFloat(form.dataset.price || 0);

  if (qtySelect && totalDisplay) {
    qtySelect.addEventListener('change', () => {
      const qty = parseInt(qtySelect.value);
      totalDisplay.textContent = `₦${(price * qty).toLocaleString()}`;
    });
  }
});
