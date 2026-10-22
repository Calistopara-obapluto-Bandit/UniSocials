// Proves the fallback half of the migration: boot an isolated copy of the
// server in a temp directory that has the root .html pages, the assets and
// node_modules, but NO dist/ — so REACT_BUILT is false. The pages React has
// NOT taken over (the internal portals) must still serve their original
// markup, and nothing may redirect: with no build there is no canonical
// React route to redirect to. The React-owned routes have no legacy file
// anymore (they were deleted when React took them over), so they fall to the
// server's "waking up" page — never a 200, and never a redirect.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const PORT = 3996;
const ROOT = path.join('/tmp', 'unisocials-fallback-check');
let failures = 0;

function check(name, ok, extra) {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
}

function get(p) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port: PORT, path: p }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
}

function waitForReady() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('never became ready')); } }, 20000);
    const attempt = () => {
      const r = http.get({ hostname: '127.0.0.1', port: PORT, path: '/index.html' }, (res) => {
        res.resume();
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      });
      r.on('error', () => { if (!settled) setTimeout(attempt, 300); });
    };
    setTimeout(attempt, 400);
  });
}

function sh(cmd, args) { execFileSync(cmd, args, { stdio: 'ignore' }); }

(async () => {
  // Build the isolated tree: legacy pages + assets, deliberately no dist/.
  sh('rm', ['-rf', ROOT]);
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  for (const f of fs.readdirSync(process.cwd())) {
    if (/\.html$/.test(f) || /\.css$/.test(f) || f === 'server.js' || f === 'package.json') {
      fs.copyFileSync(path.join(process.cwd(), f), path.join(ROOT, f));
    }
  }
  for (const dir of ['assets', 'images']) {
    if (fs.existsSync(path.join(process.cwd(), dir))) sh('cp', ['-r', path.join(process.cwd(), dir), ROOT]);
  }
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(ROOT, 'node_modules'));
  check('isolated copy has no React build', !fs.existsSync(path.join(ROOT, 'dist')));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_PASSWORD: 'fallback-check-admin',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  try {
    await waitForReady();

    const PAGES = [
      { path: '/worker.html', marker: 'Worker Portal' },
      { path: '/subadmin.html', marker: 'Master Sub-Admin' },
      { path: '/university-subadmin.html', marker: 'University Sub-Admin' },
      { path: '/influencer.html', marker: 'Influencer Portal' },
      { path: '/influencer-signup.html', marker: 'Create Influencer Account' },
      { path: '/influencer-admin.html', marker: 'Influencer Admin' },
      { path: '/influencer-admin-signup.html', marker: 'Create Influencer Admin Account' },
      { path: '/checkin.html', marker: 'Check-in Staff' },
      { path: '/checkin-signup.html', marker: 'Check-in Staff Signup' },
    ];
    for (const p of PAGES) {
      const r = await get(p.path);
      // The React document is a bare <div id="root">; every legacy page ships
      // its own markup in the HTML instead.
      const legacy = !r.body.includes('id="root"');
      check('legacy page served at ' + p.path, r.status === 200 && legacy, 'status=' + r.status + ' legacy=' + legacy);
      check('  content intact at ' + p.path, r.body.includes(p.marker));
      check('  no redirect for ' + p.path, r.status === 302 || r.status === 301 ? false : true, 'status=' + r.status);
    }

    // The clean React URLs must NOT resolve in this state — they are new
    // routes that only exist once the build does.
    for (const p of ['/tickets', '/checkout', '/login', '/about', '/index.html', '/events.html', '/admin.html']) {
      const r = await get(p);
      // No build means no canonical route: a redirect here would point the
      // browser at a page that does not exist.
      check('clean URL ' + p + ' falls through without a build', r.status !== 200 && r.status !== 302, 'status=' + r.status);
    }
  } catch (e) {
    check('isolated server ran', false, e.message);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    sh('rm', ['-rf', ROOT]);
  }

  console.log(failures === 0 ? '\nALL FALLBACK CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
