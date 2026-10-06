export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <a href="/index.html" className="nav-logo">
              Uni<span style={{ color: 'var(--accent-light)' }}>socials</span>
            </a>
            <p className="footer-brand-desc">
              The event ticket selling platform for universities across Nigeria.
            </p>
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
  );
}