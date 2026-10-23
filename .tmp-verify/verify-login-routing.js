// The public React login must not treat every account as a buyer.
//
// Chain under test:
//   1. server: publicUser() hands the login response the account's role
//   2. source: Login.jsx maps every staff role to its own portal AND the exact
//      session key that portal reads (cross-checked against the portal files,
//      so a renamed key can't silently break the routing)
//   3. source: the staff branch runs BEFORE the buyer setAuth fallback
//   4. bundle: the shipped dist assets carry the mapping (that's what /login serves)
//   5. live:   /checkin-signup.html wears the portal bar, not the public nav,
//              and the shared script injects nothing into it
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, ResourceLoader } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
let failures = 0;

function check(name, ok, extra) {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
}

function get(p) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: p }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// role -> [portal file, route, the exact session keys that portal reads]
const PORTALS = {
  worker:              ['worker.html', '/worker.html', ['unn_worker_token']],
  university_subadmin: ['university-subadmin.html', '/university-subadmin.html', ['unn_usub_token']],
  subadmin:            ['subadmin.html', '/subadmin.html', ['unn_subadmin_token', 'unn_subadmin_user']],
  checkin_staff:       ['checkin.html', '/checkin.html', ['unn_checkin_token', 'unn_checkin_user']],
  influencer:          ['influencer.html', '/influencer.html', ['unn_influencer_token']],
  influencer_admin:    ['influencer-admin.html', '/influencer-admin.html', ['unn_admin_token', 'unn_admin_user']],
};

// The exact role strings each portal gates its own login on. publicUser()
// normalizes the influencer-admin aliases to 'influencer_admin' and passes
// everything else through raw, so the mapping key must equal these strings.
// (influencer.html gates on the /api/influencer/me profile, not a role string —
// the session-key match above covers that portal.)
const GATES = {
  'worker.html':              "role !== 'worker'",
  'university-subadmin.html': "role !== 'university_subadmin'",
  'subadmin.html':            "role !== 'subadmin'",
  'checkin.html':             "role !== 'checkin_staff'",
  'influencer-admin.html':    "'influencer_admin'",
};

