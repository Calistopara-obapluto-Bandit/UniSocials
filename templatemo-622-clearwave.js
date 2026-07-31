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
  const mobilePlaceOrderBtn = document.getElementById('mobilePlaceOrderBtn');

  if (!eventSelect) return; // Not on checkout page

  // Summary elements
  const summaryEventName = document.getElementById('summaryEventName');
  const summaryQty = document.getElementById('summaryQty');
  const summaryUnitPrice = document.getElementById('summaryUnitPrice');
  const summaryTotal = document.getElementById('summaryTotal');
  const summaryPayment = document.getElementById('summaryPayment');

  // Mobile sticky bar elements
  const mobileBarTotal = document.getElementById('mobileBarTotal');

  // Preview elements
  const eventPreview = document.getElementById('eventPreview');
  const previewDate = document.getElementById('previewDate');
  const previewVenue = document.getElementById('previewVenue');

  // Payment note
  const paymentNote = document.getElementById('paymentNote');

  // Success modal elements
  const successModal = document.getElementById('successModal');
  const modalClose = document.getElementById('modalClose');

  function isFlutterwaveConfigured() {
    const cfg = window.SITE_CONFIG || {};
    const key = cfg.FLUTTERWAVE_PUBLIC_KEY || '';
    return key.indexOf('FLWPUBK-') === 0 && key.indexOf('xxxx') === -1;
  }

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

    // Sync mobile sticky bar total
    if (mobileBarTotal) mobileBarTotal.textContent = total ? '₦' + total.toLocaleString() : '—';

    // Enable/disable order buttons
    const hasEvent = !!opt.value;
    const hasName = buyerName ? buyerName.value.trim().length > 0 : false;
    const hasEmail = buyerEmail ? buyerEmail.value.trim().length > 0 : false;
    const hasPhone = buyerPhone ? buyerPhone.value.trim().length > 0 : false;
    const canOrder = hasEvent && hasName && hasEmail && hasPhone;

    if (placeOrderBtn) placeOrderBtn.disabled = !canOrder;
    if (mobilePlaceOrderBtn) mobilePlaceOrderBtn.disabled = !canOrder;
  }

  function updatePaymentNote() {
    const selected = document.querySelector('input[name="payment"]:checked');
    if (!selected) return;
    const val = selected.value;
    const note = document.getElementById('paymentNote');
    const summaryPay = document.getElementById('summaryPayment');
    const cfg = window.SITE_CONFIG || {};

    if (summaryPay) {
      const labels = { 'bank-transfer': 'Bank Transfer', 'flutterwave': 'Flutterwave', 'ussd': 'USSD' };
      summaryPay.textContent = labels[val] || 'Bank Transfer';
    }

    if (note) {
      const bankName = cfg.BANK_NAME || 'GTBank';
      const acctName = cfg.BANK_ACCOUNT_NAME || 'UNN Socials';
      const acctNum = cfg.BANK_ACCOUNT_NUMBER || '0123456789';
      const ussd = cfg.USSD_CODE || '*123*456*';
      const notes = {
        'bank-transfer': '💰 <strong>Bank Transfer:</strong> Transfer to <strong>' + acctName + '</strong> — ' + bankName + ' <strong>' + acctNum + '</strong>. Use your Order ID as reference.',
        'flutterwave': '⚡ <strong>Flutterwave:</strong> Pay securely by card, bank transfer, USSD, or mobile money. You will be redirected to Flutterwave to complete your payment.',
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

  // Open the success modal with order details
  function showSuccessModal(orderId, eventName, total) {
    const idEl = document.getElementById('orderId');
    const evEl = document.getElementById('orderEvent');
    const totalEl = document.getElementById('orderTotal');
    if (idEl) idEl.textContent = orderId;
    if (evEl) evEl.textContent = eventName;
    if (totalEl) totalEl.textContent = '₦' + total.toLocaleString();
    if (successModal) successModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeSuccessModal() {
    if (successModal) successModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  // Send the order details to WhatsApp
  function sendOrderToWhatsApp(orderId, eventName, qty, total, paymentLabel, name, email, phone) {
    const msg = encodeURIComponent(
      `🛒 *New Ticket Order!*\n\n` +
      `Order ID: ${orderId}\n` +
      `Event: ${eventName}\n` +
      `Qty: ${qty}\n` +
      `Total: ₦${total.toLocaleString()}\n` +
      `Payment: ${paymentLabel}\n\n` +
      `👤 ${name}\n` +
      `📧 ${email}\n` +
      `📞 ${phone}\n\n` +
      `Thank you for using UNN Socials! 🎉`
    );
    const cfg = window.SITE_CONFIG || {};
    const waNumber = cfg.WHATSAPP_ORDER_NUMBER || '2348122104576';
    window.open(`https://wa.me/${waNumber}?text=${msg}`, '_blank');
  }

  // Generate a unique transaction reference
  function generateOrderId() {
    return 'UNN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  // Open the Flutterwave inline checkout
  function startFlutterwavePayment(orderId, eventName, qty, total, name, email, phone) {
    const cfg = window.SITE_CONFIG || {};
    const publicKey = cfg.FLUTTERWAVE_PUBLIC_KEY || '';
    const customerName = name || 'UNN Customer';

    const payload = {
      public_key: publicKey,
      tx_ref: orderId,
      amount: total,
      currency: 'NGN',
      payment_options: 'card, banktransfer, ussd, mobilemoney, account',
      redirect_url: cfg.REDIRECT_URL || 'https://unisocials.onrender.com/thank-you.html',
      customer: {
        email: email || 'customer@unn.edu.ng',
        name: customerName,
        phone_number: phone || ''
      },
      customizations: {
        title: 'UNN Socials',
        description: eventName + (qty > 1 ? ' (' + qty + ' tickets)' : ''),
        logo: 'https://unisocials.onrender.com/images/tm-622-screen-01.jpg'
      },
      callback: function(response) {
        if (response && (response.status === 'successful' || response.status === 'completed')) {
          const totalPaid = parseFloat(response.amount) || total;
          sendOrderToWhatsApp(orderId, eventName, qty, totalPaid, 'Flutterwave', name, email, phone);
          showSuccessModal(orderId, eventName, totalPaid);
        } else {
          alert('Payment was not completed. You can try again or choose another payment method.');
        }
      },
      onclose: function() {
        // User closed the modal without completing payment
      }
    };

    if (typeof window.FlutterwaveCheckout === 'function') {
      window.FlutterwaveCheckout(payload);
    } else {
      alert('Flutterwave checkout could not be loaded. Please check your internet connection or try another payment method.');
    }
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
    const orderId = generateOrderId();
    const eventName = opt.dataset.name;
    const qty = parseInt(qtySelect ? qtySelect.value : 1);
    const price = getPrice();
    const total = price * qty;
    const payment = document.querySelector('input[name="payment"]:checked')?.value || 'bank-transfer';

    const paymentLabels = { 'bank-transfer': 'Bank Transfer', 'flutterwave': 'Flutterwave', 'ussd': 'USSD' };
    const paymentLabel = paymentLabels[payment] || 'Bank Transfer';

    // Flutterwave path — launch the inline checkout modal
    if (payment === 'flutterwave') {
      if (!isFlutterwaveConfigured()) {
        alert('Flutterwave is not configured yet. Please add your Flutterwave public key in config.js / Render env vars, or choose another payment method.');
        return;
      }
      startFlutterwavePayment(orderId, eventName, qty, total, name, email, phone);
      return;
    }

    // Build order summary
    const summary = `
      Order ID: ${orderId}
      Event: ${eventName}
      Quantity: ${qty}
      Total: ₦${total.toLocaleString()}
      Payment: ${paymentLabel}
      Name: ${name}
      Email: ${email}
      Phone: ${phone}
    `;

    // Complete the order via WhatsApp + success modal (legacy confirm flow below is unreachable)
    sendOrderToWhatsApp(orderId, eventName, qty, total, paymentLabel, name, email, phone);
    showSuccessModal(orderId, eventName, total);
    return;

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

  // Success modal — close handlers
  if (successModal) {
    successModal.addEventListener('click', function(e) {
      if (e.target === successModal) closeSuccessModal();
    });
  }
  if (modalClose) modalClose.addEventListener('click', closeSuccessModal);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSuccessModal();
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
      totalDisplay.textContent = `₦${(price * qty).toLocaleString()}`;
    });
  }
});
