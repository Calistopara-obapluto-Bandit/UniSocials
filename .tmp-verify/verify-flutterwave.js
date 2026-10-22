// Verification for the "Flutterwave is not configured" fix.
// Talks to the running preview over HTTP only; prints presence/shape of values,
// never any secret (the only value echoed is whether the public key looks real).
const http = require('http');

const PORT = process.env.PORT || 3000;
let failures = 0;

function check(name, ok, extra) {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
}

function get(path) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: path }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out, headers: res.headers }));
    }).on('error', (e) => resolve({ status: 0, body: String(e), headers: {} }));
  });
}

(async () => {
  // 1. The React entry document served for /checkout must carry /config.js
  //    BEFORE the deferred React bundle, so window.SITE_CONFIG exists by the
  //    time Checkout.jsx reads it.
  const page = await get('/checkout');
  check('/checkout returns 200', page.status === 200, 'status=' + page.status);
  const cfgIdx = page.body.indexOf('<script src="/config.js"></script>');
  const bundleMatch = page.body.match(/src="\/assets\/[^"]+\.js"/);
  const bundleIdx = bundleMatch ? page.body.indexOf(bundleMatch[0]) : -1;
  const bundlePath = bundleMatch ? bundleMatch[0].slice(5, -1) : null;
  check('/checkout includes <script src="/config.js">', cfgIdx !== -1);
  check('/checkout loads config.js before the React bundle', cfgIdx !== -1 && bundleIdx !== -1 && cfgIdx < bundleIdx,
    'config@' + cfgIdx + ' bundle@' + bundleIdx);
  check('/checkout is the React entry (bundle referenced)', bundleIdx !== -1);

  // Same for the legacy short link customers actually land on.
  const legacy = await get('/checkout.html');
  check('/checkout.html also serves config.js', legacy.body.indexOf('/config.js') !== -1);

  // 2. /config.js must publish a usable Flutterwave public key.
  const cfg = await get('/config.js');
  check('/config.js returns 200', cfg.status === 200, 'status=' + cfg.status);
  const sandbox = {};
  try {
    // Evaluate exactly like a browser would.
    new Function('window', cfg.body)(sandbox);
  } catch (e) {
    check('/config.js is executable JavaScript', false, e.message);
  }
  const sc = sandbox.SITE_CONFIG;
  check('window.SITE_CONFIG is defined', !!sc);
  const key = sc && typeof sc.FLUTTERWAVE_PUBLIC_KEY === 'string' ? sc.FLUTTERWAVE_PUBLIC_KEY.trim() : '';
  check('FLUTTERWAVE_PUBLIC_KEY is present and non-empty', key.length > 0, 'length=' + key.length);
  check('FLUTTERWAVE_PUBLIC_KEY is not the placeholder', !!key && !/x{8}/.test(key));
  check('FLUTTERWAVE_PUBLIC_KEY looks like a Flutterwave public key', /^FLWPUBK-/.test(key));
  check('REDIRECT_URL is published', !!(sc && sc.REDIRECT_URL));
  check('no secret leaks in /config.js', !/FLUTTERWAVE_SECRET_KEY|WEBHOOK_HASH|ADMIN_PASSWORD|RESEND_API_KEY/.test(cfg.body));

  // 3. The bundled checkout must contain the on-demand SDK loader, so a page
  //    that somehow missed the tag still recovers instead of alerting.
  check('React bundle path is discoverable from the document', !!bundlePath);
  const js = bundlePath ? await get(bundlePath) : { status: 0, body: '' };
  check('React bundle is served', js.status === 200, 'status=' + js.status);
  check('React bundle ships the on-demand Flutterwave loader', js.body.indexOf('checkout.flutterwave.com/v3.js') !== -1);
  check('React bundle references /config.js as a fallback', js.body.indexOf('/config.js') !== -1);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
