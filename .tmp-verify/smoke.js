// Smoke test: every customer-facing route still resolves after the change.
const http = require('http');
const PORT = process.env.PORT || 3000;

const ROUTES = [
  '/', '/events', '/events.html', '/tickets.html', '/checkout', '/checkout.html',
  '/thank-you', '/thank-you.html', '/lookup', '/my-tickets', '/config.js',
  '/templatemo-622-clearwave.css',
];

// Asset file names are content-hashed by the Vite config, so read them out of
// the document we actually serve rather than hard-coding a name.
function assetsOf(body) {
  const out = [];
  const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
  let m;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

function raw(path) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: path }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve(out));
    }).on('error', () => resolve(''));
  });
}

function status(path) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', () => resolve(0));
  });
}

(async () => {
  const home = await status('/') === 200 ? await raw('/') : '';
  const routes = ROUTES.concat(assetsOf(home));
  let bad = 0;
  for (const r of routes) {
    const s = await status(r);
    const ok = s >= 200 && s < 400;
    if (!ok) bad++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + s + '  ' + r);
  }
  console.log(bad === 0 ? '\nALL ROUTES OK' : '\n' + bad + ' ROUTE(S) FAILED');
  process.exit(bad === 0 ? 0 : 1);
})();
