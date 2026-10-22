// Static check for the Influencer Portal signup work: the page must parse, its
// inline scripts must be syntactically valid, and every element the new
// create-account flow touches must exist in the markup.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('influencer.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

const requiredIds = [
  'loginPane', 'signupPane', 'signupForm', 'suName', 'suEmail', 'suPassword',
  'signupBtn', 'toSignupLink', 'toSigninLink', 'authTitle', 'authSubtitle',
  'loginError', 'loginForm', 'email', 'password', 'loginBtn', 'loginView', 'dashboard'
];

let failed = false;
for (const id of requiredIds) {
  if (!doc.getElementById(id)) {
    console.log('MISSING element #' + id);
    failed = true;
  }
}

// Syntax-check every inline script without executing it.
const scripts = [...doc.querySelectorAll('script')].filter(s => !s.src);
scripts.forEach((s, i) => {
  try {
    new Function(s.textContent);
  } catch (e) {
    console.log('SCRIPT SYNTAX ERROR in inline script #' + i + ': ' + e.message);
    failed = true;
  }
});

// The portal must offer both directions of the auth flow.
const text = doc.body.textContent;
if (!/Create your account/i.test(text)) { console.log('MISSING create-account link'); failed = true; }
if (!/Already have an account/i.test(text)) { console.log('MISSING back-to-signin link'); failed = true; }
if (!/Regular account\?/i.test(text)) { console.log('MISSING regular account link'); failed = true; }

console.log(failed ? 'FAILED' : 'OK: influencer portal markup + inline scripts valid (' + scripts.length + ' inline scripts checked)');
process.exit(failed ? 1 : 0);
