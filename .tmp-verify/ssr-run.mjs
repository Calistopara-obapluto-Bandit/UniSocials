// Runs the SSR bundle: renders the Admin shell logged-out and logged-in, and
// each panel individually, asserting the expected markup appears.
// React's SSR output inserts <!-- --> markers between adjacent text segments;
// a browser DOM drops them, so the same normalization is applied before
// substring assertions (the rendered text is identical).
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const norm = (html) => String(html || '').replace(/<!-- -->/g, '');

const here = path.dirname(fileURLToPath(import.meta.url));
// The SSR bundle lands in ssr-out/assets/ or flat in ssr-out/ depending on
// how vite was invoked — accept either so the suite never depends on flags.
function findEntry() {
  const ssrDir = path.join(here, 'ssr-out');
  const assetsDir = path.join(ssrDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const f = fs.readdirSync(assetsDir).find((x) => x.endsWith('.js'));
    if (f) return path.join(assetsDir, f);
  }
  const f = fs.readdirSync(ssrDir).find((x) => x.endsWith('.js') || x.endsWith('.mjs'));
  if (f) return path.join(ssrDir, f);
  throw new Error('no SSR bundle found under ' + ssrDir);
}
const entry = findEntry();

let failures = 0;
const check = (name, ok, extra) => {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
};

const storage = (token) => ({
  getItem: () => (token || ''),
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
});

const mod = await import(pathToFileURL(entry).href);

// ── 1. logged-out shell shows the login card ──
globalThis.sessionStorage = storage('');
let html = '';
try {
  html = mod.renderAdminShell();
  check('logged-out shell renders', html.length > 0, 'empty');
  check('logged-out shell shows the login card', html.includes('Admin Access'));
  check('login card keeps the sub-admin link', html.includes('subadmin.html'));
  check('login card has no public worker link', !html.includes('worker.html'));
} catch (e) {
  check('logged-out shell renders', false, String(e && e.stack ? e.stack.split('\n')[0] : e));
}

// ── 2. logged-in shell renders the dashboard with every panel ──
globalThis.sessionStorage = storage('test-token');
try {
  html = mod.renderAdminShell();
  check('logged-in shell renders', html.length > 0, 'empty');
  const expected = {
    'dashboard visible': 'admin-dash',
    'top bar with brand': 'Uni',
    'tab bar (12 tabs)': 'Payout Requests',
    'Overview panel': 'Orders Overview',
    'Check-in panel': 'Gate Check-in',
    'Events panel': 'Manage Events',
    'Universities panel': 'Universities Manager',
    'Subscribers panel': 'Subscribers (Event Notifications)',
    'Sub-Admins panel': 'Sub-Admins',
    'Influencers panel': 'Influencers',
    'Authorize Events panel': 'Authorize Events',
    'Staff panel': 'Dedicated Staff Accounts',
    'Customers panel': 'Customers',
    'Payouts panel': 'Payout Requests',
    'Coupons panel': 'Coupon Codes',
    'Workers panel': 'panel-workers',
    'University Sub-Admins panel': 'panel-university-subadmins',
    'notification badge': 'admin-notif',
    'logout control': 'Log Out'
  };
  for (const [name, needle] of Object.entries(expected)) {
    check('logged-in shell contains ' + name, html.includes(needle));
  }
  // With activeTab = 'overview' exactly one panel may carry `.active` —
  // the overview panel — and every other panel stays display:none.
  const activePanels = html.match(/admin-panel active/g) || [];
  check('shell marks the overview panel active',
    /class="admin-panel active" id="panel-overview"/.test(html),
    'panel-overview did not render with the active class');
  check('shell shows exactly one active panel', activePanels.length === 1,
    'found ' + activePanels.length + ' active panels');
} catch (e) {
  check('logged-in shell renders', false, String(e && e.stack ? e.stack.split('\n')[0] : e));
}

