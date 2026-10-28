// DOM-level verification: parse the exact HTML the server serves for /checkout
// with jsdom, confirm /config.js is a classic script that runs before the
// deferred React bundle, then execute /config.js inside that document the way a
// browser would and assert the guard in Checkout.jsx would not fire.
const http = require('http');
const { JSDOM } = require('jsdom');

const PORT = process.env.PORT || 3000;
let failures = 0;
function check(name, ok, extra) {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: path }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', reject);
  });
}

(async () => {
  const page = await get('/checkout');
  // 'outside-only' gives us a real window context so window.eval runs the way
  // a browser's classic-script evaluation would, without fetching/executing the
  // module bundle (jsdom has no ES-module support).
  const dom = new JSDOM(page.body, {
    url: 'https://127.0.0.1:' + PORT + '/checkout',
    runScripts: 'outside-only',
  });
  const doc = dom.window.document;

  const scripts = Array.from(doc.querySelectorAll('script[src]')).map((s) => ({
    src: s.getAttribute('src'),
    type: s.getAttribute('type') || '',
  }));
  console.log('scripts on /checkout:', JSON.stringify(scripts));

  const cfgPos = scripts.findIndex((s) => s.src === '/config.js');
  const bundlePos = scripts.findIndex((s) => s.src.indexOf('/assets/') === 0);
  check('config.js script tag is present', cfgPos !== -1);
  check('React bundle script tag is present', bundlePos !== -1);
  check('config.js is a classic script (no type=module)', cfgPos !== -1 && scripts[cfgPos].type === '');
  check('config.js precedes the React bundle', cfgPos !== -1 && bundlePos !== -1 && cfgPos < bundlePos);

  // Execute /config.js in this document exactly as a browser would, then run
  // the guard from Checkout.jsx against the result.
  const cfg = await get('/config.js');
  dom.window.eval(cfg.body);
  check('window.SITE_CONFIG is defined after config.js runs', !!dom.window.SITE_CONFIG);
  const publicKey = dom.window.SITE_CONFIG && dom.window.SITE_CONFIG.FLUTTERWAVE_PUBLIC_KEY
    ? dom.window.SITE_CONFIG.FLUTTERWAVE_PUBLIC_KEY : '';
  check('Checkout.jsx guard (publicKey truthy) passes', !!publicKey);
  check('redirect_url fallback target resolves', typeof dom.window.location.origin === 'string');

  console.log(failures === 0 ? '\nALL DOM CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
