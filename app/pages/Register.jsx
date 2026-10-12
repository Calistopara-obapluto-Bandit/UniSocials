import { useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { setAuth } from '../lib/api.js';
import './auth.css';

/*
 * React port of register.html — same POST /api/auth/register contract and the
 * same client-side email rule the legacy page applied before posting.
 */
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const mail = email.trim();
    if (!name.trim() || !mail || !phone.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    if (!EMAIL_RE.test(mail) || mail.length > 254) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: mail, phone: phone.trim(), password }),
      });
      const data = await res.json();
      if (data && data.success && data.token) {
        setAuth(data.token, data.user);
        window.location.href = '/my-tickets';
        return;
      }
      setError((data && data.error) || 'Could not create account. Please try again.');
    } catch (e) {
      setError('Cannot reach server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Nav />

      <section className="page-header">
        <div className="container">
          <div className="section-label reveal">Account</div>
          <h1 className="section-title reveal reveal-delay-1">Create your <em>account</em></h1>
          <p className="section-sub reveal reveal-delay-2">Sign up to keep all your tickets in one place.</p>
        </div>
      </section>

      <section className="auth-section">
        <div className="container">
          <div className="auth-card reveal">
            <div className="auth-icon">🎟️</div>
            <h2>Create Account</h2>
            <p className="auth-sub">Join Unisocials to view and manage all your tickets.</p>
            <div className={'auth-error' + (error ? ' show' : '')} id="authError">{error}</div>
            <form onSubmit={onSubmit}>
              <div className="form-group">
                <label htmlFor="regName">Full Name</label>
                <input
                  type="text"
                  id="regName"
                  placeholder="e.g. Chidi Okonkwo"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="regEmail">Email Address</label>
                <input
                  type="email"
                  id="regEmail"
                  placeholder="you@university.edu.ng"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="regPhone">Phone Number</label>
                <input
                  type="tel"
                  id="regPhone"
                  placeholder="0812 345 6789"
                  autoComplete="tel"
                  maxLength={25}
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="regPassword">Password</label>
                <input
                  type="password"
                  id="regPassword"
                  placeholder="8+ chars, letter, number & symbol"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-submit" id="regBtn" disabled={busy}>
                {busy ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
            <p className="auth-switch">
              Already have an account? <a href="/login.html">Sign in</a>
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
