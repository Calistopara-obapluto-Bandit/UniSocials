// Read-only diagnosis of the live site: reports only the SHAPE of what
// production serves (never any value), so we can tell whether the reported
// error is caused by the missing config script, a missing public key, or both.
const https = require('https');

const HOST = process.argv[2] || 'unisocials.onrender.com';

function get(path) {
  return new Promise((resolve) => {
    const req = https.get({ hostname: HOST, path: path, timeout: 45000 }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out.slice(0, 200000) }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
}

(async () => {
  const page = await get('/checkout');
  const title = (page.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '<none>';
  console.log('GET /checkout                status=' + page.status + '  title=' + JSON.stringify(title));
  console.log('  loads /config.js (react form) ' + page.body.includes('<script src="/config.js">'));
  console.log('  loads config.js (legacy form) ' + /<script src="config\.js"><\/script>/.test(page.body));
  console.log('  flutterwave sdk tag          ' + page.body.includes('checkout.flutterwave.com/v3.js'));
  console.log('  react bundle                 ' + page.body.includes('/assets/index.js'));
  console.log('  waking/placeholder page      ' + page.body.includes('Waking up'));
  console.log('  legacy checkout markers      ' + (page.body.includes('placeOrderBtn') || page.body.includes('continueToCheckout')));
  console.log('  react markers                ' + page.body.includes('id="root"'));

  const cfg = await get('/config.js');
  const m = cfg.body.match(/"FLUTTERWAVE_PUBLIC_KEY"\s*:\s*"([^"]*)"/);
  const key = m ? m[1] : null;
  console.log('GET /config.js               status=' + cfg.status);
  if (key === null) console.log('  FLUTTERWAVE_PUBLIC_KEY      <absent from config>');
  else if (key.trim() === '') console.log('  FLUTTERWAVE_PUBLIC_KEY      <EMPTY STRING>');
  else if (/x{8}/i.test(key)) console.log('  FLUTTERWAVE_PUBLIC_KEY      <repo placeholder, not a real key>');
  else console.log('  FLUTTERWAVE_PUBLIC_KEY      set, len=' + key.trim().length + ', prefix=' + key.trim().slice(0, 8) + '…');
  console.log('  leaks a secret?             ' + /SECRET_KEY|WEBHOOK_HASH|ADMIN_PASSWORD/.test(cfg.body));
})();
