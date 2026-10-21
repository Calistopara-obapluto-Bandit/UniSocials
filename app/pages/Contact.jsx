import { useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';

/*
 * React port of contact.html.
 *
 * The legacy page POSTs the form to FormSubmit's AJAX endpoint (the form's
 * action="/api/contact" is never used because the submit handler always
 * intercepts), using the configured FORMSUBMIT_KEY from /config.js rather than
 * the address that was previously hard-coded into the inline script.
 */
const DEFAULT_INBOX = 'support.sbiamautos@gmail.com';
const SUBJECTS = [
  'Ticket Purchase Issue',
  'List My Event',
  'Partnership Inquiry',
  'Feedback / Suggestion',
  'Other',
];

export default function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const waNumber = (window.SITE_CONFIG && window.SITE_CONFIG.WHATSAPP_FLOAT_NUMBER) || '2348122104576';
  const inbox = (window.SITE_CONFIG && window.SITE_CONFIG.FORMSUBMIT_KEY) || DEFAULT_INBOX;

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus({ text: 'Sending…', color: 'var(--text-3)' });
    try {
      const res = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(inbox), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, email, phone, subject, message }),
      });
      const data = await res.json();
      if (!res.ok || String(data.success) !== 'true') throw new Error(data.message || 'Message could not be sent.');
      setName('');
      setEmail('');
      setPhone('');
      setSubject('');
      setMessage('');
      setStatus({ text: 'Message sent. We will get back to you soon.', color: 'var(--accent)' });
    } catch (err) {
      setStatus({ text: err.message || 'Message could not be sent. Please try WhatsApp.', color: '#b71c1c' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Nav active="Contact" />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Contact</div>
          <h1 className="section-title reveal reveal-delay-1">Get in <em>touch</em></h1>
          <p className="section-sub reveal reveal-delay-2">
            Have a question or want to list your event? We&apos;d love to hear from you.
          </p>
        </div>
      </section>

      <section className="contact-section">
        <div className="container">
          <div className="contact-grid">
            <div className="contact-info reveal">
              <h3>How to reach us</h3>
              <p>
                Whether you&apos;re a student looking for help with a ticket purchase, or a faculty association wanting
                to list an event — we&apos;re here to help.
              </p>

              <div className="contact-detail">
                <div className="contact-detail-icon">📧</div>
                <span>Contact us via WhatsApp below</span>
              </div>
              <div className="contact-detail">
                <div className="contact-detail-icon" style={{ background: '#25D366', borderColor: '#25D366' }}>💬</div>
                <a
                  href={'https://wa.me/' + waNumber}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--text-1)', fontWeight: 600 }}
                  id="contactPhoneLink"
                >
                  +234 812 210 4576
                </a>
              </div>
              <div className="contact-detail">
                <div className="contact-detail-icon">📍</div>
                <span>Nigeria</span>
              </div>
              <div className="contact-detail">
                <div className="contact-detail-icon">🕐</div>
                <span>Mon–Fri: 9:00 AM – 5:00 PM (WAT)</span>
              </div>
            </div>

            <div className="contact-form reveal reveal-delay-1">
              <form onSubmit={onSubmit}>
                <div className="form-group">
                  <label htmlFor="name">Full Name</label>
                  <input
                    type="text"
                    id="name"
                    placeholder="Enter your full name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="email">Email Address</label>
                  <input
                    type="email"
                    id="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="phone">Phone Number</label>
                  <input
                    type="tel"
                    id="phone"
                    placeholder="0812 345 6789"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="subject">Subject</label>
                  <select id="subject" required value={subject} onChange={(e) => setSubject(e.target.value)}>
                    <option value="">Select a topic...</option>
                    {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="message">Message</label>
                  <textarea
                    id="message"
                    placeholder="Tell us how we can help..."
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn-submit" disabled={busy}>
                  {busy ? 'Sending…' : 'Send Message'}
                </button>
                <p
                  id="contactFormStatus"
                  role="status"
                  style={{ marginTop: 12, fontSize: '.84rem', color: status ? status.color : undefined }}
                >
                  {status ? status.text : ''}
                </p>
              </form>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