// ── 3. every panel renders on its own ──
try {
  const panelsRaw = mod.renderPanels();
  const panels = {};
  for (const k of Object.keys(panelsRaw)) panels[k] = norm(panelsRaw[k]);
  const markers = {
    overview: 'panel-overview',
    checkin: 'panel-checkin',
    events: 'panel-events',
    universities: 'panel-universities',
    subscribers: 'panel-subscribers',
    subadmins: 'panel-subadmins',
    influencers: 'panel-influencers',
    eventAuth: 'panel-event-authorizations',
    staff: 'panel-staff',
    customers: 'panel-customers',
    payouts: 'panel-payouts',
    coupons: 'panel-coupons',
    workers: 'panel-workers',
    universitySubadmins: 'panel-university-subadmins'
  };
  for (const [key, marker] of Object.entries(markers)) {
    const out = panels[key] || '';
    check('panel "' + key + '" renders with ' + marker, out.includes(marker), out.slice(0, 120));
    // admin.css: `.admin-panel { display: none }` and only
    // `.admin-panel.active` is shown, so an active tab's panel must emit the
    // class. Without it the tab looks like it "does nothing".
    check('panel "' + key + '" is visible when it is the active tab',
      out.includes('admin-panel active'));
  }
  // Data-driven render paths: order card, event card, payout card.
  check('overview renders an order card', panels.overview.includes('UNI-TEST-0001'));
  check('events renders the saved event', panels.events.includes('Dinner Night'));
  check('events offers the three split plans',
    panels.events.includes('20% Unisocials / 80% owner') &&
    panels.events.includes('15% Unisocials / 85% owner') &&
    panels.events.includes('10% Unisocials / 90% owner'));
  check('event-auths offers the three split plans',
    panels.eventAuth.includes('20% Unisocials / 80% owner') &&
    panels.eventAuth.includes('15% Unisocials / 85% owner') &&
    panels.eventAuth.includes('10% Unisocials / 90% owner'));
  check('event-auths renders an existing authorization row', panels.eventAuth.includes('Authorized to'));
  check('event-auths renders the commission section heading', panels.eventAuth.includes('Commission Split (20% / 25% / 15% / 13% / 10%)'));
  // Worker credentials are ISSUED by the server and emailed: the admin form
  // must not ask for a password and must say so instead.
  check('workers panel has no password field', !panels.workers.includes('workerPassword'));
  check('workers panel says the login is emailed to the worker', panels.workers.includes('emailed to the worker'));
  check('workers panel keeps the campus picker', panels.workers.includes('workerUniSearch'));
  check('university sub-admins panel renders its campus picker', panels.universitySubadmins.includes('usubUniSearch'));
} catch (e) {
  check('panels render', false, String(e && e.stack ? e.stack.split('\n')[0] : e));
}

// ── 4. the events page renders with the shared responsive nav ──
// The page used to ship its own copy of the header without the hamburger, so
// below 768px (where .nav-links/.nav-cta are display:none) there was no way to
// open the menu at all on a phone.
try {
  const ev = norm(mod.renderEventsPage());
  check('events page renders', ev.length > 0, 'empty');
  check('events page renders the hamburger menu', ev.includes('nav-hamburger'));
  check('events page renders the mobile menu', ev.includes('mobile-menu'));
  check('public nav carries no worker dashboard link', !ev.includes('worker.html'));
  check('events page marks itself as the active nav item',
    ev.includes('/events.html" class="active"') || ev.includes("/events.html' class='active'"));
  check('events page renders the campus filter', ev.includes('id="universityFilter"'));
  check('events page renders the events grid', ev.includes('events-grid'));
  check('events page renders the footer', ev.includes('footer-bottom'));
} catch (e) {
  check('events page renders', false, String(e && e.stack ? e.stack.split('\n')[0] : e));
}

console.log(failures === 0 ? '\nALL SSR RENDER CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
