// Verification for the Worker salary system and University Sub-Admin scoping.
//
// Boots an ISOLATED server instance (own data dir via UNN_DATA_DIR, JSON
// storage, no DATABASE_URL, test-only admin password) on a spare port, then:
//   Worker flow
//     * admin creates a worker (validation + duplicate rejection)
//     * worker signs in, task link is created once and is stable
//     * a task order placed through /api/orders is attributed to the worker
//     * 150/month quota: 160 sales last month -> 1 block, 10 roll over
//     * adding sales this month keeps the rollover; blocks update at 150
//     * salary request pays out a completed block; second request hits the
//       3-week cooldown; rejected requests free their block again
//   University sub-admin flow
//     * admin creates one authorized for a specific university (validation)
//     * their overview/orders/customers/events include ONLY that university
//       (by order fields, by event fallback for older orders, and events by
//       catalogue identity) — the other campus's sales never leak
//     * referral link + scoped referral stats (out-of-scope referrals excluded)
//     * PATCH changes the authorized universities; other roles get 403
//   Master sub-admin oversight, track endpoint, admin worker list stats
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'verify-data-dir');
const PORT = 3461;
const BASE = 'http://127.0.0.1:' + PORT;
const ADMIN_PW = 'verify-admin-pw-9';

let failures = 0;
const check = (name, ok, extra) => {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
};

async function req(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}
    ),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

function writeJson(file, value) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(value), 'utf8');
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch (e) { return fallback; }
}

async function waitForServer(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/api/universities');
      if (r.ok) return true;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function isoInMonth(offsetMonths, day) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, day)).toISOString();
}

