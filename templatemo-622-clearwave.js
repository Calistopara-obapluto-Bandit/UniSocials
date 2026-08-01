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
      eventsCount.innerHTML = 'Showing <strong>' + visibleCount + '</strong> event' + (visibleCount !== 1 ? 's' : '');
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

  function updateContinueBtn() {
    const opt = getSelectedOption();
    const name = buyerName ? buyerName.value.trim() : '';
    const email = buyerEmail ? buyerEmail.value.trim() : '';
    const phone = buyerPhone ? buyerPhone.value.trim() : '';
    const canContinue = !!opt.value && name.length > 0 && email.length > 0 && phone.length > 0;
    if (continueBtn) continueBtn.disabled = !canContinue;
  }

  window.continueToCheckout = function() {
    const opt = getSelectedOption();
    if (!opt.value) { alert('Please select an event.'); return; }
    const name = buyerName ? buyerName.value.trim() : '';
    const email = buyerEmail ? buyerEmail.value.trim() : '';
    const phone = buyerPhone ? buyerPhone.value.trim() : '';
    if (!name || !email || !phone) { alert('Please fill in your name, email, and phone number.'); return; }

    // Save to sessionStorage
    sessionStorage.setItem('checkoutData', JSON.stringify({
      eventValue: opt.value,
      eventName: opt.dataset.name,
      eventDate: opt.dataset.date,
      eventTime: opt.dataset.time,
      eventVenue: opt.dataset.venue,
      eventPrice: parseFloat(opt.dataset.price || 0),
      qty: parseInt(qtySelect ? qtySelect.value : 1),
      buyerName: name,
      buyerEmail: email,
      buyerPhone: phone,
      buyerFaculty: buyerFaculty ? buyerFaculty.value.trim() : ''
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
    }
    updateEventDetails();
  }

  if (eventSelect) eventSelect.addEventListener('change', updateEventDetails);
  if (qtySelect) qtySelect.addEventListener('change', updateContinueBtn);
  if (buyerName) buyerName.addEventListener('input', updateContinueBtn);
  if (buyerEmail) buyerEmail.addEventListener('input', updateContinueBtn);
  if (buyerPhone) buyerPhone.addEventListener('input', updateContinueBtn);

  window.updateEventDetails = updateEventDetails;
  readUrlParams();
})();

/* ══════════════════════════════════════════
   CHECKOUT — PAYMENT (Step 2 with API integration)
   ══════════════════════════════════════════ */
