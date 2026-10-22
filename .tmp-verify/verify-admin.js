// Verification for the React admin port:
//  1. /admin serves the React SPA entry (not the legacy page) and /admin.html
//     redirects (302) to it — the .html address never loads its own document
//  2. the served entry points at a real, built asset
//  3. that asset contains the admin dashboard code
//  4. the legacy admin.html is gone (React owns the route)
//  5. every /api/... path the React admin calls is registered in server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
let failures = 0;
function check(name, ok, extra) {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
}

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: p }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out, location: res.headers.location }));
    }).on('error', reject);
  });
}

// Every API path the React admin dashboard calls (see app/pages/admin/*).
const ADMIN_APIS = [
  '/api/admin/orders',
  '/api/admin/orders/status',
  '/api/admin/orders/resend-email',
  '/api/admin/orders/seen',
  '/api/admin/unseen-count',
  '/api/admin/events',
  '/api/admin/events/archive',
  '/api/admin/events/notify',
  '/api/admin/events/commission-plan',
  '/api/admin/events/authorize-influencer',
  '/api/admin/universities',
  '/api/admin/subscribers',
  '/api/admin/subadmins',
  '/api/admin/influencers',
  '/api/admin/staff',
  '/api/admin/customers',
  '/api/admin/payouts',
  '/api/admin/coupons',
  '/api/admin/account-password',
  '/api/ticket/scan',
  '/api/universities'
];

(async () => {
  // ── 1. /admin serves the SPA; /admin.html redirects to it ──
  const alias = await get('/admin.html');
  check('/admin.html returns 302', alias.status === 302, 'status=' + alias.status);
  check('/admin.html redirects to /admin', alias.location === '/admin', 'Location=' + alias.location);

  for (const route of ['/admin']) {
    const page = await get(route);
    check(route + ' returns 200', page.status === 200, 'status=' + page.status);
    check(route + ' serves the React entry (id="root")', page.body.indexOf('id="root"') !== -1);
    check(route + ' does not serve the legacy admin markup',
      page.body.indexOf('admin-login-card') === -1);
    const asset = (page.body.match(/(?:src)="(\/assets\/[^"]+\.js)"/) || [])[1];
    check(route + ' references a hashed bundle', !!asset, asset || 'none');

    if (route === '/admin' && asset) {
      // ── 2./3. the bundle is served and contains the dashboard ──
      const bundle = await get(asset);
      check('bundle ' + asset + ' returns 200', bundle.status === 200, 'status=' + bundle.status);
      check('bundle contains the admin dashboard', bundle.body.indexOf('Admin Access') !== -1);
      check('bundle contains the payout panel', bundle.body.indexOf('Payout Requests') !== -1);
      check('bundle contains the check-in panel', bundle.body.indexOf('Gate Check-in') !== -1);
    }
  }

  // ── 4. the legacy file is gone — React owns the route ──
  check('legacy admin.html is removed from disk', !fs.existsSync(path.join(__dirname, '..', 'admin.html')));

  // ── 5. every admin API is registered in server.js ──
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const api of ADMIN_APIS) {
    const registered = serverSrc.indexOf("'" + api + "'") !== -1 ||
      serverSrc.indexOf('"' + api + '"') !== -1;
    check('server.js registers ' + api, registered);
  }

  // ── 6. SPA route sets cover the new page ──
  check("server.js REACT_SPA_ROUTES includes '/admin'",
    /REACT_SPA_ROUTES = new Set\(\[[^\]]*'\/admin'/.test(serverSrc));
  check('server.js maps /admin.html to the SPA route',
    serverSrc.indexOf("['/admin.html', '/admin']") !== -1);

  console.log(failures === 0 ? '\nALL ADMIN PORT CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
