// Renders the real public pages from the running preview (scripts executed,
// only same-origin resources loaded) and asserts the Influencer Portal entry is
// actually visible in the nav / mobile menu after React or the shared script
// mounts.
const { JSDOM, ResourceLoader } = require('jsdom');

class LocalOnly extends ResourceLoader {
  fetch(url, options) {
    if (url.indexOf('http://localhost:3000') === 0) return super.fetch(url, options);
    return Promise.resolve(Buffer.from('')); // fonts, clarity, cdn — not needed
  }
}

const pages = process.argv.slice(2);
if (!pages.length) pages.push('/');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;

(async () => {
  for (const page of pages) {
    let dom;
    try {
      dom = await JSDOM.fromURL('http://localhost:3000' + page, {
        runScripts: 'dangerously',
        resources: new LocalOnly(),
        pretendToBeVisual: true,
        beforeParse(w) {
          // jsdom has no fetch; pages that call it during load must not throw
          // for reasons unrelated to the nav entry we are asserting.
          w.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: false }), text: () => Promise.resolve('{}') }); };
          w.IntersectionObserver = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
          w.matchMedia = w.matchMedia || function () { return { matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
          w.scrollTo = function () {};
        }
      });
    } catch (e) {
      console.log('FAIL: ' + page + ' could not be loaded: ' + e.message);
      failed = true;
      continue;
    }
    const win = dom.window;
    // Give React / the shared script time to mount.
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      if (win.document.querySelector('.nav .inf-link')) break;
    }
    const doc = win.document;
    const navLink = doc.querySelector('.nav .inf-link');
    const hasSiteNav = !!doc.querySelector('.nav .nav-cta');
    const mobileLink = doc.querySelector('.mobile-menu .mobile-inf-entry, .mobile-menu a[href="influencer-signup.html"]');
    const label = navLink ? navLink.textContent.replace(/\s+/g, ' ').trim() : '<absent>';
    const visible = navLink ? win.getComputedStyle(navLink).display !== 'none' : false;
    if (!hasSiteNav) {
      console.log('skip:  ' + page + '  (page has no site nav to carry the entry)');
      win.close();
      continue;
    }
    const ok = !!navLink && visible;
    console.log((ok ? 'ok:   ' : 'FAIL: ') + page + '  nav entry = ' + JSON.stringify(label) + '  mobile entry = ' + (mobileLink ? 'yes' : 'no'));
    if (!ok) failed = true;
    win.close();
  }
  console.log(failed ? 'RESULT: FAILED' : 'RESULT: PASSED');
  process.exit(failed ? 1 : 0);
})();
