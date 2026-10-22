// End-to-end proof of the fix under production's real condition: a server
// process started with a valid FLUTTERWAVE_PUBLIC_KEY in its environment (the
// workspace .env.local has none, so the shared preview can only serve the repo
// placeholder). Asserts the key travels env -> /config.js -> the document
// served for /checkout -> the guard in Checkout.jsx. Never prints the value.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3997;

// The isolated server resolves its data store from its own __dirname, i.e. the
// repo's ./data. Snapshot those files first so the check can prove it left the
// buyer/user data untouched, and restore them if boot rewrites anything.
function snapshotData() {
  const dir = path.join(process.cwd(), 'data');
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(dir, f);
    const buf = fs.readFileSync(p);
    out[f] = { hash: crypto.createHash('sha256').update(buf).digest('hex'), buf: buf };
  }
  return out;
}

function restoreData(snapshot) {
  const dir = path.join(process.cwd(), 'data');
  const changed = [];
  for (const [f, v] of Object.entries(snapshot)) {
    const p = path.join(dir, f);
    const now = fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : '<missing>';
    if (now !== v.hash) {
      fs.writeFileSync(p, v.buf);
      changed.push(f);
    }
  }
  return changed;
}
const FAKE_KEY = 'FLWPUBK-TESTKEY123456789012345678901234567-X';
let failures = 0;

function check(name, ok, extra) {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
}

function get(path) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port: PORT, path: path }, (res) => {
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
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('server never became ready')); } }, 20000);
    const attempt = () => {
      const r = http.get({ hostname: '127.0.0.1', port: PORT, path: '/config.js' }, (res) => {
        res.resume();
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      });
      r.on('error', () => { if (!settled) setTimeout(attempt, 300); });
    };
    setTimeout(attempt, 400);
  });
}

(async () => {
  const before = snapshotData();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      FLUTTERWAVE_PUBLIC_KEY: FAKE_KEY,
      DATABASE_URL: '',
      ADMIN_PASSWORD: 'verify-only-admin-pass',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  try {
    await waitForReady();

    const page = await get('/checkout');
    check('checkout page served', page.status === 200, 'status=' + page.status);
    const scripts = [];
    const re = /<script([^>]*)src="([^"]+)"([^>]*)>/g;
    let m;
    while ((m = re.exec(page.body))) scripts.push({ attrs: m[1] + m[3], src: m[2] });
    const cfgIdx = scripts.findIndex((s) => s.src === '/config.js');
    const bundleIdx = scripts.findIndex((s) => s.src.indexOf('/assets/') === 0);
    check('document for /checkout carries /config.js', cfgIdx !== -1);
    check('config.js runs before the React bundle', cfgIdx !== -1 && bundleIdx !== -1 && cfgIdx < bundleIdx,
      'config@' + cfgIdx + ' bundle@' + bundleIdx);
    check('config.js is a classic script', cfgIdx !== -1 && !/type\s*=\s*["']module["']/.test(scripts[cfgIdx].attrs));

    const cfg = await get('/config.js');
    check('/config.js served', cfg.status === 200);
    const sandbox = {};
    new Function('window', cfg.body)(sandbox);
    const served = (sandbox.SITE_CONFIG && sandbox.SITE_CONFIG.FLUTTERWAVE_PUBLIC_KEY) || '';
    check('env key reaches the browser config unchanged', served === FAKE_KEY);
    check('guard in Checkout.jsx sees a non-empty key', served.trim().length > 0);
    check('no secret leaked alongside it', !/FLUTTERWAVE_SECRET_KEY|WEBHOOK_HASH|ADMIN_PASSWORD/.test(cfg.body));
  } catch (e) {
    check('isolated server ran', false, e.message);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => {
      const t = setTimeout(r, 3000);
      child.once('close', () => { clearTimeout(t); r(); });
    });
    const restored = restoreData(before);
    check('runtime data left byte-identical', restored.length === 0,
      restored.length ? 'reverted: ' + restored.join(', ') : '');
    // Any .json the boot created that was not there before is test residue.
    const dir = path.join(process.cwd(), 'data');
    const created = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !(f in before));
    for (const f of created) fs.unlinkSync(path.join(dir, f));
    check('no stray data files left behind', created.length === 0,
      created.length ? 'removed: ' + created.join(', ') : '');
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
