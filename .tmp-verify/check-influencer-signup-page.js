// Runtime check of the standalone public page /influencer-signup.html:
// renders it from the running preview, submits the create-account form and
// asserts the signup request, stored session and success message.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

class LocalOnly extends ResourceLoader {
  fetch(url, options) {
    if (url.indexOf('http://localhost:3000') === 0) return super.fetch(url, options);
    return Promise.resolve(Buffer.from('')); // fonts, cdn — not needed
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
const check = (cond, msg) => { console.log((cond ? 'ok:   ' : 'FAIL: ') + msg); if (!cond) failed = true; };

(async () => {
  const calls = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); // jsdom "navigation not implemented" is expected here

  const dom = await JSDOM.fromURL('http://localhost:3000/influencer-signup.html', {
    runScripts: 'dangerously',
    resources: new LocalOnly(),
    virtualConsole: vc,
    pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = function (url, opts) {
        calls.push({ url: String(url), body: opts && opts.body ? opts.body : '' });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, token: 'pub-token-456', user: { id: 'INF-PUB', role: 'influencer' } })
        });
      };
      w.matchMedia = w.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
      w.IntersectionObserver = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
      w.scrollTo = function () {};
    }
  });

  const win = dom.window;
  const doc = win.document;
  await sleep(600);

  check(doc.title.indexOf('Create Influencer Account') === 0, 'page title is public and specific (' + JSON.stringify(doc.title) + ')');
  check(!!doc.getElementById('influencerSignupForm'), 'create-account form present');
  check(!!doc.getElementById('infName') && !!doc.getElementById('infEmail') && !!doc.getElementById('infPassword'), 'name, email and password fields present');
  const signIn = [...doc.querySelectorAll('a')].find(a => /Sign in to the Influencer Portal/.test(a.textContent));
  check(!!signIn && signIn.getAttribute('href') === 'influencer.html', 'page links to the portal sign-in');
  const iaEntry = [...doc.querySelectorAll('a')].find(a => /Influencer Admin/.test(a.textContent));
  check(!!iaEntry, 'page still offers the separate Influencer Admin path');
  check(!!doc.querySelector('.nav-cta .inf-link'), 'nav pill present on the page itself (static, not only injected)');

  // Client-side validation must reject a short password before any request.
  doc.getElementById('infName').value = 'Ada Nwosu';
  doc.getElementById('infEmail').value = 'ada@example.com';
  doc.getElementById('infPassword').value = 'short';
  doc.getElementById('influencerSignupForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(60);
  check(calls.length === 0 && /at least 8 characters/i.test(doc.getElementById('infStatus').textContent), 'short password rejected client-side with no request');

  // Valid submission.
  doc.getElementById('infPassword').value = 'Passw0rd!23';
  doc.getElementById('influencerSignupForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(200);

  const call = calls.find(c => c.url.indexOf('/api/influencer-signup') >= 0);
  check(!!call, 'POST /api/influencer-signup was sent');
  if (call) {
    const sent = JSON.parse(call.body);
    check(sent.name === 'Ada Nwosu' && sent.email === 'ada@example.com' && sent.password === 'Passw0rd!23', 'payload carries name, email and password');
  }
  check(win.localStorage.getItem('unn_influencer_token') === 'pub-token-456', 'session token stored for the portal');
  check(/Account created/.test(doc.getElementById('infStatus').textContent), 'success message shown');

  console.log(failed ? 'RESULT: FAILED' : 'RESULT: PASSED');
  process.exit(failed ? 1 : 0);
})();
