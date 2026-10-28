// Live end-to-end check of the worker creation flow on an isolated server
// instance (own data/ directory, so nothing real is read or written):
//   * unauthenticated create is rejected
//   * an authenticated create issues a SERVER-GENERATED login: the API
//     response never contains a password, an admin-supplied password is
//     ignored, and the stored credential is a scrypt hash
//   * the issued login is delivered by email (in this sandbox, with no email
//     provider configured, the response must say it could not be sent)
//   * a wrong password cannot sign in
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRV = path.join(__dirname, 'srv-worker');
const PORT = 3997;
const ADMIN_PW = 'TestAdmin!Pass1';

let failures = 0;
const check = (name, ok, extra) => {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
};

function request(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {},
        data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (e) { /* non-JSON is fine for some checks */ }
        resolve({ status: res.statusCode, json, raw: out });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── isolated instance ──
  fs.rmSync(SRV, { recursive: true, force: true });
  fs.mkdirSync(path.join(SRV, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(SRV, 'server.js'));
  fs.writeFileSync(path.join(SRV, 'data', 'users.json'), '[]', 'utf8');
  // The university catalogue so resolveUniversityAuthorizations() can work.
  try {
    fs.copyFileSync(path.join(ROOT, 'data', 'universities.json'), path.join(SRV, 'data', 'universities.json'));
  } catch (e) { console.log('NOTE  no universities.json to copy:', e.message); }

  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRV,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', NODE_ENV: 'development', ADMIN_PASSWORD: ADMIN_PW
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childLog = '';
  child.stdout.on('data', (c) => { childLog += c; });
  child.stderr.on('data', (c) => { childLog += c; });

  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const h = await request('GET', '/api/health');
        if (h.status === 200) { ready = true; break; }
      } catch (e) { /* not up yet */ }
      await wait(150);
    }
    check('isolated server is up', ready, childLog.slice(-300));
    if (!ready) throw new Error('server never became ready');

    const auth = { Authorization: 'Bearer ' + ADMIN_PW };
    const endpoint = '/api/admin/workers';

    // 1. unauthenticated → 401
    const anon = await request('POST', endpoint, { name: 'X', email: 'x@x.com', universities: ['University of Nigeria, Nsukka'] });
    check('unauthenticated create is rejected', anon.status === 401, String(anon.status) + ' ' + anon.raw.slice(0, 120));

    // 2. missing campus → 400
    const noCampus = await request('POST', endpoint, { name: 'No Campus', email: 'nocampus@x.com' }, auth);
    check('create without a campus is rejected', noCampus.status === 400, String(noCampus.status) + ' ' + noCampus.raw.slice(0, 160));

    // 3. admin-supplied password must be IGNORED (the login is issued server-side)
    const created = await request('POST', endpoint, {
      name: 'Wale Worker', email: 'wale.worker@unisocials.com', contactEmail: 'wale.inbox@example.com',
      password: 'AdminChosen1!', universities: ['University of Nigeria, Nsukka']
    }, auth);
    check('authenticated create succeeds', created.status === 200 && created.json && created.json.success === true, created.raw.slice(0, 240));
    const body = created.raw || '';
    check('response contains no password or hash',
      !/"password"\s*:/.test(body) && !/passwordHash/.test(body), body.slice(0, 240));
    check('response reports the email outcome', created.json && typeof created.json.credentialsEmailed === 'boolean',
      created.json ? String(created.json.credentialsEmailed) : 'no json');
    check('response explains the login was issued by email',
      created.json && /Login emailed|login email could not be sent/i.test(created.json.message || ''),
      created.json && created.json.message);
    // No BREVO key in this sandbox → the mail cannot go out, and the message
    // must be honest about it instead of pretending delivery.
    check('without an email provider the message says it could not be sent',
      created.json && created.json.credentialsEmailed === false && /could not be sent/.test(created.json.message || ''),
      created.json && created.json.message);

    // 4. stored record: worker role, scrypt hash, resolved campus, no plaintext
    const users = JSON.parse(fs.readFileSync(path.join(SRV, 'data', 'users.json'), 'utf8'));
    const w = users.find((u) => u && u.email === 'wale.worker@unisocials.com');
    check('worker stored with role worker', !!w && w.role === 'worker', w && w.role);
    check('stored credential is a hash, never plaintext',
      !!w && typeof w.passwordHash === 'string' && w.passwordHash.length >= 64 && w.password === undefined,
      w && String(w.passwordHash).slice(0, 20));
    check('stored record never keeps the admin-chosen password', !!w && w.password === undefined);
    check('campus resolved against the catalogue',
      !!w && Array.isArray(w.authorizedUniversities) && w.authorizedUniversities.length === 1 &&
      /University of Nigeria/i.test(w.authorizedUniversities[0].name || ''),
      w && JSON.stringify(w.authorizedUniversities).slice(0, 160));
    check('real inbox stored for the emailed login', !!w && w.contactEmail === 'wale.inbox@example.com', w && w.contactEmail);

    // 5. the admin-chosen password must NOT work — only the issued one could
    const badLogin = await request('POST', '/api/auth/login', { email: 'wale.worker@unisocials.com', password: 'AdminChosen1!' });
    check('admin-chosen password is not the credential', badLogin.status === 401 || (badLogin.json && !badLogin.json.success),
      String(badLogin.status) + ' ' + badLogin.raw.slice(0, 120));

    // 6. duplicate email still rejected
    const dup = await request('POST', endpoint, { name: 'Again', email: 'wale.worker@unisocials.com', universities: ['University of Nigeria, Nsukka'] }, auth);
    check('duplicate worker email rejected', dup.status === 409, String(dup.status));
  } catch (e) {
    check('worker create flow', false, String(e && e.stack ? e.stack.split('\n')[0] : e));
  } finally {
    child.kill('SIGTERM');
  }

  console.log(failures === 0 ? '\nALL WORKER CREATE CHECKS PASSED' : '\n' + failures + ' WORKER CREATE CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
