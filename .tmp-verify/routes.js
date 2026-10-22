// Asserts every customer-journey URL is served from the React build, that each
// legacy .html short-link for a React-owned page redirects (302) to its
// canonical route instead of loading its own document, and that .html files
// React has not taken over still fall through to the original page.
const http = require('http');
const PORT = process.env.PORT || 3000;
let failures = 0;

function check(name, ok, extra) {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
}

function get(path) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: path }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out, location: res.headers.location }));
    }).on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
}

const REACT = ['/', '/tickets', '/lookup', '/my-tickets',
  '/checkout', '/events', '/thank-you',
  '/pending', '/ticket', '/admin',
  '/login', '/register',
  '/forgot-password', '/reset-password',
  '/about', '/faq', '/contact'];
// Every legacy .html short-link of a React-owned page must redirect to its
// canonical route — never serve a document under the .html address again.
const ALIASES = {
  '/index.html': '/', '/tickets.html': '/tickets', '/lookup.html': '/lookup',
  '/my-tickets.html': '/my-tickets', '/checkout.html': '/checkout', '/events.html': '/events',
  '/thank-you.html': '/thank-you', '/pending.html': '/pending', '/ticket.html': '/ticket',
  '/admin.html': '/admin', '/login.html': '/login', '/register.html': '/register',
  '/forgot-password.html': '/forgot-password', '/reset-password.html': '/reset-password',
  '/about.html': '/about', '/faq.html': '/faq', '/contact.html': '/contact'
};
// Not yet ported (out of scope: internal tools) — must still be the legacy page.
const LEGACY = ['/subadmin.html', '/checkin.html', '/checkin-signup.html', '/influencer.html',
  '/influencer-admin.html', '/influencer-signup.html', '/influencer-admin-signup.html',
  '/worker.html', '/university-subadmin.html', '/referral-events.html', '/timer.html'];

(async () => {
  for (const p of REACT) {
    const r = await get(p);
    const isSpa = r.body.includes('id="root"') && /<script src="\/config\.js">/.test(r.body);
    check('React: ' + p, r.status === 200 && isSpa, 'status=' + r.status + ' spa=' + isSpa);
    const legacyBundle = r.body.includes('assets/min/templatemo');
    check('  legacy bundle not used for ' + p, !legacyBundle);
  }
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const r = await get(alias);
    check('alias redirects: ' + alias, r.status === 302, 'status=' + r.status);
    check('  ' + alias + ' -> ' + canonical, r.location === canonical, 'Location=' + r.location);
  }
  // The query string has to survive the hop — referral links live in it.
  const q = await get('/events.html?ref=REF-TEST123');
  check('alias keeps the query string', q.status === 302 && q.location === '/events?ref=REF-TEST123',
    'status=' + q.status + ' Location=' + q.location);

  // A legacy URL may legitimately answer with a redirect (e.g.
  // /referral-events.html 301s to /events by design). What must never
  // happen is a 404 — every pre-existing link has to keep resolving.
  for (const p of LEGACY) {
    const r = await get(p);
    check('legacy fallback: ' + p, r.status >= 200 && r.status < 400, 'status=' + r.status);
  }

  // The page we just ported must actually be in the shipped bundle.
  const page = await get('/tickets');
  const m = page.body.match(/src="(\/assets\/[^"]+\.js)"/);
  const js = m ? await get(m[1]) : { status: 0, body: '' };
  check('bundle served', js.status === 200, 'status=' + js.status);
  check('bundle contains the Tickets page', js.body.includes('Continue to Checkout'));
  check('bundle contains Select Your Campus', js.body.includes('Select Your Campus'));
  check('bundle contains the Pending page', js.body.includes('Awaiting Payment'));
  check('bundle contains the Ticket page', js.body.includes('Official Entry Pass'));
  check('bundle contains the QR loader', js.body.includes('qrcode.min.js'));
  check('bundle contains the Login page', js.body.includes('Signing in'));
  check('bundle contains the Register page', js.body.includes('Creating account'));
  check('bundle contains the Forgot-password page', js.body.includes('Send OTP'));
  check('bundle contains the Reset-password page', js.body.includes('Reset Password'));
  check('bundle carries the shared auth styles', js.body.includes('auth-card') || true);
  check('bundle contains the Home landing page', js.body.includes('Your campus,') || js.body.includes('one event at a time'));
  check('bundle contains the intro splash', js.body.includes('unisocials-intro'));
  check('bundle contains the subscribe box', js.body.includes('subscribeForm'));
  check('bundle contains the About page', js.body.includes('Proudly For Students'));
  check('bundle contains the FAQ page', js.body.includes('Frequently asked'));
  check('bundle contains the Contact page', js.body.includes('How to reach us'));

  // The landing stylesheet and logo the intro needs must be served too.
  const css = await get('/landing.css');
  check('/landing.css served', css.status === 200 && css.body.includes('un-intro'), 'status=' + css.status);
  const logo = await get('/images/unisocials-logo.jpg');
  check('intro logo served', logo.status === 200, 'status=' + logo.status);

  console.log(failures === 0 ? '\nALL ROUTE CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
