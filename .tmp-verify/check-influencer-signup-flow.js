// Runtime check of the create-account flow on the Influencer Portal:
// opens influencer.html in jsdom, clicks "Create your account", submits the
// form and asserts the signup request is sent and the session is stored.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('influencer.html', 'utf8');
const calls = [];

const dom = new JSDOM(html, {
  url: 'http://localhost/influencer.html',
  runScripts: 'dangerously',
  beforeParse(window) {
    window.fetch = function (url, opts) {
      calls.push({ url: String(url), opts: opts || {} });
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      let payload = { success: true, portals: [], requests: [], payouts: [], stats: {}, link: null, taskLink: null };
      if (String(url).indexOf('/api/influencer-signup') >= 0) {
        payload = {
          success: true,
          token: 'test-token-123',
          user: { id: 'INF-TEST', name: body.name || '', email: body.email || '', role: 'influencer' }
        };
      } else if (String(url).indexOf('/api/auth/me') >= 0) {
        payload = { success: true, user: { id: 'INF-TEST', name: 'Test Influencer', email: body.email || 'test.influencer.signup@example.com', role: 'influencer' } };
      } else if (String(url).indexOf('/api/auth/login') >= 0) {
        payload = { success: true, token: 'test-token-123', user: { id: 'INF-TEST', role: 'influencer' } };
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload), text: () => Promise.resolve(JSON.stringify(payload)) });
    };
    window.alert = function () {};
  }
});

const { window } = dom;
let doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('ok: ' + msg);
}

(async () => {
  await sleep(50);

  const loginPane = doc.getElementById('loginPane');
  const signupPane = doc.getElementById('signupPane');
  assert(loginPane && !loginPane.classList.contains('hidden'), 'sign-in pane visible by default');
  assert(signupPane && signupPane.classList.contains('hidden'), 'create-account pane hidden by default');

  // Click "Create your account".
  doc.getElementById('toSignupLink').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(20);
  assert(signupPane.classList.contains('hidden') === false, 'create-account pane opens');
  assert(loginPane.classList.contains('hidden') === true, 'sign-in pane closes');
  assert(doc.getElementById('authTitle').textContent === 'Create Account', 'card heading switches to Create Account');

  // Back to sign in.
  doc.getElementById('toSigninLink').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(20);
  assert(loginPane.classList.contains('hidden') === false, 'back link returns to sign in');

  // Deep link straight to sign-up.
  const dom2 = new JSDOM(html, {
    url: 'http://localhost/influencer.html#signup',
    runScripts: 'dangerously',
    beforeParse(w) { w.fetch = window.fetch; w.alert = function () {}; }
  });
  await sleep(50);
  const sp2 = dom2.window.document.getElementById('signupPane');
  assert(sp2 && !sp2.classList.contains('hidden'), 'influencer.html#signup opens the create-account form directly');

  // Submit the create-account form.
  dom2.window.document.getElementById('suName').value = 'Test Influencer';
  dom2.window.document.getElementById('suEmail').value = 'test.influencer.signup@example.com';
  dom2.window.document.getElementById('suPassword').value = 'Passw0rd!23';
  doc2 = dom2.window.document;
  doc2.getElementById('signupForm').dispatchEvent(new dom2.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(120);

  const signupCall = calls.find(c => c.url.indexOf('/api/influencer-signup') >= 0);
  assert(!!signupCall, 'POST /api/influencer-signup was sent');
  if (signupCall) {
    const sent = JSON.parse(signupCall.opts.body);
    assert(sent.name === 'Test Influencer' && sent.email === 'test.influencer.signup@example.com' && !!sent.password, 'signup payload carries name, email and password');
  }
  assert(dom2.window.localStorage.getItem('unn_influencer_token') === 'test-token-123', 'session token stored after signup');
  assert(!doc2.getElementById('loginError').classList.contains('show'), 'no error shown for a successful signup');

  console.log(process.exitCode ? 'RESULT: FAILED' : 'RESULT: PASSED');
  process.exit(process.exitCode ? 1 : 0);
})();
