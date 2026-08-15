/*
Unisocials — Build script
----------------------------
Minifies (obfuscates) the client-side JavaScript files using terser so the
source is harder for humans to read/inspect in the browser.

Run:  npm run build
Output: assets/min/  (gitignored)
*/
const fs = require('fs');
const path = require('path');

const terserPackage = path.join(__dirname, 'node_modules', 'terser', 'package.json');
let terser;
try {
  terser = require('terser');
} catch (e) {
  console.error('terser is not installed. Run:  npm install --save-dev terser');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, 'assets', 'min');
const targets = [
  { src: 'templatemo-622-clearwave.js', out: 'templatemo-622-clearwave.min.js' }
];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  for (const t of targets) {
    const srcPath = path.join(__dirname, t.src);
    if (!fs.existsSync(srcPath)) {
      console.warn('SKIP (not found): ' + t.src);
      continue;
    }
    const code = fs.readFileSync(srcPath, 'utf8');
    const result = await terser.minify(code, {
      compress: true,
      mangle: true,
      format: { comments: false }
    });
    if (result.error) {
      console.error('Minify error for ' + t.src + ':', result.error);
      continue;
    }
    const outPath = path.join(OUT_DIR, t.out);
    fs.writeFileSync(outPath, result.code, 'utf8');
    const origKB = (Buffer.byteLength(code) / 1024).toFixed(1);
    const minKB = (Buffer.byteLength(result.code) / 1024).toFixed(1);
    console.log('Minified ' + t.src + ': ' + origKB + 'KB -> ' + minKB + 'KB -> ' + outPath);
  }
  console.log('Build complete.');
})();
