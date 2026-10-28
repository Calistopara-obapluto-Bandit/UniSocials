// Debug: did the shared script load and run on a public page, and did anything
// throw? Prints shapes only (no secrets).
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

class LocalOnly extends ResourceLoader {
  fetch(url, options) {
    if (url.indexOf('http://localhost:3000') === 0) return super.fetch(url, options);
    return Promise.resolve(Buffer.from(''));
  }
}

const page = process.argv[2] || '/events.html';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('log', (...a) => errors.push('console.log: ' + a.join(' ')));

(async () => {
  const dom = await JSDOM.fromURL('http://localhost:3000' + page, {
    runScripts: 'dangerously',
    resources: new LocalOnly(),
    virtualConsole: vc,
    pretendToBeVisual: true,
    beforeParse(w) {
      w.IntersectionObserver = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
      w.matchMedia = w.matchMedia || function () { return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }; };
      w.scrollTo = function () {};
    }
  });
  const win = dom.window;
  await new Promise(r => setTimeout(r, 2500));
  const doc = win.document;
  const scripts = [...doc.querySelectorAll('script')].map(s => (s.src ? s.src : 'inline:' + s.textContent.length));
  console.log('page:            ' + page);
  console.log('title:           ' + doc.title);
  console.log('scripts:         ' + JSON.stringify(scripts));
  console.log('UNNAuth:         ' + typeof win.UNNAuth);
  console.log('nav-cta present: ' + !!doc.querySelector('.nav-cta'));
  console.log('iaf-link:        ' + !!doc.querySelector('.iaf-link'));
  console.log('inf-link:        ' + !!doc.querySelector('.inf-link'));
  console.log('root children:   ' + (doc.getElementById('root') ? doc.getElementById('root').children.length : 'no #root'));
  console.log('errors:          ' + JSON.stringify(errors.slice(0, 12), null, 1));
  win.close();
  process.exit(0);
})();
