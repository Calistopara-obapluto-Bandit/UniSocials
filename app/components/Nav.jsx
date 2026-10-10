import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCachedUser, isLoggedIn } from '../lib/api.js';

// The nav links. "Tickets" is deliberately NOT resolved here: which page it
// points at depends on whether the visitor is signed in, and that can change
// without a reload (see resolveTicketsHref below).
const LINKS = [
  { href: '/index.html', label: 'Home' },
  { href: '/events.html', label: 'Events' },
  { href: null, label: 'Tickets', key: 'tickets' },
  { href: '/about.html', label: 'About' },
  { href: '/contact.html', label: 'Contact' }
];

// A signed-in buyer clicking "Tickets" wants the marketplace. A guest has no
// account and no dashboard, so the one thing they can actually do is find the
// ticket they already bought. Same rule as syncTicketNavLinks() in the legacy
// templatemo-622-clearwave.js.
export function ticketsHref() {
  return isLoggedIn() ? '/tickets.html' : '/lookup.html';
}

export default function Nav({ active }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const menuRef = useRef(null);

  // Read the session once on mount, and again whenever the tab regains focus so
  // signing in on another tab is reflected without a reload.
  useEffect(() => {
    const sync = () => setUser(getCachedUser());
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Close the mobile menu on Escape, and lock background scroll while it is open
  // so the page behind it does not scroll on touch devices.
  useEffect(() => {
    if (!menuOpen) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const ticketHref = ticketsHref();

  return (
    <>
      <div
        className={'mobile-menu' + (menuOpen ? ' open' : '')}
        id="mobileMenu"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        ref={menuRef}
      >
        {LINKS.map((l) => (
          <a key={l.label} href={l.href || ticketHref} onClick={() => setMenuOpen(false)}>
            {l.label}
          </a>
        ))}
        <a href="/influencer-admin-signup.html" className="mobile-iaf">
          ✨ Create or sign in to an Influencer Admin account
        </a>
        <a href="/events.html" className="mobile-cta btn-primary" onClick={() => setMenuOpen(false)}>
          Get Tickets
        </a>
      </div>

      <nav className="nav" id="mainNav" role="navigation" aria-label="Main navigation">
        <div className="nav-inner">
          <a href="/index.html" className="nav-logo">Uni<span>socials</span></a>
          <ul className="nav-links" role="list">
            {LINKS.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href || ticketHref}
                  className={active === l.label ? 'active' : ''}
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="nav-cta">
            <span className="nav-account-slot">
              {user ? (
                <a href="/my-tickets.html" className="nav-account-link" title="My Tickets">
                  🎟 {(user.name || 'Account').split(' ')[0]}
                </a>
              ) : (
                <a href="/login.html" className="nav-signin">Sign In</a>
              )}
            </span>
            <a href="/influencer-admin-signup.html" className="iaf-link"
               title="Create or sign in to an Influencer Admin account">
              <span aria-hidden="true">👤</span> Create or sign up
            </a>
            <a href="/events.html" className="btn-primary">Get Tickets</a>
          </div>
          <button
            className={'nav-hamburger' + (menuOpen ? ' open' : '')}
            id="hamburger"
            aria-label="Toggle menu"
            aria-expanded={menuOpen ? 'true' : 'false'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span></span><span></span><span></span>
          </button>
        </div>
      </nav>
    </>
  );
}