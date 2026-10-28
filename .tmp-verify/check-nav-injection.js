// Runs the BUILT shared script (assets/min/templatemo-622-clearwave.min.js) in
// jsdom against a minimal page shaped like the site's nav, and asserts the
// Influencer Portal entry is injected exactly once into the nav and the menu.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const page = `<!DOCTYPE html><html><body>
<nav class="nav" id="mainNav"><div class="nav-inner">
  <a href="index.html" class="nav-logo">Uni<span>socials</span></a>
  <ul class="nav-links"><li><a href="index.html">Home</a></li></ul>
  <div class="nav-cta">
    <span class="nav-account-slot"></span>
    <a href="influencer-admin-signup.html" class="iaf-link" title="Create or sign in to an Influencer Admin account"><span aria-hidden="true">👤</span> Create or sign up</a>
    <a href="events.html" class="btn-primary">Get Tickets</a>
  </div>
  <button class="nav-hamburger" id="hamburger"></button>
</div></nav>
<div class="mobile-menu" id="mobileMenu">
  <a href="index.html">Home</a>
  <a href="influencer-admin-signup.html" class="mobile-iaf">✨ Create or sign in to an Influencer Admin account</a>
  <a href="events.html" class="mobile-cta btn-primary">Get Tickets</a>
</div>
<script src="config.js"></script>
</body></html>`;

const code = fs.readFileSync('assets/min/templatemo-622-clearwave.min.js', 'utf8');
const dom = new JSDOM(page, {
  url: 'http://localhost/index.html',
  runScripts: 'outside-only',
  beforeParse(w) {
    w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }), text: () => Promise.resolve('{}') });
    w.IntersectionObserver = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
    w.matchMedia = w.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
  }
});

let failed = false;
const check = (cond, msg) => { console.log((cond ? 'ok: ' : 'FAIL: ') + msg); if (!cond) failed = true; };

try {
  dom.window.eval(code);
} catch (e) {
  check(false, 'shared script executed without throwing: ' + e.message);
  process.exit(1);
}

const doc = dom.window.document;
// jsdom has already fired DOMContentLoaded by the time we eval the script, so
// run the init the page would run on load.
dom.window.UNNAuth.renderNavAccount();
const navLink = doc.querySelector('.nav-cta .inf-link');
check(!!navLink, 'nav gets the Influencer link');
check(navLink && navLink.getAttribute('href') === 'influencer-signup.html', 'nav link points at influencer-signup.html');
check(navLink && /Influencer/.test(navLink.textContent), 'nav link is labelled Influencer');
check(doc.querySelector('.nav-cta .iaf-link'), 'Influencer Admin link still present');
const order = [...doc.querySelectorAll('.nav-cta > a')].map(a => a.className);
check(order[0] === 'inf-link', 'Influencer link is placed before the Influencer Admin pill (' + order.join(' | ') + ')');
const mobileLink = doc.querySelector('.mobile-menu .mobile-inf-entry');
check(!!mobileLink && mobileLink.getAttribute('href') === 'influencer-signup.html', 'mobile menu gets the Influencer entry');

// Re-running renderNavAccount must not duplicate the links.
dom.window.UNNAuth.renderNavAccount();
check(doc.querySelectorAll('.nav-cta .inf-link').length === 1, 'no duplicate nav link after re-render');
check(doc.querySelectorAll('.mobile-menu .mobile-inf-entry').length === 1, 'no duplicate mobile link after re-render');

console.log(failed ? 'RESULT: FAILED' : 'RESULT: PASSED');
process.exit(failed ? 1 : 0);
