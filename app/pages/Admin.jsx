import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminCtx } from './admin/adminContext.js';
import {
  adminFetch, clearAdminToken, clearAdminUser, getAdminToken, getAdminUser,
  setAdminToken, setUnauthorizedHandler
} from './admin/adminApi.js';
import OverviewPanel from './admin/OverviewPanel.jsx';
import CheckinPanel from './admin/CheckinPanel.jsx';
import EventsPanel from './admin/EventsPanel.jsx';
import UniversitiesPanel from './admin/UniversitiesPanel.jsx';
import SubscribersPanel from './admin/SubscribersPanel.jsx';
import SubAdminsPanel from './admin/SubAdminsPanel.jsx';
import UniversitySubAdminsPanel from './admin/UniversitySubAdminsPanel.jsx';
import WorkersPanel from './admin/WorkersPanel.jsx';
import InfluencersPanel from './admin/InfluencersPanel.jsx';
import EventAuthorizationsPanel from './admin/EventAuthorizationsPanel.jsx';
import StaffPanel from './admin/StaffPanel.jsx';
import CustomersPanel from './admin/CustomersPanel.jsx';
import PayoutsPanel from './admin/PayoutsPanel.jsx';
import CouponsPanel from './admin/CouponsPanel.jsx';
import './admin/admin.css';

const TABS = [
  { key: 'overview', icon: '📊', label: 'Overview' },
  { key: 'checkin', icon: '🎫', label: 'Check-in' },
  { key: 'events', icon: '🎤', label: 'Events' },
  { key: 'universities', icon: '🏛', label: 'Universities' },
  { key: 'subscribers', icon: '📧', label: 'Subscribers' },
  { key: 'subadmins', icon: '🔑', label: 'Master Sub-Admins' },
  { key: 'university-subadmins', icon: '🎓', label: 'University Sub-Admins' },
  { key: 'workers', icon: '💼', label: 'Workers' },
  { key: 'influencers', icon: '📣', label: 'Influencers' },
  { key: 'event-authorizations', icon: '🔐', label: 'Authorize Events' },
  { key: 'staff', icon: '👥', label: 'Staff Accounts' },
  { key: 'customers', icon: '👥', label: 'Customers' },
  { key: 'payouts', icon: '💰', label: 'Payout Requests' },
  { key: 'coupons', icon: '🏷️', label: 'Coupons' }
];

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) { /* audio is best-effort */ }
}

function sendBrowserNotification(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/images/tm-622-screen-01.jpg' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((p) => {
        if (p === 'granted') new Notification(title, { body, icon: '/images/tm-622-screen-01.jpg' });
      });
    }
  } catch (e) { /* notifications are best-effort */ }
}

