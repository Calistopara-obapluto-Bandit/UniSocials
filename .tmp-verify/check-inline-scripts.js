// Syntax-checks inline <script> blocks (those without src=) in edited HTML
// files, plus node --check style parsing of the shared site script. A page that
// ships with a broken inline script renders a dead dashboard, so this runs
// before any DOM-level verification.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node check-inline-scripts.js <file.html> [...]');
  process.exit(2);
}

let failures = 0;
for (const rel of files) {
  const full = path.join(ROOT, rel);
  const html = fs.readFileSync(full, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const code = m[2] || '';
    if (!code.trim()) continue;
    n++;
    try {
      new vm.Script(code, { filename: rel + '#inline-' + n });
      console.log('PASS  ' + rel + ' inline script #' + n);
    } catch (e) {
      failures++;
      console.log('FAIL  ' + rel + ' inline script #' + n + '  :: ' + e.message);
    }
  }
  if (n === 0) console.log('NOTE  ' + rel + ' has no inline scripts');
}
console.log(failures === 0 ? '\nALL INLINE SCRIPTS PARSE' : '\n' + failures + ' SCRIPT(S) FAILED TO PARSE');
process.exit(failures === 0 ? 0 : 1);
