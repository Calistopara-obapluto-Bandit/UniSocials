import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

/*
 * Referral / task-link landing handling (runs on every React route).
 *
 *   ?ref=CODE   — a referral link: remembered so checkout can pre-fill it and
 *                 the buyer can apply it with the Apply button.
 *   ?task=CODE  — a task referral link: counted as one more person on that
 *                 influencer's task link. Task links are counted, never applied.
 *
 * The two are mutually exclusive — a task session and a referral session are
 * never active at the same time in one browser. Landing with one clears the
 * other's stored code, and applying a referral at checkout clears the task
 * session (see Checkout.jsx).
 */
(function captureLandingCodes() {
  try {
    const params = new URLSearchParams(window.location.search);
    const taskCode = (params.get('task') || '').trim().toUpperCase();
    const refCode = (params.get('ref') || '').trim().toUpperCase();

    if (taskCode) {
      sessionStorage.setItem('unn_task_code', taskCode);
      localStorage.setItem('unn_task_code', taskCode);
      sessionStorage.removeItem('referralCode');
      localStorage.removeItem('unn_referral_code');

      // Count this person on the task link. The visitor id is an anonymous,
      // per-browser id — it is never any personal data.
      let visitorId = '';
      try { visitorId = localStorage.getItem('unn_visitor_id') || ''; } catch (e) {}
      if (!visitorId) {
        visitorId = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
        try { localStorage.setItem('unn_visitor_id', visitorId); } catch (e) {}
      }
      fetch('/api/task-referral/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: taskCode, visitorId: visitorId })
      }).catch(() => {});
    } else if (refCode) {
      sessionStorage.setItem('referralCode', refCode);
      localStorage.setItem('unn_referral_code', refCode);
      sessionStorage.removeItem('unn_task_code');
      localStorage.removeItem('unn_task_code');
    }
  } catch (e) { /* storage/fetch are best-effort */ }
})();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
