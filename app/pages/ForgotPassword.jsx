import { useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import './auth.css';

/*
 * React port of forgot-password.html — step 1 of account recovery: request an
 * OTP for an email address, then hand off to the reset page with ?email=.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const mail = email.trim();
    if (!mail) {
      setError('Please enter your email address.');
      setSuccess('');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail }),
      });
      const data = await res.json();
      if (data && data.success) {
        setSuccess('✅ If that email is registered, a reset code has been sent. Check your inbox (and spam).');
        try { sessionStorage.setItem('resetEmail', mail); } catch (e) {}
        setTimeout(() => {
          window.location.href = '/reset-password.html?email=' + encodeURIComponent(mail);
        }, 1600);
        return;
      }
      setError((data && data.error) || 'Something went wrong. Please try again.');
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
          <div className="section-label reveal">Account Recovery</div>
          <h1 className="section-title reveal reveal-delay-1">Reset your <em>password</em></h1>
          <p className="section-sub reveal reveal-delay-2">
            Enter the email you registered with and we&apos;ll send you a one-time code to set a new password.
          </p>
        </div>
      </section>

      <section className="auth-section">
        <div className="container">
          <div className="auth-card reveal">
            <h2>🔑 Forgot Password</h2>
            <p>We&apos;ll email a 6-digit OTP to the address below. It expires in 10 minutes.</p>

            <div className={'auth-error' + (error ? ' show' : '')} id="authError">{error}</div>
            <div className={'auth-success' + (success ? ' show' : '')} id="authSuccess">{success}</div>

            <form onSubmit={onSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  placeholder="you@university.edu.ng"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-submit" id="submitBtn" disabled={busy}>
                {busy ? 'Sending…' : 'Send OTP'}
              </button>
            </form>

            <div className="auth-alt">
              Remember your password? <a href="/login.html">Back to Sign In</a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
