import { useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';

/*
 * React port of faq.html. The legacy page toggled `.open` on `.faq-item` from a
 * delegated handler in the shared bundle; here the open state is React state,
 * so only one answer needs to be tracked and aria-expanded stays in sync.
 */
const ITEMS = [
  {
    q: 'How do I buy a ticket?',
    a: (
      <>
        Simply browse the events page, select the event you&apos;re interested in, and click &quot;Buy Now&quot; on the
        tickets page. You&apos;ll be guided through the checkout process. After payment, your digital ticket will be
        sent to your email and phone.
      </>
    ),
  },
  {
    q: 'What payment methods are accepted?',
    a: (
      <>
        We accept all major payment methods securely through <strong>Flutterwave</strong> — including debit/credit
        cards, bank transfer, USSD, and mobile money. Your payment is processed by Flutterwave, our trusted payment
        gateway.
      </>
    ),
  },
  {
    q: "Can I get a refund if I can't attend?",
    a: (
      <>
        Refund policies vary by event. Some events offer full refunds up to 48 hours before the event, while others
        are non-refundable. Please check the event-specific terms before purchasing. Contact support for assistance
        with refund requests.
      </>
    ),
  },
  {
    q: 'How do I list my event on Unisocials?',
    a: (
      <>
        Simply fill out the contact form or email us at{' '}
        <span id="faqEmail">{(window.SITE_CONFIG && window.SITE_CONFIG.CONTACT_EMAIL) || 'support.sbiamautos@gmail.com'}</span>{' '}
        with your event details, and our team will set everything up for you.
      </>
    ),
  },
  {
    q: 'Is there a fee for selling tickets?',
    a: (
      <>
        There is no fee to list events on Unisocials. We charge a service fee (20%) on each ticket sold to cover
        payment processing and platform maintenance. This fee is included in the ticket price shown to buyers.
      </>
    ),
  },
  {
    q: 'How will I receive my ticket after purchase?',
    a: (
      <>
        Your digital ticket will be sent via email and SMS immediately after payment confirmation. You can also access
        your tickets anytime by visiting the &quot;My Tickets&quot; page on our platform. Simply show the QR code at
        the event entrance.
      </>
    ),
  },
  {
    q: 'Can I transfer my ticket to someone else?',
    a: (
      <>
        Yes, tickets are transferable. You can transfer your ticket to another student by contacting support at least
        24 hours before the event. The new attendee will receive a fresh QR code for entry.
      </>
    ),
  },
  {
    q: 'What if I lose my ticket QR code?',
    a: (
      <>
        Don&apos;t worry! You can request a resend from the &quot;My Tickets&quot; page, or contact support and
        we&apos;ll resend your ticket to your email and phone immediately. We recommend saving a screenshot of your QR
        code after purchase.
      </>
    ),
  },
];

export default function Faq() {
  const [openIndex, setOpenIndex] = useState(-1);

  return (
    <>
      <Nav />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">FAQ</div>
          <h1 className="section-title reveal reveal-delay-1">Frequently asked<br /><em>questions</em></h1>
          <p className="section-sub reveal reveal-delay-2">
            Everything you need to know about buying tickets, listing events, and using Unisocials.
          </p>
        </div>
      </section>

      <section className="content-section">
        <div className="container">
          <div className="faq-list" id="faqList">
            {ITEMS.map((item, i) => {
              const open = openIndex === i;
              return (
                <div className={'faq-item' + (open ? ' open' : '')} key={i}>
                  <div
                    className="faq-question"
                    tabIndex={0}
                    role="button"
                    aria-expanded={open}
                    onClick={() => setOpenIndex(open ? -1 : i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenIndex(open ? -1 : i);
                      }
                    }}
                  >
                    {item.q}
                    <div className="faq-icon">{open ? '−' : '+'}</div>
                  </div>
                  <div className="faq-answer">
                    <div className="faq-answer-inner">{item.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container">
          <div className="cta-inner reveal">
            <div className="cta-content">
              <h2 className="cta-title">Still have questions?<br /><em>We&apos;re here to help.</em></h2>
              <p className="cta-sub">Reach out to our support team and we&apos;ll get back to you within hours.</p>
            </div>
            <div className="cta-actions">
              <a href="/contact.html" className="btn-cta-primary">Contact Us <span>→</span></a>
              <a href="/events.html" className="btn-cta-ghost">Browse Events</a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