(async () => {
  // ── 1. the login response carries the account's role ──
  const serverSrc = read('server.js');
  const fnAt = serverSrc.indexOf('function publicUser');
  check('publicUser() exists', fnAt !== -1);
  const fnBody = fnAt === -1 ? '' : serverSrc.slice(fnAt, fnAt + 2400);
  check('login response includes the role',
    /[\s{,]role:/.test(fnBody) && fnBody.includes('user.role'), 'publicUser no longer returns role?');

  // ── 2. Login.jsx maps every staff role to its portal + the right key ──
  const loginSrc = read('app/pages/Login.jsx');
  check('STAFF_PORTALS table present', loginSrc.includes('const STAFF_PORTALS'));
  for (const [role, [file, route, keys]] of Object.entries(PORTALS)) {
    check('role mapped: ' + role, new RegExp('\\b' + role + ':\\s*\\{').test(loginSrc));
    check('  route for ' + role, loginSrc.includes("path: '" + route + "'"),
      'expected path ' + route);
    check('  portal file exists: ' + file, fs.existsSync(path.join(ROOT, file)));
    const portalSrc = fs.existsSync(path.join(ROOT, file)) ? read(file) : '';
    if (GATES[file]) {
      check('  ' + file + ' gates login on ' + role, portalSrc.includes(GATES[file]),
        'portal role gate drifted — update STAFF_PORTALS to the value publicUser() sends');
    }
    for (const k of keys) {
      check('  Login.jsx writes ' + k + ' for ' + role, loginSrc.includes("'" + k + "'"));
      // Cross-check against the portal itself: routing must use the key the
      // portal actually reads, or the portal boots logged-out.
      check('  ' + file + ' reads ' + k, portalSrc.includes(k), 'key drift?');
    }
  }

  // ── 3. the staff branch runs before the buyer fallback ──
  const staffAt = loginSrc.indexOf('STAFF_PORTALS[data.user');
  const saveAt = loginSrc.indexOf('portal.save(data.token');
  const buyerAt = loginSrc.indexOf('setAuth(data.token');
  check('staff branch is consulted', staffAt !== -1, 'staffAt=' + staffAt);
  check('staff token stored under the portal key', saveAt !== -1, 'saveAt=' + saveAt);
  check('staff branch runs BEFORE the buyer fallback',
    staffAt !== -1 && buyerAt !== -1 && staffAt < buyerAt,
    'staff=' + staffAt + ' buyer=' + buyerAt);
  check('buyer fallback intact (setAuth + /my-tickets default)',
    buyerAt !== -1 && loginSrc.includes("params.get('next') || '/my-tickets'"));

  // ── 4. the shipped bundle carries the mapping ──
  const assetsDir = path.join(ROOT, 'dist', 'assets');
  let bundle = '';
  if (fs.existsSync(assetsDir)) {
    for (const f of fs.readdirSync(assetsDir)) {
      if (f.endsWith('.js')) bundle += fs.readFileSync(path.join(assetsDir, f), 'utf8');
    }
  }
  check('dist build present', bundle.length > 0);
  const expect = [
    'unn_worker_token', 'unn_usub_token', 'unn_subadmin_token',
    'unn_checkin_token', 'unn_influencer_token', 'unn_admin_token',
    '/university-subadmin.html', '/influencer-admin.html',
  ];
  for (const s of expect) check('shipped bundle carries ' + s, bundle.includes(s));

  // ── 5a. live: checkin-signup wears the portal bar, not the public nav ──
  const page = await get('/checkin-signup.html');
  check('checkin-signup serves 200', page.status === 200, 'status=' + page.status);
  check('  title marker intact', page.body.includes('Check-in Staff Signup'));
  check('  portal bar opt-out present', page.body.includes('data-account-controls="own"'));
  check('  link back to the check-in portal', page.body.includes('← Check-in Portal'));
  for (const gone of ['nav-links', 'nav-cta', 'mobile-menu', 'id="hamburger"', 'Get Tickets']) {
    check('  public nav gone: ' + JSON.stringify(gone), !page.body.includes(gone));
  }

  // ── 5b. after the shared script runs: nothing gets injected, form works ──
  class LocalOnly extends ResourceLoader {
    fetch(url, options) {
      if (url.indexOf('http://localhost:' + PORT) === 0) return super.fetch(url, options);
      return Promise.resolve(Buffer.from('')); // fonts / cdn — not needed
    }
  }
  const dom = await JSDOM.fromURL('http://localhost:' + PORT + '/checkin-signup.html', {
    runScripts: 'dangerously',
    resources: new LocalOnly(),
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: false }), text: () => Promise.resolve('{}') });
      w.IntersectionObserver = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
      w.matchMedia = w.matchMedia || function () { return { matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
      w.scrollTo = () => {};
    },
  });
  // Poll: if injection were going to happen it would happen quickly.
  for (let i = 0; i < 20; i++) {
    await sleep(50);
    if (dom.window.document.querySelector('.nav-links a')) break;
  }
  const doc = dom.window.document;
  check('no injected public nav links', doc.querySelectorAll('.nav-links a').length === 0,
    'count=' + doc.querySelectorAll('.nav-links a').length);
  check('no injected Sign In cluster', !doc.querySelector('.nav-account-slot a'));
  check('no injected Get Tickets CTA', !doc.querySelector('.nav-cta .btn-primary'));
  check('no mobile menu', !doc.getElementById('mobileMenu'));
  check('  signup form still present', !!doc.getElementById('checkinStaffForm'));
  check('  link to check-in dashboard still present',
    !!doc.querySelector('.auth-switch a[href="checkin.html"]'));
  dom.window.close();

  console.log(failures === 0 ? '\nALL LOGIN-ROUTING CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