// The staff-only dashboard. It authenticates with the admin password itself as
// a bearer token (sessionStorage key `unn_admin_token`), the same session the
// legacy admin.html uses, so signing in on either page signs you in on both.
export default function Admin() {
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [activeTab, setActiveTab] = useState('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [orders, setOrders] = useState([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [unseen, setUnseen] = useState(0);
  const [universities, setUniversities] = useState([]);
  const [events, setEvents] = useState([]);
  // Why the last events fetch failed ("" = fine). Without this the panel could
  // not tell "there are genuinely no events" apart from "the request failed",
  // and silently showed "No events added yet" after one bad response.
  const [eventsErr, setEventsErr] = useState('');
  const [toast, setToast] = useState(null); // { msg, error }
  const [pwd, setPwd] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const toastTimer = useRef(null);
  const lastUnseen = useRef(-1);

  const showToast = useCallback((msg, isError) => {
    setToast({ msg, error: !!isError });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Any 401 anywhere clears the session and returns to the login card.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthed(false);
      setLoginError('Your admin session expired or was rejected — please enter the admin password again.');
      setOrders([]);
      setUnseen(0);
      lastUnseen.current = -1;
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const data = await adminFetch('/api/admin/orders');
      if (data && data.__unauthorized) return;
      setOrders((data && data.orders) || []);
      if (data && data.unseenCount != null) {
        lastUnseen.current = data.unseenCount;
        setUnseen(data.unseenCount);
      }
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      showToast('Failed to load orders', true);
    }
  }, [showToast]);

  const loadUniversities = useCallback(async () => {
    try {
      const res = await fetch('/api/universities');
      const data = await res.json();
      setUniversities((data && data.success && data.universities) || []);
    } catch (e) { /* keep the last catalogue on a transient failure */ }
  }, []);

  const loadEvents = useCallback(async (attempt = 0) => {
    try {
      const data = await adminFetch('/api/admin/events', { credentials: 'same-origin' });
      if (data && data.__unauthorized) return;
      if (data && data.success && Array.isArray(data.events)) {
        setEvents(data.events);
        setEventsErr('');
        return;
      }
      // A 5xx/504 (cold start) or malformed body: retry once, then surface it.
      if (attempt < 1) {
        setTimeout(() => { loadEvents(attempt + 1); }, 900);
        return;
      }
      setEventsErr((data && data.error) || 'The server could not return the event list.');
    } catch (e) {
      if (attempt < 1) {
        setTimeout(() => { loadEvents(attempt + 1); }, 900);
        return;
      }
      setEventsErr((e && e.message) || 'Cannot reach the server.');
    }
  }, []);

  const pollUnseen = useCallback(async () => {
    try {
      const data = await adminFetch('/api/admin/unseen-count');
      if (data && data.__unauthorized) return;
      const count = (data && data.unseenCount) || 0;
      if (lastUnseen.current >= 0 && count > lastUnseen.current) {
        const delta = count - lastUnseen.current;
        showToast(delta + ' new order' + (delta > 1 ? 's' : '') + ' received! 🔔');
        playAlertSound();
        sendBrowserNotification('New order on Unisocials',
          delta + ' new order' + (delta > 1 ? 's' : '') + ' awaiting confirmation.');
        loadOrders();
      }
      lastUnseen.current = count;
      setUnseen(count);
    } catch (e) { /* polling is best-effort */ }
  }, [loadOrders, showToast]);

  const markOrdersSeen = useCallback(async () => {
    const unseenOrders = orders.filter((o) => o.notifyAdmin && !o.seenByAdmin);
    setUnseen(0);
    lastUnseen.current = 0;
    if (!unseenOrders.length) return;
    try {
      await adminFetch('/api/admin/orders/seen', {
        method: 'POST',
        body: JSON.stringify({ orderIds: unseenOrders.map((o) => o.orderId) })
      });
      loadOrders();
    } catch (e) { /* marking seen is not critical */ }
  }, [orders, loadOrders]);

  // Load everything the dashboard needs, mirroring legacy showLoggedIn(). Each
  // panel loads its own data on mount, so the shell only needs the shared
  // state: orders, universities and the event catalogue.
  const enterDashboard = useCallback(() => {
    setAuthed(true);
    setLoginError('');
    loadOrders();
    pollUnseen();
    loadUniversities();
    loadEvents();
  }, [loadOrders, pollUnseen, loadUniversities, loadEvents]);

  // Restore an existing session, then keep orders fresh while logged in.
  useEffect(() => {
    if (!getAdminToken()) return;
    enterDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authed) return;
    const ordersTimer = setInterval(loadOrders, 30000);
    const unseenTimer = setInterval(pollUnseen, 8000);
    return () => { clearInterval(ordersTimer); clearInterval(unseenTimer); };
  }, [authed, loadOrders, pollUnseen]);

  async function login(e) {
    e.preventDefault();
    if (getAdminToken()) { enterDashboard(); return; }

    const value = pwd.trim();
    if (!value) { setLoginError('Enter your admin password.'); return; }

    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/orders', {
        headers: { Authorization: 'Bearer ' + value }
      });
      if (res.status === 401) {
        setLoginError('That password was rejected by the server. If it keeps failing, the admin password configured for this site has changed.');
        return;
      }
      if (!res.ok) throw new Error('network');
      const data = await res.json();
      setAdminToken(value);
      lastUnseen.current = (data && data.unseenCount != null) ? data.unseenCount : -1;
      setUnseen((data && data.unseenCount) || 0);
      setOrders((data && data.orders) || []);
      enterDashboard();
    } catch (e2) {
      setLoginError('Cannot reach server. Check that the site is running.');
    } finally {
      setLoggingIn(false);
    }
  }

  function logout() {
    const token = getAdminToken();
    // Clear locally immediately: sign-out must work even when the network is slow.
    clearAdminToken();
    clearAdminUser();
    setAuthed(false);
    setPwd('');
    setOrders([]);
    setUnseen(0);
    lastUnseen.current = -1;
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        keepalive: true
      }).catch(() => {});
    }
  }

  function switchTab(name) {
    setActiveTab(name);
    setMenuOpen(false);
    // The Events list is only fetched when the dashboard is entered, so a
    // single failed request (cold start, timeout) left that tab empty until a
    // full page reload. Re-fetch every time the tab is opened.
    if (name === 'events') loadEvents();
  }

  const user = getAdminUser();
  const userName = (user && (user.name || user.fullName || user.email)) ? (user.name || user.fullName || user.email) : 'Main Admin';
  const activeMeta = TABS.find((t) => t.key === activeTab) || TABS[0];

  const ctx = useMemo(() => ({
    showToast, loadOrders, loadUniversities, loadEvents, switchTab,
    universities, events, eventsErr, activeTab
  }), [showToast, loadOrders, loadUniversities, loadEvents, universities, events, eventsErr, activeTab]);

  return (
    <AdminCtx.Provider value={ctx}>
      {/* ── ADMIN TOP BAR ── */}
      <div className="admin-topbar">
        <div className="admin-topbar-inner">
          <a href="/" className="nav-logo">Uni<span>socials</span> · Admin</a>
          <div className="admin-topbar-actions">
            {authed ? <span className="admin-user-name">{userName}</span> : null}
            {authed ? (
              <span className="admin-topbar-status">
                <span className="pulse" /> Connected
              </span>
            ) : null}
            {authed ? (
              <span
                className="admin-notif"
                style={unseen > 0 ? { display: 'inline-flex' } : { display: 'none' }}
                onClick={markOrdersSeen}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') markOrdersSeen(); }}
              >
                🔔 <span>{unseen}</span> new
              </span>
            ) : null}
            {authed ? <a href="/" className="admin-logout">← View Site</a> : null}
            {authed ? (
              <button type="button" className="admin-logout" onClick={logout}>Log Out</button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="admin-body">
        {!authed ? (
          /* ── LOGIN SCREEN ── */
          <div className="admin-login-wrap">
            <div className="admin-login-card">
              <div className="admin-login-icon">🔐</div>
              <h2>Admin Access</h2>
              <p>Enter your admin password to manage orders, check-in, events & more.</p>
              <div className={'admin-login-error' + (loginError ? ' show' : '')}>{loginError || 'Incorrect details. Please try again.'}</div>
              <form onSubmit={login}>
                <div className="form-group">
                  <label htmlFor="adminPassword">Admin Password</label>
                  <input
                    type="password" id="adminPassword" placeholder="Enter admin password"
                    autoComplete="current-password"
                    value={pwd} onChange={(e) => setPwd(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn-submit" disabled={loggingIn}>
                  {loggingIn ? 'Verifying…' : 'Login to Dashboard'}
                </button>
              </form>
              <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 18 }}>
                Are you a Master Sub-Admin?{' '}
                <a href="/subadmin.html" style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}>
                  Master Sub-Admin Dashboard
                </a>
                <span style={{ display: 'block', marginTop: 8, fontSize: '.82rem', color: 'var(--text-3)' }}>
                  Campus-scoped account?{' '}
                  <a href="/university-subadmin.html" style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 600 }}>
                    University Sub-Admin Dashboard
                  </a>

                </span>
              </p>
            </div>
          </div>
        ) : (
          /* ── DASHBOARD ── */
          <div className="admin-dash visible">
            {/* ── TOP TAB BAR ── */}
            <div className="admin-tabs">
              <div className="admin-tabs-inner">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    className={'admin-tab' + (activeTab === t.key ? ' active' : '')}
                    onClick={() => switchTab(t.key)}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={'admin-tab-menu' + (menuOpen ? ' open' : '')}>
              <button
                className="admin-tab-toggle" type="button"
                aria-haspopup="listbox" aria-expanded={menuOpen ? 'true' : 'false'}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              >
                <span className="admin-tab-toggle-icon" aria-hidden="true">{activeMeta.icon}</span>
                <span className="admin-tab-toggle-label">{activeMeta.label}</span>
                <span className="admin-tab-caret" aria-hidden="true">▾</span>
              </button>
              <div className="admin-tab-list" role="listbox" aria-label="Dashboard sections" hidden={!menuOpen}>
                {TABS.map((t) => (
                  <button
                    key={t.key} className="admin-tab-item" type="button" role="option"
                    aria-selected={activeTab === t.key ? 'true' : 'false'}
                    onClick={() => switchTab(t.key)}
                  >
                    <span className="admin-tab-toggle-icon" aria-hidden="true">{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="container">
              {/* Every panel stays mounted (so its filters and data survive a
                  tab switch) and is shown only while its own tab is active:
                  `.admin-panel` is display:none unless it carries `.active`. */}
              <OverviewPanel orders={orders} lastUpdated={lastUpdated} active={activeTab === 'overview'} />
              <CheckinPanel active={activeTab === 'checkin'} />
              <EventsPanel active={activeTab === 'events'} />
              <UniversitiesPanel active={activeTab === 'universities'} />
              <SubscribersPanel active={activeTab === 'subscribers'} />
              <SubAdminsPanel active={activeTab === 'subadmins'} />
              <UniversitySubAdminsPanel active={activeTab === 'university-subadmins'} />
              <WorkersPanel active={activeTab === 'workers'} />
              <InfluencersPanel active={activeTab === 'influencers'} />
              <EventAuthorizationsPanel active={activeTab === 'event-authorizations'} />
              <StaffPanel active={activeTab === 'staff'} />
              <CustomersPanel active={activeTab === 'customers'} />
              <PayoutsPanel active={activeTab === 'payouts'} />
              <CouponsPanel active={activeTab === 'coupons'} />
            </div>
          </div>
        )}
      </div>

      <div className={'admin-toast' + (toast ? ' show' : '') + (toast && toast.error ? ' error' : '')}>
        {toast ? toast.msg : ''}
      </div>
    </AdminCtx.Provider>
  );
}
