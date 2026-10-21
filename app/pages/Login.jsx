import { useMemo, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { setAuth } from '../lib/api.js';
import './auth.css';

/*
 * React port of login.html.
 *
 * Same POST /api/auth/login contract, same localStorage session keys
 * (unn_auth_token / unn_auth_user via setAuth), and the same `?next=` redirect
 * the legacy page honoured — so a sign-in started from anywhere lands where the
 * visitor was headed instead of always dropping them on My Tickets.
 */
export default function Login() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const mail = email.trim();
    if (!mail || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail, password }),
      });
      const data = await res.json();
      if (data && data.success && data.token) {
        setAuth(data.token, data.user);
        const next = params.get('next') || '/my-tickets';
        window.location.href = next;
        return;
      }
      setError((data && data.error) || 'Incorrect email or password.');
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
          <h1 className="section-title reveal reveal-delay-1">Welcome <em>back</em></h1>
          <p className="section-sub reveal reveal-delay-2">Sign in to view your tickets and orders.</p>
        </div>
      </section>

      <section className="auth-section">
        <div className="container">
          <div className="auth-card reveal">
            <div className="auth-icon">🎟️</div>
            <h2>Sign In</h2>
            <p className="auth-sub">Use your email and password to access your Unisocials account.</p>
            <div className={'auth-error' + (error ? ' show' : '')} id="authError">{error}</div>
            <form onSubmit={onSubmit}>
              <div className="form-group">
                <label htmlFor="authEmail">Email Address</label>
                <input
                  type="email"
                  id="authEmail"
                  placeholder="you@university.edu.ng"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="authPassword">Password</label>
                <input
                  type="password"
                  id="authPassword"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div style={{ textAlign: 'right', margin: '-6px 0 14px' }}>
                <a href="/forgot-password.html" style={{ fontSize: '0.82rem', color: 'var(--accent)', textDecoration: 'underline' }}>
                  Forgot your password?
                </a>
              </div>
              <button type="submit" className="btn-submit" id="authBtn" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
            <p style={{ textAlign: 'center', fontSize: '.82rem', color: 'var(--text-3)', marginTop: 18 }}>
              Selling through a task link?{' '}
              <a href="/worker.html" style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}>
                Worker Dashboard
              </a>
              {' '}· Authorized for a campus?{' '}
              <a href="/university-subadmin.html" style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}>
                University Sub-Admin
              </a>
            </p>
            <p style={{ textAlign: 'center', fontSize: '.82rem', color: 'var(--text-3)', marginTop: 10 }}>
              Referring people to events?{' '}
              <a href="/influencer.html" style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}>
                Influencer Portal
              </a>
            </p>
            <p style={{ textAlign: 'center', fontSize: '.82rem', color: 'var(--text-3)', marginTop: 10 }}>
              Creating or running events?{' '}
              <a href="/influencer-admin-signup.html" style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}>
                Create or sign in as an Influencer Admin
              </a>
            </p>
            <p className="auth-switch">
              Don&apos;t have an account? <a href="/register.html">Create one</a>
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