function makeOrder(overrides) {
  return Object.assign({
    orderId: 'ORD-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    status: 'verified',
    eventId: 'EVT-UNN',
    eventName: 'UNN Mega Party',
    eventDate: 'Saturday, 15 Nov 2026',
    eventVenue: 'UNN Main Auditorium',
    eventCategory: 'Party',
    qty: 1,
    amount: 5000,
    currency: 'NGN',
    paymentMethod: 'card',
    buyerName: 'Test Buyer',
    buyerEmail: 'buyer@example.com',
    buyerPhone: '08012345678',
    ticketTier: 'standard',
    universityId: 'uni-unn',
    universityName: 'University of Nigeria Nsukka',
    universitySlug: 'unn',
    referralCode: null,
    taskCode: null,
    couponCode: null,
    createdAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    ticketCodes: []
  }, overrides);
}

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PORT: String(PORT),
    ADMIN_PASSWORD: ADMIN_PW,
    UNN_DATA_DIR: DATA
    // no DATABASE_URL -> JSON storage in the isolated data dir
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', d => { bootLog += d; });
  child.stderr.on('data', d => { bootLog += d; });

  try {
    if (!(await waitForServer(20000))) {
      console.log('FATAL: server did not start. Log:\n' + bootLog);
      process.exit(1);
    }

    // ── Worker account lifecycle ──
    // Workers' passwords are issued by email (creation ignores any
    // admin-supplied one), so tests recover access through the real reset
    // flow: request an OTP (this isolated server has no Brevo key, so it
    // logs it), read it from the captured boot log, exchange it for a reset
    // token, set a known password, then sign in with it.
    async function resetLogin(email, password) {
      const forgot = await req('POST', '/api/auth/forgot', { body: { email } });
      if (forgot.status !== 200) return { error: 'forgot failed: ' + JSON.stringify(forgot.data) };
      await new Promise((r) => setTimeout(r, 400));
      const m = bootLog.match(new RegExp('OTP for ' + email.replace(/[.+?^${}()|[\]\\]/g, '\\$&') + '[^0-9]*(\\d{6})'));
      if (!m) return { error: 'OTP not found in the boot log' };
      const verified = await req('POST', '/api/auth/verify-otp', { body: { email, otp: m[1] } });
      const resetToken = verified.data && verified.data.resetToken;
      if (!resetToken) return { error: 'verify-otp failed: ' + JSON.stringify(verified.data) };
      const reset = await req('POST', '/api/auth/reset-password', { body: { email, resetToken, password } });
      if (reset.status !== 200) return { error: 'reset failed: ' + JSON.stringify(reset.data) };
      return req('POST', '/api/auth/login', { body: { email, password } });
    }
    const weak = await req('POST', '/api/admin/workers', { token: ADMIN_PW, body: { name: 'Weak', email: 'weak@example.com', password: '123' } });
    check('worker create rejects weak password', weak.status === 400, JSON.stringify(weak.data));

    const created = await req('POST', '/api/admin/workers', { token: ADMIN_PW, body: { name: 'Wale Worker', email: 'wale.worker@unisocials.com', password: 'WorkerPass123!', contactEmail: 'wale.inbox@gmail.com', universities: ['University of Ibadan'] } });
    check('admin creates worker authorized for a university', created.status === 200 && created.data && created.data.success && created.data.worker && created.data.worker.role === 'worker' &&
      (created.data.worker.authorizedUniversities || []).length === 1 && created.data.worker.authorizedUniversities[0].name === 'University of Ibadan', JSON.stringify(created.data));

    const noUni = await req('POST', '/api/admin/workers', { token: ADMIN_PW, body: { name: 'No Campus', email: 'nocampus.worker@unisocials.com', password: 'WorkerPass123!' } });
    check('worker creation requires at least one university', noUni.status === 400 && noUni.data.error.indexOf('university') !== -1, JSON.stringify(noUni.data));

    const dup = await req('POST', '/api/admin/workers', { token: ADMIN_PW, body: { name: 'Wale Again', email: 'wale.worker@unisocials.com', password: 'WorkerPass123!', universities: ['University of Ibadan'] } });
    check('duplicate worker email rejected', dup.status === 409, JSON.stringify(dup.data));

    const badAdmin = await req('POST', '/api/admin/workers', { token: 'not-the-admin', body: { name: 'X', email: 'x@example.com', password: 'WorkerPass123!' } });
    check('worker creation is master-admin only', badAdmin.status === 401, String(badAdmin.status));

    const WORKER_PW = 'WorkerPass123!';
    const login = await resetLogin('wale.worker@unisocials.com', WORKER_PW);
    const wtok = login.data && login.data.token;
    check('worker signs in (through the emailed-password reset flow)', !!wtok && login.data && login.data.user.role === 'worker', JSON.stringify(login.data || login.error));

    const dash1 = await req('GET', '/api/worker/dashboard', { token: wtok });
    const taskCode = dash1.data && dash1.data.task && dash1.data.task.code;
    check('dashboard creates task link', dash1.status === 200 && /^TASK-[A-F0-9]{8}$/.test(taskCode || ''), JSON.stringify(dash1.data && dash1.data.task));
    check('dashboard returns the account for the welcome header', !!(dash1.data.user && dash1.data.user.name === 'Wale Worker' && dash1.data.user.role === 'worker'), JSON.stringify(dash1.data && dash1.data.user));
    check('worker dashboard shows their authorized campus', !!(dash1.data.user && dash1.data.user.authorizedUniversities && dash1.data.user.authorizedUniversities[0] && dash1.data.user.authorizedUniversities[0].name === 'University of Ibadan'), JSON.stringify(dash1.data && dash1.data.user && dash1.data.user.authorizedUniversities));
    check('task link URL points at /events?task=', !!(dash1.data.task.url && dash1.data.task.url.indexOf('/events?task=') > -1), dash1.data.task.url);
    check('empty ledger starts at zero', dash1.data.ledger.blocksEarned === 0 && dash1.data.ledger.remainingToBlock === 150, JSON.stringify(dash1.data.ledger));

    const dash2 = await req('GET', '/api/worker/dashboard', { token: wtok });
    check('task link is stable across calls', dash2.data.task.code === taskCode);

    // Seed the catalogue and the sales history directly (isolated data dir).
    writeJson('universities.json', [
      { id: 'uni-unn', slug: 'unn', name: 'University of Nigeria Nsukka', location: 'Nsukka', state: 'Enugu', categories: ['General'] },
      { id: 'uni-ui', slug: 'ui', name: 'University of Ibadan', location: 'Ibadan', state: 'Oyo', categories: ['General'] }
    ]);
    writeJson('events.json', [
      { id: 'EVT-UNN', name: 'UNN Mega Party', universityId: 'uni-unn', universitySlug: 'unn', universityName: 'University of Nigeria Nsukka', date: 'Saturday, 15 Nov 2026', venue: 'UNN Main Auditorium', price: 5000, bonusPrice: 5000 },
      { id: 'EVT-UI', name: 'UI Rooftop Rave', universityId: 'uni-ui', universitySlug: 'ui', universityName: 'University of Ibadan', date: 'Sunday, 20 Dec 2026', venue: 'UI Arts Theatre', price: 3000, bonusPrice: 3000 },
      { id: 'EVT-FREE', name: 'UNN Free Concert', universityId: 'uni-unn', universitySlug: 'unn', universityName: 'University of Nigeria Nsukka', date: 'Monday, 1 Dec 2026', venue: 'UNN Open Field', price: 0 }
    ]);

    const seeded = [];
    // Last month: 160 counted sales -> one completed block, 10 roll over.
    for (let i = 0; i < 160; i++) seeded.push(makeOrder({ taskCode: taskCode, createdAt: isoInMonth(-1, 15), verifiedAt: isoInMonth(-1, 15) }));
    // This month so far: 5 counted sales.
    for (let i = 0; i < 5; i++) seeded.push(makeOrder({ taskCode: taskCode, createdAt: isoInMonth(0, 5), verifiedAt: isoInMonth(0, 5) }));
    // Never counted: pending, rejected, and someone else's task code.
    seeded.push(makeOrder({ status: 'pending', taskCode: taskCode, createdAt: isoInMonth(0, 6), verifiedAt: null }));
    seeded.push(makeOrder({ status: 'rejected', taskCode: taskCode, createdAt: isoInMonth(0, 6) }));
    seeded.push(makeOrder({ taskCode: 'TASK-FFFFFFFF', createdAt: isoInMonth(0, 6) }));
    // The other campus: 7 verified UI sales that must never leak into the
    // UNN sub-admin's dashboard.
    for (let i = 0; i < 7; i++) seeded.push(makeOrder({ eventId: 'EVT-UI', eventName: 'UI Rooftop Rave', universityId: 'uni-ui', universityName: 'University of Ibadan', universitySlug: 'ui', amount: 3000, createdAt: isoInMonth(0, 4), verifiedAt: isoInMonth(0, 4) }));
    // Older UNN orders with no university fields on the order itself: they
    // must still be scoped in through their event.
    for (let i = 0; i < 3; i++) seeded.push(makeOrder({ universityId: '', universityName: '', universitySlug: '', amount: 4000, createdAt: isoInMonth(-13, 8), verifiedAt: isoInMonth(-13, 8) }));
    writeJson('orders.json', seeded);

    const dash3 = await req('GET', '/api/worker/dashboard', { token: wtok });
    const L = dash3.data.ledger;
    check('last month completed exactly one block', L.blocksEarned === 1 && L.totalSalary === 25000, JSON.stringify(L));
    check('excess above 150 rolled into this month', L.carryIn === 10 && L.monthSales === 5 && L.credited === 15, JSON.stringify({ carryIn: L.carryIn, monthSales: L.monthSales, credited: L.credited }));
    check('pending/rejected/foreign orders are not counted', L.totalSales === 165, String(L.totalSales));
    check('salary available equals one completed block', dash3.data.salary.availableAmount === 25000 && dash3.data.salary.canRequest === true, JSON.stringify(dash3.data.salary));

    // ── Salary requests ──
    const noBank = await req('POST', '/api/worker/salary-requests', { token: wtok, body: { amount: 25000, bank: {} } });
    check('salary request requires bank details', noBank.status === 400, JSON.stringify(noBank.data));

    const req1 = await req('POST', '/api/worker/salary-requests', { token: wtok, body: { bank: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'wale worker' } } });
    check('salary request succeeds for a completed block', req1.status === 200 && req1.data.payout && req1.data.payout.amount === 25000 && req1.data.payout.status === 'pending', JSON.stringify(req1.data));
    check('salary payout carries the worker role + salary method', req1.data.payout.requesterRole === 'worker' && req1.data.payout.payoutMethod === 'salary', JSON.stringify({ r: req1.data.payout.requesterRole, m: req1.data.payout.payoutMethod }));
    // Campus model: the university sub-admin handles requests for their
    // campus; the response must say so and flag the sub-admin notification.
    check('salary response routes handling to the campus sub-admin', /campus sub-admin has been notified/i.test(req1.data.message || ''), req1.data.message);
    check('salary response exposes the sub-admin notification flag', 'subadminEmailSent' in req1.data, JSON.stringify(Object.keys(req1.data)));
    check('no campus sub-admin email errors were logged', bootLog.indexOf('Campus sub-admin payout email error') === -1, bootLog.slice(-200));

    const req2 = await req('POST', '/api/worker/salary-requests', { token: wtok, body: { bank: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'WALE WORKER' } } });
    check('second request inside 3 weeks hits the cooldown', req2.status === 409 && !!(req2.data && req2.data.nextRequestAt), JSON.stringify(req2.data));

    const dash4 = await req('GET', '/api/worker/dashboard', { token: wtok });
    check('committed block is no longer available', dash4.data.salary.availableAmount === 0 && dash4.data.salary.canRequest === false && dash4.data.requests.length === 1, JSON.stringify(dash4.data.salary));

    // ── Checkout attribution: a task session order credits the worker ──
    // A free-event order is verified in the same request, so this exercises the
    // whole path: task code attributed -> instantly verified -> counted sale.
    const orderRes = await req('POST', '/api/orders', {
      body: {
        orderId: 'ORD-TASKATTR-1', eventId: 'EVT-FREE', eventName: 'UNN Free Concert',
        eventDate: 'Monday, 1 Dec 2026', eventVenue: 'UNN Open Field', eventCategory: 'Concert',
        qty: 1, amount: 0, buyerName: 'Free Buyer', buyerEmail: 'free.buyer@example.com',
        buyerPhone: '08099999999', ticketTier: 'standard',
        universityId: 'uni-unn', universityName: 'University of Nigeria Nsukka', universitySlug: 'unn',
        paymentMethod: 'card', taskCode: taskCode
      }
    });
    check('checkout attributes the task code to the worker', orderRes.status === 200 && orderRes.data.order && orderRes.data.order.taskCode === taskCode && orderRes.data.order.status === 'verified', JSON.stringify(orderRes.data && { status: orderRes.status, taskCode: orderRes.data.order && orderRes.data.order.taskCode, orderStatus: orderRes.data.order && orderRes.data.order.status, error: orderRes.data.error }));

    // ── Push this month past the quota: second block, new rollover ──
    const ordersNow = readJson('orders.json', []);
    for (let i = 0; i < 144; i++) ordersNow.push(makeOrder({ taskCode: taskCode, createdAt: isoInMonth(0, 10), verifiedAt: isoInMonth(0, 10) }));
    writeJson('orders.json', ordersNow);

    const dash5 = await req('GET', '/api/worker/dashboard', { token: wtok });
    const L5 = dash5.data.ledger;
    check('second quota block completes this month', L5.blocksEarned === 2 && L5.totalSalary === 50000, JSON.stringify(L5));
    check('new rollover carries into next month', L5.carryOut === 10, String(L5.carryOut));
    check('one block still available but cooldown active', dash5.data.salary.availableAmount === 25000 && dash5.data.salary.canRequest === false, JSON.stringify(dash5.data.salary));

    // A rejected request frees its block (and the cooldown) again.
    const payoutsFile = readJson('payouts.json', []);
    payoutsFile.forEach(p => { if (p.status === 'pending') { p.status = 'rejected'; p.adminNote = 'test'; } });
    writeJson('payouts.json', payoutsFile);

    const req3 = await req('POST', '/api/worker/salary-requests', { token: wtok, body: { bank: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'WALE WORKER' } } });
    check('after rejection both blocks are requestable again', req3.status === 200 && req3.data.payout.amount === 50000, JSON.stringify(req3.data && { status: req3.status, amount: req3.data.payout && req3.data.payout.amount, error: req3.data.error }));

    // ── Admin worker list carries the ledger ──
    const adminWorkers = await req('GET', '/api/admin/workers', { token: ADMIN_PW });
    const row = (adminWorkers.data.workers || []).find(w => w.email === 'wale.worker@unisocials.com');
    check('admin list shows worker ledger + salary status', !!row && row.ledger.blocksEarned === 2 && row.taskCode === taskCode && row.salary.openAmount === 50000, JSON.stringify(row && { blocks: row.ledger.blocksEarned, code: row.taskCode, open: row.salary.openAmount }));

    // ── Task tracking still works for a worker-owned link ──
    const track = await req('POST', '/api/task-referral/track', { body: { code: taskCode, visitorId: 'visitor-abc-123' } });
    check('track endpoint counts worker task links', track.status === 200 && track.data.people === 1, JSON.stringify(track.data));

    // ── University sub-admin ──
    const usubBad = await req('POST', '/api/admin/university-subadmins', { token: ADMIN_PW, body: { name: 'No Campus', email: 'nocampus@unisocials.com', password: 'SubPass123!', universities: [] } });
    check('creation requires at least one university', usubBad.status === 400, JSON.stringify(usubBad.data));
    const usubUnknown = await req('POST', '/api/admin/university-subadmins', { token: ADMIN_PW, body: { name: 'Bad Campus', email: 'badcampus@unisocials.com', password: 'SubPass123!', universities: ['Hogwarts'] } });
    check('unknown universities are rejected', usubUnknown.status === 400, JSON.stringify(usubUnknown.data));

    const usubCreated = await req('POST', '/api/admin/university-subadmins', { token: ADMIN_PW, body: { name: 'Uchenna Sub', email: 'uchenna.sub@unisocials.com', password: 'SubPass123!', universities: ['University of Nigeria Nsukka'] } });
    check('admin creates a university sub-admin', usubCreated.status === 200 && usubCreated.data.subadmin && usubCreated.data.subadmin.role === 'university_subadmin' && usubCreated.data.subadmin.authorizedUniversities.length === 1, JSON.stringify(usubCreated.data));

    const usubLogin = await req('POST', '/api/auth/login', { body: { email: 'uchenna.sub@unisocials.com', password: 'SubPass123!' } });
    const utok = usubLogin.data && usubLogin.data.token;
    check('university sub-admin signs in with authorized universities', !!utok && usubLogin.data.user.role === 'university_subadmin' && usubLogin.data.user.authorizedUniversities.length === 1, JSON.stringify(usubLogin.data && usubLogin.data.user));

    const usubOverview = await req('GET', '/api/university-subadmin/overview', { token: utok });
    const S = usubOverview.data && usubOverview.data.sales;
    const allOrders = readJson('orders.json', []);
    const unnVerified = allOrders.filter(o => o.status === 'verified' && (o.universityName === 'University of Nigeria Nsukka' || (o.eventId === 'EVT-UNN' && !o.universityName))).length;
    check('overview counts only its own campus', !!S && S.verifiedOrders === unnVerified && S.totalRevenue > 0, JSON.stringify(S && { verified: S.verifiedOrders, expected: unnVerified }));
    check('overview returns the account for the welcome header', !!(usubOverview.data.user && usubOverview.data.user.name === 'Uchenna Sub' && usubOverview.data.user.role === 'university_subadmin'), JSON.stringify(usubOverview.data && usubOverview.data.user));
    check('other campus sales are excluded', !!S && S.events.length === 2 && S.events.every(e => e.universityName === 'University of Nigeria Nsukka'), JSON.stringify(S && S.events));

    const usubOrders = await req('GET', '/api/university-subadmin/orders', { token: utok });
    check('scoped orders exclude the other campus', usubOrders.data.orders.every(o => o.universityName !== 'University of Ibadan') && usubOrders.data.orders.length === unnVerified + 2, String(usubOrders.data.orders.length));

    const usubCustomers = await req('GET', '/api/university-subadmin/customers', { token: utok });
    check('scoped customers derive from scoped orders', usubCustomers.data.customers.length > 0 && usubCustomers.data.customers.every(c => c.universityName !== 'University of Ibadan'), JSON.stringify(usubCustomers.data.customers.map(c => c.universityName)));

    const usubEvents = await req('GET', '/api/university-subadmin/events', { token: utok });
    check('scoped events list only authorized campuses', usubEvents.data.events.length === 2 && usubEvents.data.events.every(e => ['EVT-UNN', 'EVT-FREE'].includes(e.id)), JSON.stringify(usubEvents.data.events.map(e => e.id)));

    const usubLink = await req('GET', '/api/university-subadmin/referral-link', { token: utok });
    const usubCode = usubLink.data && usubLink.data.link && usubLink.data.link.code;
    check('referral link is created once', /^REF-/.test(usubCode || ''), JSON.stringify(usubLink.data && usubLink.data.link && usubLink.data.link.code));
    check('referral link URL is canonical', !!(usubLink.data.link.referralUrl && usubLink.data.link.referralUrl.indexOf('ref=') > -1), usubLink.data.link.referralUrl);

    // A referred sale on their campus counts; one on the other campus does not.
    const ordersWithRefs = readJson('orders.json', []);
    ordersWithRefs.push(makeOrder({ referralCode: usubCode, amount: 5000, createdAt: isoInMonth(0, 7), verifiedAt: isoInMonth(0, 7) }));
    ordersWithRefs.push(makeOrder({ eventId: 'EVT-UI', eventName: 'UI Rooftop Rave', universityId: 'uni-ui', universityName: 'University of Ibadan', universitySlug: 'ui', referralCode: usubCode, amount: 3000, createdAt: isoInMonth(0, 7), verifiedAt: isoInMonth(0, 7) }));
    writeJson('orders.json', ordersWithRefs);
    const usubStats = await req('GET', '/api/university-subadmin/referral-stats', { token: utok });
    check('referral stats count only scoped referred sales', usubStats.data.stats.totalOrders === 1 && usubStats.data.stats.totalRevenue === 5000, JSON.stringify(usubStats.data.stats));

    // Switching campuses changes what is visible.
    const patch = await req('PATCH', '/api/admin/university-subadmins', { token: ADMIN_PW, body: { email: 'uchenna.sub@unisocials.com', universities: ['uni-ui'] } });
    check('admin can change authorized universities', patch.status === 200 && patch.data.subadmin.authorizedUniversities[0].name === 'University of Ibadan', JSON.stringify(patch.data));
    const usubOverview2 = await req('GET', '/api/university-subadmin/overview', { token: utok });
    check('dashboard follows the new authorization', usubOverview2.data.sales.verifiedOrders === 8 && usubOverview2.data.sales.events[0].eventName === 'UI Rooftop Rave', JSON.stringify(usubOverview2.data.sales));

    // ── 25% / 75% commission plan ──
    const badPlan = await req('POST', '/api/admin/events/commission-plan', { token: ADMIN_PW, body: { eventId: 'EVT-UI', plan: 'nope' } });
    check('unknown plan rejected, error lists plan_25', badPlan.status === 400 && badPlan.data.error.indexOf('plan_25') !== -1, JSON.stringify(badPlan.data));

    // The university sub-admin may authorise the sales % for their OWN campus.
    const planByUsub = await req('POST', '/api/admin/events/commission-plan', { token: utok, body: { eventId: 'EVT-UI', plan: 'plan_25' } });
    check('usub authorises the sales % for their campus', planByUsub.status === 200 && planByUsub.data.event.commissionPlan === 'plan_25' &&
      planByUsub.data.event.commissionPlanChangedBy === 'university_subadmin', JSON.stringify(planByUsub.data));
    check('plan_25 confirmation reads 25% / 75%', !!(planByUsub.data.message && planByUsub.data.message.indexOf('25% Unisocials / 75% event owner') !== -1), planByUsub.data.message);

    const planOutside = await req('POST', '/api/admin/events/commission-plan', { token: utok, body: { eventId: 'EVT-UNN', plan: 'plan_25' } });
    check('usub can never authorise outside their universities', planOutside.status === 403, String(planOutside.status));

    const planByWorker = await req('POST', '/api/admin/events/commission-plan', { token: wtok, body: { eventId: 'EVT-UI', plan: 'plan_25' } });
    check('workers can never authorise plans', planByWorker.status === 403, String(planByWorker.status));

    const planByMaster = await req('POST', '/api/admin/events/commission-plan', { token: ADMIN_PW, body: { eventId: 'EVT-UNN', plan: 'standard' } });
    check('master admin authorises any university', planByMaster.status === 200 && planByMaster.data.event.commissionPlanChangedBy === 'admin', JSON.stringify(planByMaster.data && planByMaster.data.event && planByMaster.data.event.commissionPlanChangedBy));

    // A direct sale stamped plan_25 pays the owner exactly 75%.
    const recentStamp = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const plan25Order = makeOrder({ orderId: 'ORD-PLAN25-1', eventId: 'EVT-UI', eventName: 'UI Rooftop Rave', universityId: 'uni-ui', universityName: 'University of Ibadan', universitySlug: 'ui', amount: 4000, commissionPlan: 'plan_25', createdAt: recentStamp, verifiedAt: recentStamp });
    const ordersWithPlan25 = readJson('orders.json', []);
    ordersWithPlan25.push(plan25Order);
    writeJson('orders.json', ordersWithPlan25);
    const adminPayouts = await req('GET', '/api/admin/payouts', { token: ADMIN_PW });
    const held25 = ((adminPayouts.data && adminPayouts.data.heldPayments) || []).find(h => h.orderId === 'ORD-PLAN25-1');
    check('plan_25 split: owner nets 75% of a direct sale', !!held25 && Math.abs(Number(held25.commissionAmount) - 3000) < 0.01, JSON.stringify(held25));

    // ── The 55% campus pool (funded by the authorised platform share) ──
    // UI verified sales at this point: 7×₦3000 direct (standard 20% = ₦4200
    // share), 1×₦3000 referred (2.5% = ₦75), 1×₦4000 plan_25 direct (25% =
    // ₦1000) → share ₦5275 → pool 55% = ₦2901.25.
    const pool1 = await req('GET', '/api/university-subadmin/pool', { token: utok });
    check('pool is 55% of the authorised platform share', pool1.status === 200 && pool1.data.pool.rate === 0.55 &&
      Math.abs(pool1.data.pool.platformShare - 5275) < 0.01 && Math.abs(pool1.data.pool.entitled - 2901.25) < 0.01 &&
      Math.abs(pool1.data.pool.available - 2901.25) < 0.01, JSON.stringify(pool1.data && pool1.data.pool));
    check('pool rows label the campus', !!(pool1.data.pool.byUniversity[0] && pool1.data.pool.byUniversity[0].universityName === 'University of Ibadan'), JSON.stringify(pool1.data.pool.byUniversity));
    check('university sales total feeds the pool', pool1.data.pool.sales === 28000, String(pool1.data.pool.sales));

    const poolNoBank = await req('POST', '/api/university-subadmin/payouts', { token: utok, body: { bank: {} } });
    check('pool request requires bank details', poolNoBank.status === 400, JSON.stringify(poolNoBank.data));
    const poolTooBig = await req('POST', '/api/university-subadmin/payouts', { token: utok, body: { amount: 999999, bank: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'UCHENNA SUB' } } });
    check('pool request cannot exceed the available pool', poolTooBig.status === 400 && poolTooBig.data.error.indexOf('exceeds') !== -1, JSON.stringify(poolTooBig.data));
    const poolReq = await req('POST', '/api/university-subadmin/payouts', { token: utok, body: { bank: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'UCHENNA SUB' } } });
    check('pool request draws the full available pool', poolReq.status === 200 && poolReq.data.payout.amount === 2901.25 &&
      poolReq.data.payout.payoutType === 'university_pool' && poolReq.data.payout.universities[0].name === 'University of Ibadan', JSON.stringify(poolReq.data && poolReq.data.payout));

    const poolAfter = await req('GET', '/api/university-subadmin/pool', { token: utok });
    check('pool availability drops by the open draw', Math.abs(poolAfter.data.pool.available - 0) < 0.01 && poolAfter.data.totals.openAmount === 2901.25, JSON.stringify(poolAfter.data.totals));
    const poolAgain = await req('POST', '/api/university-subadmin/payouts', { token: utok, body: { bank: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'UCHENNA SUB' } } });
    check('second draw is blocked while the first is open', poolAgain.status === 400, String(poolAgain.status));

    // A second sub-admin on the SAME campus cannot draw the same naira twice.
    const usub2 = await req('POST', '/api/admin/university-subadmins', { token: ADMIN_PW, body: { name: 'Bisi Sub', email: 'bisi.sub@unisocials.com', password: 'SubPass123!', universities: ['University of Ibadan'] } });
    check('second usub created for the shared campus', usub2.status === 200, JSON.stringify(usub2.data));
    const usub2Login = await req('POST', '/api/auth/login', { body: { email: 'bisi.sub@unisocials.com', password: 'SubPass123!' } });
    const utok2 = usub2Login.data && usub2Login.data.token;
    const poolOther = await req('GET', '/api/university-subadmin/pool', { token: utok2 });
    check('shared-campus double-draw is blocked', !!utok2 && Math.abs(poolOther.data.pool.available - 0) < 0.01, JSON.stringify(poolOther.data && poolOther.data.pool));

    // Rejecting the draw releases the pool again.
    const payoutsNow = readJson('payouts.json', []);
    payoutsNow.forEach(p => { if (p.payoutType === 'university_pool' && p.status === 'pending') { p.status = 'rejected'; p.adminNote = 'test release'; } });
    writeJson('payouts.json', payoutsNow);
    const poolFree = await req('GET', '/api/university-subadmin/pool', { token: utok });
    check('rejected draw frees the pool', Math.abs(poolFree.data.pool.available - 2901.25) < 0.01, JSON.stringify(poolFree.data.pool));
    const poolOtherFree = await req('GET', '/api/university-subadmin/pool', { token: utok2 });
    check('freed pool is visible to the shared-campus admin too', Math.abs(poolOtherFree.data.pool.available - 2901.25) < 0.01, JSON.stringify(poolOtherFree.data.pool));

    // ── University sub-admin settles their campuses' worker salaries ──
    const ngozi = await req('POST', '/api/admin/workers', { token: ADMIN_PW, body: { name: 'Ngozi Worker', email: 'ngozi.worker@unisocials.com', password: 'WorkerPass123!', universities: ['University of Nigeria Nsukka'] } });
    check('second worker created for the other campus', ngozi.status === 200, JSON.stringify(ngozi.data));
    const ngoziLogin = await resetLogin('ngozi.worker@unisocials.com', 'WorkerPass123!');
    const wtok2 = ngoziLogin.data && ngoziLogin.data.token;
    check('second worker signs in', !!wtok2 && ngoziLogin.data.user.authorizedUniversities[0].name === 'University of Nigeria Nsukka', JSON.stringify(ngoziLogin.data || ngoziLogin.error));

    const workerPayoutsUI = await req('GET', '/api/university-subadmin/worker-payouts', { token: utok });
    check('usub sees only their campuses\' workers', workerPayoutsUI.status === 200 && workerPayoutsUI.data.workers.length === 1 &&
      workerPayoutsUI.data.workers[0].email === 'wale.worker@unisocials.com', JSON.stringify(workerPayoutsUI.data.workers && workerPayoutsUI.data.workers.map(w => w.email)));
    const walePending = (workerPayoutsUI.data.payouts || []).find(p => p.requesterRole === 'worker' && p.status === 'pending');
    check('usub sees their worker\'s open salary request', !!walePending && walePending.amount === 50000, JSON.stringify(workerPayoutsUI.data.payouts && workerPayoutsUI.data.payouts.map(p => p.amount + ':' + p.status)));
    check('usub worker view carries the quota ledger', !!(workerPayoutsUI.data.workers[0].ledger && workerPayoutsUI.data.workers[0].ledger.blocksEarned >= 2), JSON.stringify(workerPayoutsUI.data.workers[0].ledger && { blocks: workerPayoutsUI.data.workers[0].ledger.blocksEarned }));

    const rejectNoNote = await req('POST', '/api/university-subadmin/worker-payouts', { token: utok, body: { payoutId: walePending.id, action: 'reject' } });
    check('rejection requires a reason', rejectNoNote.status === 400, JSON.stringify(rejectNoNote.data));

    const nonWorkerPayout = (poolReq.data && poolReq.data.payout && poolReq.data.payout.id);
    const notWorker = await req('POST', '/api/university-subadmin/worker-payouts', { token: utok, body: { payoutId: nonWorkerPayout, action: 'approve' } });
    check('pool/commission payouts are not payable here', notWorker.status === 404, String(notWorker.status));

    // A sub-admin of the OTHER campus cannot touch this worker's salary.
    const usub3 = await req('POST', '/api/admin/university-subadmins', { token: ADMIN_PW, body: { name: 'Obi Sub', email: 'obi.sub@unisocials.com', password: 'SubPass123!', universities: ['University of Nigeria Nsukka'] } });
    const usub3Login = await req('POST', '/api/auth/login', { body: { email: 'obi.sub@unisocials.com', password: 'SubPass123!' } });
    const utok3 = usub3Login.data && usub3Login.data.token;
    check('third usub created for the UNN campus', usub3.status === 200 && !!utok3, JSON.stringify(usub3.data));
    const crossCampus = await req('POST', '/api/university-subadmin/worker-payouts', { token: utok3, body: { payoutId: walePending.id, action: 'approve' } });
    check('another campus\'s sub-admin cannot pay this worker', crossCampus.status === 403, String(crossCampus.status));
    const workerPayoutsUNN = await req('GET', '/api/university-subadmin/worker-payouts', { token: utok3 });
    check('UNN sub-admin sees the UNN worker only', workerPayoutsUNN.status === 200 && workerPayoutsUNN.data.workers.length === 1 &&
      workerPayoutsUNN.data.workers[0].email === 'ngozi.worker@unisocials.com', JSON.stringify(workerPayoutsUNN.data.workers && workerPayoutsUNN.data.workers.map(w => w.email)));

    const approved = await req('POST', '/api/university-subadmin/worker-payouts', { token: utok, body: { payoutId: walePending.id, action: 'approve', adminNote: 'campus salary' } });
    check('usub approves their worker\'s salary', approved.status === 200 && approved.data.payout.status === 'approved' &&
      String(approved.data.payout.reviewedBy).indexOf('University Sub-Admin') !== -1, JSON.stringify(approved.data && { status: approved.data.payout.status, by: approved.data.payout.reviewedBy }));
    const paid = await req('POST', '/api/university-subadmin/worker-payouts', { token: utok, body: { payoutId: walePending.id, action: 'mark_paid' } });
    check('usub marks the salary paid', paid.status === 200 && paid.data.payout.status === 'paid' && !!paid.data.payout.paidAt, JSON.stringify(paid.data && paid.data.payout && paid.data.payout.status));
    const payTwice = await req('POST', '/api/university-subadmin/worker-payouts', { token: utok, body: { payoutId: walePending.id, action: 'mark_paid' } });
    check('paid salaries cannot be paid again', payTwice.status === 409, String(payTwice.status));

    // Other roles are locked out.
    const workerScoping = await req('GET', '/api/university-subadmin/overview', { token: wtok });
    check('workers cannot use sub-admin endpoints', workerScoping.status === 403, String(workerScoping.status));
    const usubAdminList = await req('GET', '/api/admin/university-subadmins', { token: utok });
    check('university sub-admins cannot list the directory', usubAdminList.status === 401, String(usubAdminList.status));

    // ── Master sub-admin: oversight only, still platform-wide role ──
    const master = await req('POST', '/api/admin/subadmins', { token: ADMIN_PW, body: { name: 'Master Sub', email: 'master.sub@unisocials.com', password: 'MasterSub123!' } });
    check('master sub-admin account still creates under role subadmin', master.status === 200 && master.data.subadmin.role === 'subadmin', JSON.stringify(master.data && master.data.subadmin && master.data.subadmin.role));
    const masterLogin = await req('POST', '/api/auth/login', { body: { email: 'master.sub@unisocials.com', password: 'MasterSub123!' } });
    const mtok = masterLogin.data && masterLogin.data.token;
    const masterSeesSubs = await req('GET', '/api/admin/university-subadmins', { token: mtok });
    check('master sub-admin can oversee university sub-admins', masterSeesSubs.status === 200 && masterSeesSubs.data.subadmins.length === 3, String(masterSeesSubs.status) + ' count=' + (masterSeesSubs.data && masterSeesSubs.data.subadmins && masterSeesSubs.data.subadmins.length));
    const masterSeesWorkers = await req('GET', '/api/admin/workers', { token: mtok });
    check('worker management stays master-admin only', masterSeesWorkers.status === 401, String(masterSeesWorkers.status));

    // ── Admin workers DELETE ──
    const del = await req('DELETE', '/api/admin/workers?email=' + encodeURIComponent('wale.worker@unisocials.com'), { token: ADMIN_PW });
    check('admin can remove a worker', del.status === 200, JSON.stringify(del.data));
    const dashAfter = await req('GET', '/api/worker/dashboard', { token: wtok });
    check('removed worker loses access immediately', dashAfter.status === 403, String(dashAfter.status));

  } finally {
    child.kill('SIGTERM');
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