(function() {
  const summaryEventName = document.getElementById('summaryEventName');
  const summaryDate = document.getElementById('summaryDate');
  const summaryVenue = document.getElementById('summaryVenue');
  const summaryQty = document.getElementById('summaryQty');
  const summaryUnitPrice = document.getElementById('summaryUnitPrice');
  const summaryTotal = document.getElementById('summaryTotal');
  const summaryPayment = document.getElementById('summaryPayment');
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
  if (summaryUnitPrice) summaryUnitPrice.textContent = '\u20A6' + (checkoutData.eventPrice || 0).toLocaleString();
  if (summaryTotal) summaryTotal.textContent = '\u20A6' + total.toLocaleString();
  if (summaryBuyer) summaryBuyer.textContent = checkoutData.buyerName || '\u2014';
  if (summaryEmail) summaryEmail.textContent = checkoutData.buyerEmail || '\u2014';
  if (mobileBarTotal) mobileBarTotal.textContent = '\u20A6' + total.toLocaleString();
  if (placeOrderTotal) placeOrderTotal.textContent = '\u20A6' + total.toLocaleString();

  function updatePaymentNote() {
    const cfg = window.SITE_CONFIG || {};
    const flwBank = cfg.FLUTTERWAVE_BANK_NAME || 'Flutterwave MfB (formerly ok mfb)';
    const flwAcct = cfg.FLUTTERWAVE_ACCOUNT_NUMBER || '';

    const selected = document.querySelector('input[name="payment"]:checked');
    const val = selected ? selected.value : 'bank-transfer';
    const note = document.getElementById('paymentNote');
    const bankDetails = document.getElementById('bankTransferDetails');

    if (summaryPayment) {
      summaryPayment.textContent = val === 'flutterwave' ? 'Flutterwave' : 'Bank Transfer';
    }

    if (val === 'flutterwave') {
      if (note) {
        note.innerHTML = 'You will be redirected to Flutterwave to pay securely with card, bank transfer, USSD, or mobile money. Your Order ID is generated instantly and verified before confirmation.';
      }
      if (bankDetails) bankDetails.style.display = 'none';
    } else {
      if (note) {
        note.innerHTML = 'Bank Transfer: Transfer to <strong>' + flwBank + '</strong>. Use your Order ID as reference.';
      }
      if (bankDetails) bankDetails.style.display = '';
    }

    const bankNameEl = document.getElementById('flwBankName');
    const accountBankEl = document.getElementById('accountBankName');
    const accountNumEl = document.getElementById('accountNumber');
    if (bankNameEl) bankNameEl.textContent = flwBank;
    if (accountBankEl) accountBankEl.textContent = flwBank;
    if (accountNumEl && flwAcct) accountNumEl.textContent = flwAcct;
  }

  function revealAccount() {
    const accountReveal = document.getElementById('accountReveal');
    const btn = document.querySelector('.reveal-account-btn');
    if (!accountReveal) return;
    const isHidden = accountReveal.style.display === 'none';
    accountReveal.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.innerHTML = isHidden ? 'Hide Account Number' : 'Show Account Number';
  }

  function copyAccountNumber() {
    const cfg = window.SITE_CONFIG || {};
    const flwAcct = cfg.FLUTTERWAVE_ACCOUNT_NUMBER || '9707788756';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(flwAcct).then(function() {
        alert('Account number copied: ' + flwAcct);
      }).catch(function() {
        prompt('Copy the account number:', flwAcct);
      });
    } else {
      prompt('Copy the account number:', flwAcct);
    }
  }

  function generateOrderId() {
    return 'UNN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function showSuccessModal(orderId, eventName, totalPaid, ticketCode) {
    const idEl = document.getElementById('orderId');
    const evEl = document.getElementById('orderEvent');
    const totalEl = document.getElementById('orderTotal');
    const ticketLink = document.getElementById('viewTicketLink');
    if (idEl) idEl.textContent = orderId;
    if (evEl) evEl.textContent = eventName;
    if (totalEl) totalEl.textContent = '\u20A6' + totalPaid.toLocaleString();
    if (ticketLink) {
      if (ticketCode) {
        ticketLink.style.display = 'inline-flex';
        ticketLink.setAttribute('href', 'ticket.html?orderId=' + encodeURIComponent(orderId) + '&code=' + encodeURIComponent(ticketCode));
      } else {
        // No code yet (e.g. bank transfer) — go to order lookup
        ticketLink.textContent = '🎟 Find My Ticket';
        ticketLink.setAttribute('href', 'my-tickets.html');
        ticketLink.style.display = 'inline-flex';
      }
    }
    if (successModal) successModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeSuccessModal() {
    if (successModal) successModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  function sendOrderToWhatsApp(orderId, eventName, qty, totalPaid, paymentLabel, name, email, phone) {
    var msg = '🛒 *New Ticket Order!*\n\n' +
      'Order ID: ' + orderId + '\n' +
      'Event: ' + eventName + '\n' +
      'Qty: ' + qty + '\n' +
      'Total: ₦' + totalPaid.toLocaleString() + '\n' +
      'Payment: ' + paymentLabel + '\n\n' +
      '👤 ' + name + '\n' +
      '📧 ' + email + '\n' +
      '📞 ' + phone + '\n\n' +
      'Thank you for using UNN Socials!';
    const cfg = window.SITE_CONFIG || {};
    const waNumber = cfg.WHATSAPP_ORDER_NUMBER || '2348122104576';
    window.open('https://wa.me/' + waNumber + '?text=' + encodeURIComponent(msg), '_blank');
  }

  function createOrderViaApi(orderId, paymentMethod, orderTotal, successCallback) {
    fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: orderId,
        eventName: checkoutData.eventName,
        eventDate: checkoutData.eventDate ? (checkoutData.eventDate + ' \u00B7 ' + (checkoutData.eventTime || '')) : '',
        eventVenue: checkoutData.eventVenue || '',
        qty: checkoutData.qty,
        amount: orderTotal,
        currency: 'NGN',
        paymentMethod: paymentMethod,
        buyerName: checkoutData.buyerName,
        buyerEmail: checkoutData.buyerEmail,
        buyerPhone: checkoutData.buyerPhone,
        buyerFaculty: checkoutData.buyerFaculty || ''
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (successCallback) successCallback(data && data.success, data && data.order ? data.order.ticketCode : null);
    })
    .catch(function() {
      if (successCallback) successCallback(true, null);
    });
  }

  function startFlutterwavePayment(orderId, eventName, qty, orderTotal, name, email, phone) {
    const cfg = window.SITE_CONFIG || {};
    const publicKey = cfg.FLUTTERWAVE_PUBLIC_KEY || '';

    if (!publicKey) {
      alert('Flutterwave is not configured. Please use Bank Transfer or contact support.');
      return;
    }

    const customerName = name || 'UNN Customer';

    const payload = {
      public_key: publicKey,
      tx_ref: orderId,
      amount: orderTotal,
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
          fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx_ref: response.tx_ref || orderId })
          })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data && data.success) {
              const verifiedAmount = parseFloat(data.amount) || orderTotal;
              const totalPaid = verifiedAmount > 0 ? verifiedAmount : orderTotal;
              createOrderViaApi(orderId, 'flutterwave', totalPaid, function(success, ticketCode) {
                sendOrderToWhatsApp(orderId, eventName, qty, totalPaid, 'Flutterwave', name, email, phone);
                showSuccessModal(orderId, eventName, totalPaid, ticketCode);
              });
            } else {
              alert('Payment verification failed. Please contact support with your Order ID: ' + orderId);
            }
          })
          .catch(function() {
            createOrderViaApi(orderId, 'flutterwave', orderTotal, function(success, ticketCode) {
              sendOrderToWhatsApp(orderId, eventName, qty, orderTotal, 'Flutterwave', name, email, phone);
              showSuccessModal(orderId, eventName, orderTotal, ticketCode);
            });
          });
        } else {
          alert('Payment was not completed. You can try again or choose another payment method.');
        }
      },
      onclose: function() {}
    };

    if (typeof window.FlutterwaveCheckout === 'function') {
      window.FlutterwaveCheckout(payload);
    } else {
      alert('Flutterwave checkout could not be loaded. Please check your internet connection or try another payment method.');
    }
  }

  window.placeOrder = function() {
    const orderId = generateOrderId();
    const eventName = checkoutData.eventName;
    const qty = checkoutData.qty;
    const name = checkoutData.buyerName;
    const email = checkoutData.buyerEmail;
    const phone = checkoutData.buyerPhone;
    const cfg = window.SITE_CONFIG || {};
    const flwBank = cfg.FLUTTERWAVE_BANK_NAME || 'Flutterwave MfB (formerly ok mfb)';
    const flwAcct = cfg.FLUTTERWAVE_ACCOUNT_NUMBER || '9707788756';

    const paymentMethod = document.querySelector('input[name="payment"]:checked');
    const selectedPayment = paymentMethod ? paymentMethod.value : 'bank-transfer';

    if (selectedPayment === 'flutterwave') {
      startFlutterwavePayment(orderId, eventName, qty, total, name, email, phone);
      return;
    }

    // Bank Transfer payment
    sessionStorage.setItem('pendingOrder', JSON.stringify({
      orderId: orderId,
      eventName: eventName,
      qty: qty,
      amount: total,
      paymentMethod: 'bank-transfer',
      buyerName: name,
      buyerEmail: email,
      buyerPhone: phone,
      bankName: flwBank,
      accountNumber: flwAcct
    }));

    sendOrderToWhatsApp(orderId, eventName, qty, total, 'Bank Transfer', name, email, phone);

    createOrderViaApi(orderId, 'bank-transfer', total, function(apiSuccess) {
      window.location.href = 'pending.html?orderId=' + encodeURIComponent(orderId);
    });
  };

  // Bind events
  document.querySelectorAll('input[name="payment"]').forEach(function(el) {
    el.addEventListener('change', updatePaymentNote);
  });

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
  window.revealAccount = revealAccount;
  window.copyAccountNumber = copyAccountNumber;
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
