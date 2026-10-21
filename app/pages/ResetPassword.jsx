import { useMemo, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import './auth.css';

/*
 * React port of reset-password.html — step 2 of account recovery. Same
 * two-request sequence the legacy page used: verify the OTP to obtain a reset
 * token, then exchange that token for the new password.
 */
export default function ResetPassword() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const prefill = () => {
    const fromUrl = (params.get('email') || '').trim();
    if (fromUrl) return fromUrl;
    try { return (sessionStorage.getItem('resetEmail') || '').trim(); } catch (e) { return ''; }
  };

  const [email, setEmail] = useState(prefill);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const mail = email.trim();
    const code = otp.trim();
    if (!mail || !code || !password) {
      setError('Please fill in all fields.');
      setSuccess('');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      setSuccess('');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail, otp: code }),
      });
      const data = await res.json();
      if (!data || !data.success || !data.resetToken) {
        throw new Error((data && data.error) || 'Invalid OTP');
      }
      const res2 = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail, resetToken: data.resetToken, password }),
      });
      const data2 = await res2.json();
      if (!data2 || !data2.success) {
        throw new Error((data2 && data2.error) || 'Could not reset password');
      }
      setSuccess('✅ ' + (data2.message || 'Password updated!'));
      try { sessionStorage.removeItem('resetEmail'); } catch (e) {}
      setTimeout(() => { window.location.href = '/login.html'; }, 1800);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
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
          <h1 className="section-title reveal reveal-delay-1">Create a new <em>password</em></h1>
          <p className="section-sub reveal reveal-delay-2">Enter the OTP we emailed you and choose a new password.</p>
        </div>
      </section>

      <section className="auth-section">
        <div className="container">
          <div className="auth-card reveal">
            <h2>🔐 Set New Password</h2>
            <p>Use the 6-digit code sent to your email, then pick a new password (at least 6 characters).</p>

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
              <div className="form-group">
                <label htmlFor="otp">OTP Code</label>
                <input
                  type="text"
                  id="otp"
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">New Password</label>
                <input
                  type="password"
                  id="password"
                  placeholder="8+ chars, letter, number & symbol"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-submit" id="submitBtn" disabled={busy}>
                {busy ? 'Verifying…' : 'Reset Password'}
              </button>
            </form>

            <div className="auth-alt">
              Didn&apos;t get a code? <a href="/forgot-password.html">Request a new OTP</a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
