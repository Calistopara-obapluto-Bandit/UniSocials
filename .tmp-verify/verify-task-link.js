// Verification for the referral Apply fix and the new Task Referral Link.
//
// Part 1 — source wiring (the React checkout's Apply button was dead code):
//   * Checkout.jsx wires onClick={applyReferralCode} + Enter on the input
//   * main.jsx + the legacy shared script capture ?task= and ?ref= with the
//     mutual-exclusion rule (a task session and a referral session never
//     coexist; applying a referral clears the task session)
//   * influencer.html renders the Task Referral Link + people/visits counters
//
// Part 2 — live API behaviour: boots an ISOLATED server instance (copy of
// server.js with its own data/ dir, JSON storage, no DATABASE_URL) on a spare
// port with a temporary influencer account, then checks:
//   * task-link endpoint auth-gated (403), creates a stable TASK- code (200)
//   * /api/task-referral/track counts each browser once ("people") and every
//     landing ("uses") — the same link can be used any number of times
//   * unknown codes / bad payloads are rejected (404 / 400)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRV = path.join(__dirname, 'srv');
const PORT = 3457;
const BASE = 'http://127.0.0.1:' + PORT;
const EMAIL = 'task-link-test@example.com';
const PASSWORD = 'TaskLinkTest123!';
// Main-admin credential for the ISOLATED instance only, so the platform-wide
// task-link endpoint can be exercised end to end.
const ADMIN_PW = 'task-link-test-admin-pw-1';

let failures = 0;
const check = (name, ok, extra) => {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
};

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}

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

function waitForServer(child, ms) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (child.exitCode !== null) return reject(new Error('server exited early'));
      fetch(BASE + '/api/universities')
        .then((r) => (r.ok ? resolve() : setTimeout(tick, 250)))
        .catch(() => setTimeout(tick, 250));
      if (Date.now() > deadline) reject(new Error('server did not start in time'));
    };
    tick();
  });
}

(async () => {
  // ── Part 1: source wiring ──
  const checkoutSrc = fs.readFileSync(path.join(ROOT, 'app/pages/Checkout.jsx'), 'utf8');
  check('Checkout.jsx wires Apply onClick to applyReferralCode',
    /id="applyReferralBtn"[^>]*onClick=\{applyReferralCode\}/.test(checkoutSrc));
  check('Checkout.jsx applies on Enter too',
    checkoutSrc.includes("if (e.key === 'Enter') { e.preventDefault(); applyReferralCode(); }"));
  check('Checkout.jsx pre-fills but never auto-applies the carried code',
    checkoutSrc.includes('do NOT apply it') && checkoutSrc.includes('referralCodeInput'));
  check('Checkout.jsx clears the task session when a referral is applied',
    /setAppliedReferralCode\(code\);[\s\S]{0,400}unn_task_code/.test(checkoutSrc));
  check('Checkout.jsx refuses to prefill a referral while a task session is active',
    checkoutSrc.includes('taskSessionActive()'));

  const mainSrc = fs.readFileSync(path.join(ROOT, 'app/main.jsx'), 'utf8');
  check('React entry captures ?task= and tracks it',
    mainSrc.includes("params.get('task')") && mainSrc.includes('/api/task-referral/track'));
  check('React entry makes task and referral sessions mutually exclusive',
    mainSrc.includes("sessionStorage.removeItem('referralCode')") &&
    mainSrc.includes("sessionStorage.removeItem('unn_task_code')"));

  const legacySrc = fs.readFileSync(path.join(ROOT, 'templatemo-622-clearwave.js'), 'utf8');
  check('legacy shared script handles ?task= with the same exclusivity',
    legacySrc.includes("params.get('task')") && legacySrc.includes('/api/task-referral/track') &&
    legacySrc.includes("sessionStorage.removeItem('unn_task_code')"));

  const dashSrc = fs.readFileSync(path.join(ROOT, 'influencer.html'), 'utf8');
  check('influencer dashboard renders the Task Referral Link',
    dashSrc.includes('id="taskLink"') && dashSrc.includes('Task referral link'));
  check('influencer dashboard loads + copies the task link',
    dashSrc.includes('loadTaskLink()') && dashSrc.includes('copyTaskLinkBtn'));
  // The product decision: a task link is measured by PURCHASES only. People
  // and visit counts are never shown anywhere.
  check('influencer dashboard shows the purchase counter',
    dashSrc.includes('id="taskPurchases"') && dashSrc.includes('task.purchases'));
  check('influencer dashboard no longer shows people or visit counts',
    !dashSrc.includes('id="taskPeople"') && !dashSrc.includes('id="taskUses"'));

  const iaDash = fs.readFileSync(path.join(ROOT, 'influencer-admin.html'), 'utf8');
  check('influencer admin dashboard shows each influencer task purchases',
    iaDash.includes('Task purchases:') && iaDash.includes('u.taskLink'));

  const influencersPanel = fs.readFileSync(path.join(ROOT, 'app/pages/admin/InfluencersPanel.jsx'), 'utf8');
  check('React admin shows the platform-wide task-link totals',
    influencersPanel.includes('/api/admin/task-links'));
  check('React admin shows each influencer task purchases',
    influencersPanel.includes('Task purchases:') && influencersPanel.includes('task.purchases'));
  check('React admin shows sub-admins in the overall referral totals',
    influencersPanel.includes('referral.subadmin.orders'));

  // The task link session must be visible at checkout, and the order must
  // carry the code so a purchase can be credited. (The legacy checkout.html
  // was removed — React owns /checkout — so only the React source is checked.)
  check('Checkout.jsx renders the task link notice',
    checkoutSrc.includes('className="checkout-card reveal reveal-delay-2 task-link-card"') &&
    checkoutSrc.includes('Task link active'));
  check('legacy checkout shows the notice while a task session is active',
    legacySrc.includes('renderTaskLinkNotice') && legacySrc.includes("getElementById('taskLinkNotice')"));
  check('legacy checkout submits the task code with the order',
    legacySrc.includes('taskCode: (function()'));
  check('React checkout submits the task code with the order',
    checkoutSrc.includes('taskCode: referralApplied'));

  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check('server.js registers /api/influencer/task-link',
    serverSrc.includes("'/api/influencer/task-link'"));
  check('server.js registers /api/task-referral/track',
    serverSrc.includes("'/api/task-referral/track'"));
  check('server.js stores the task code on the order',
    serverSrc.includes('taskCode: attributedTaskCode || null'));
  check('server.js counts only verified task orders as purchases',
    serverSrc.includes('function isTaskOrderCounted') &&
    /function isTaskOrderCounted[\s\S]{0,400}verified/.test(serverSrc));
  check('server.js registers /api/admin/task-links',
    serverSrc.includes("'/api/admin/task-links'"));
  check('server.js sends task links to the influencer admin (like the referral link)',
    /pathname === '\/api\/influencer-admin\/influencers'[\s\S]{0,4000}taskLink: taskLinkStatsFor/.test(serverSrc));
  check('server.js sends task links to the main admin influencer list',
    /pathname === '\/api\/admin\/influencers' && req\.method === 'GET'[\s\S]{0,4000}taskLink: taskLinkStatsFor/.test(serverSrc));

  // ── Part 2: live API behaviour on an isolated instance ──
  // The copy gets its own data/ directory, so nothing real is read or written.
  fs.rmSync(SRV, { recursive: true, force: true });
  fs.mkdirSync(path.join(SRV, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(SRV, 'server.js'));
  fs.writeFileSync(path.join(SRV, 'data', 'users.json'), JSON.stringify([{
    id: 'test-task-influencer',
    email: EMAIL,
    name: 'Task Link Tester',
    role: 'influencer',
    passwordHash: hashPassword(PASSWORD),
    createdAt: new Date().toISOString(),
    influencerAssignments: []
  }], null, 2), 'utf8');

  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRV,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', NODE_ENV: 'development', ADMIN_PASSWORD: ADMIN_PW }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childLog = '';
  child.stdout.on('data', (c) => { childLog += c; });
  child.stderr.on('data', (c) => { childLog += c; });

  try {
    await waitForServer(child, 20000);

    const noAuth = await req('GET', '/api/influencer/task-link');
    check('task-link endpoint rejects anonymous callers (403)', noAuth.status === 403, 'status=' + noAuth.status);

    const login = await req('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    check('test influencer can log in', login.status === 200 && login.data && login.data.success === true,
      JSON.stringify(login.data).slice(0, 120));
    const token = login.data && login.data.token;
    if (!token) throw new Error('no session token — cannot continue');

    const first = await req('GET', '/api/influencer/task-link', { token });
    const task = first.data && first.data.task;
    check('task-link is created on first request', first.status === 200 && !!(task && task.code), JSON.stringify(first.data));
    check('task code uses the TASK- prefix', !!(task && /^TASK-[A-Z0-9]+$/.test(task.code)), task && task.code);
    check('task link URL lands on /events?task=', !!(task && task.url && task.url.includes('/events?task=' + task.code)), task && task.url);
    check('a fresh task link starts at 0 purchases', !!(task && task.purchases === 0),
      JSON.stringify(task));
    check('the task-link payload exposes purchases only (no people/visits)',
      !!(task && !('people' in task) && !('uses' in task)), JSON.stringify(task));

    const second = await req('GET', '/api/influencer/task-link', { token });
    check('the task link code is stable across requests',
      !!(second.data && second.data.task && second.data.task.code === task.code),
      (second.data && second.data.task && second.data.task.code) + ' vs ' + task.code);

    const hit1 = await req('POST', '/api/task-referral/track', { body: { code: task.code, visitorId: 'visitor-alpha-1' } });
    check('first use counts 1 person / 1 visit',
      hit1.status === 200 && hit1.data && hit1.data.people === 1 && hit1.data.uses === 1 && hit1.data.alreadyCounted === false,
      JSON.stringify(hit1.data));

    // The same person coming back is still just one "person", but the visit is
    // counted: the link can be used any number of times.
    const hit2 = await req('POST', '/api/task-referral/track', { body: { code: task.code, visitorId: 'visitor-alpha-1' } });
    check('a repeat visit stays at 1 person and counts 2 visits',
      hit2.status === 200 && hit2.data && hit2.data.people === 1 && hit2.data.uses === 2 && hit2.data.alreadyCounted === true,
      JSON.stringify(hit2.data));

    const hit3 = await req('POST', '/api/task-referral/track', { body: { code: task.code, visitorId: 'visitor-beta-22' } });
    check('a second person brings the count to 2 people / 3 visits',
      hit3.status === 200 && hit3.data && hit3.data.people === 2 && hit3.data.uses === 3,
      JSON.stringify(hit3.data));

    const reread = await req('GET', '/api/influencer/task-link', { token });
    check('the dashboard payload never exposes people or visit counts',
      reread.status === 200 && reread.data && reread.data.task &&
      !('people' in reread.data.task) && !('uses' in reread.data.task),
      JSON.stringify(reread.data && reread.data.task));

    // ── Part 3: purchases credited through the task link ──
    // The isolated instance reads data/events.json on every request, so the
    // catalogue can be seeded while the server is already running. The free
    // event is verified in the same request that creates it (no gateway),
    // which is what lets "verified purchase" be tested end to end.
    fs.writeFileSync(path.join(SRV, 'data', 'events.json'), JSON.stringify([
      { id: 'ev-free', name: 'Free Meetup', date: 'Jan 1, 2027', time: '12:00', venue: 'Hall A',
        category: 'General', price: 0, bonusPrice: 0, seats: 100,
        universityId: 'u1', universityName: 'Test University', universitySlug: 'test-university' },
      { id: 'ev-paid', name: 'Paid Fest', date: 'Feb 1, 2027', time: '12:00', venue: 'Hall B',
        category: 'General', price: 2000, bonusPrice: 1800, seats: 100,
        universityId: 'u1', universityName: 'Test University', universitySlug: 'test-university' }
    ], null, 2), 'utf8');

    const baseOrder = (over) => Object.assign({
      eventName: 'Test Event', eventDate: 'Jan 1, 2027 · 12:00', eventVenue: 'Hall A',
      eventCategory: 'General', qty: 1, currency: 'NGN',
      buyerName: 'Task Buyer', buyerEmail: 'task-buyer@example.com', buyerPhone: '08012345678',
      ticketTier: 'regular', taskCode: task.code
    }, over);
    const taskStats = async () => {
      const r = await req('GET', '/api/influencer/task-link', { token });
      return (r.data && r.data.task) || {};
    };

    const freeOrder = await req('POST', '/api/orders', { body: baseOrder({
      orderId: 'TASK-FREE-0001', eventId: 'ev-free', eventName: 'Free Meetup',
      amount: 0, paymentMethod: 'free', qty: 2
    }) });
    check('a task-linked order is created',
      freeOrder.status === 200 && !!(freeOrder.data && freeOrder.data.success),
      JSON.stringify(freeOrder.data).slice(0, 220));
    check('the order stores the task code',
      !!(freeOrder.data && freeOrder.data.order && freeOrder.data.order.taskCode === task.code),
      JSON.stringify(freeOrder.data && freeOrder.data.order && freeOrder.data.order.taskCode));
    check('the free order is verified immediately',
      !!(freeOrder.data && freeOrder.data.order && freeOrder.data.order.status === 'verified'),
      JSON.stringify(freeOrder.data && freeOrder.data.order && freeOrder.data.order.status));

    let stats = await taskStats();
    check('a verified task-linked order counts as a purchase', stats.purchases === 1, JSON.stringify(stats));
    check('the purchase credits the tickets bought', stats.tickets === 2, JSON.stringify(stats));

    // A paid order is only pending until the money is confirmed: it must not
    // be credited to the task link before it is verified.
    const pendingOrder = await req('POST', '/api/orders', { body: baseOrder({
      orderId: 'TASK-PENDING-0001', eventId: 'ev-paid', eventName: 'Paid Fest',
      amount: 1800, paymentMethod: 'card', qty: 1
    }) });
    check('a paid task-linked order is created as pending',
      pendingOrder.status === 200 &&
      !!(pendingOrder.data && pendingOrder.data.order && pendingOrder.data.order.status === 'pending'),
      JSON.stringify(pendingOrder.data).slice(0, 220));
    stats = await taskStats();
    check('a pending order is not counted as a purchase', stats.purchases === 1, JSON.stringify(stats));

    // An order that did not arrive through the task link never credits it.
    const untracked = Object.assign({}, baseOrder({
      orderId: 'TASK-NONE-0001', eventId: 'ev-free', eventName: 'Free Meetup',
      amount: 0, paymentMethod: 'free'
    }));
    delete untracked.taskCode;
    const noTaskOrder = await req('POST', '/api/orders', { body: untracked });
    check('an order without a task code is created',
      noTaskOrder.status === 200 && !!(noTaskOrder.data && noTaskOrder.data.success),
      JSON.stringify(noTaskOrder.data).slice(0, 220));
    stats = await taskStats();
    check('an untracked order does not credit the task link', stats.purchases === 1, JSON.stringify(stats));

    // ── Part 4: the platform-wide view (main admin), sub-admins included ──
    const denied = await req('GET', '/api/admin/task-links', { token });
    check('an influencer cannot read the platform-wide totals (403)',
      denied.status === 403, 'status=' + denied.status);

    const overall = await req('GET', '/api/admin/task-links', { token: ADMIN_PW });
    check('the main admin can read the platform-wide totals',
      overall.status === 200 && !!(overall.data && overall.data.success),
      JSON.stringify(overall.data).slice(0, 200));
    check('the overall view totals every task-link purchase',
      !!(overall.data && overall.data.task && overall.data.task.purchases === 1),
      JSON.stringify(overall.data && overall.data.task));
    check('the overall view lists each influencer task link',
      !!(overall.data && overall.data.taskLinks &&
        overall.data.taskLinks.some(r => r.code === task.code && r.purchases === 1)),
      JSON.stringify(overall.data && overall.data.taskLinks));

    // Sub-admins count too: a verified order through a sub-admin's referral
    // link must show up in the same platform-wide numbers.
    const sub = await req('POST', '/api/admin/subadmins', {
      token: ADMIN_PW,
      body: { name: 'Task Sub Admin', email: 'task-subadmin@example.com', password: 'TaskSubAdmin123!' }
    });
    check('a sub-admin can be created with a referral code',
      sub.status === 200 && !!(sub.data && sub.data.subadmin && sub.data.subadmin.referralCode),
      JSON.stringify(sub.data).slice(0, 200));
    const subCode = sub.data && sub.data.subadmin && sub.data.subadmin.referralCode;

    const subOrder = await req('POST', '/api/orders', { body: baseOrder({
      orderId: 'TASK-SUBADMIN-0001', eventId: 'ev-free', eventName: 'Free Meetup',
      amount: 0, paymentMethod: 'free', referralCode: subCode
    }) });
    check('the sub-admin referral order is verified',
      subOrder.status === 200 && !!(subOrder.data && subOrder.data.order && subOrder.data.order.status === 'verified'),
      JSON.stringify(subOrder.data).slice(0, 220));
    check('a referred order drops the task code (the two never coexist)',
      !!(subOrder.data && subOrder.data.order && !subOrder.data.order.taskCode),
      JSON.stringify(subOrder.data && subOrder.data.order && subOrder.data.order.taskCode));

    const overall2 = await req('GET', '/api/admin/task-links', { token: ADMIN_PW });
    const ref = overall2.data && overall2.data.referral;
    check('the overall view includes sub-admin referral sales',
      !!(ref && ref.subadmin.orders === 1), JSON.stringify(ref));
    check('the overall referral totals cover influencers and sub-admins',
      !!(ref && ref.totalOrders === (ref.subadmin.orders + ref.influencer.orders)), JSON.stringify(ref));

    // Regression: a sub-admin's own sales figures used to report zero because
    // their referral link was scoped as if it belonged to an influencer.
    const subs = await req('GET', '/api/admin/subadmins', { token: ADMIN_PW });
    const subRow = subs.data && subs.data.subadmins &&
      subs.data.subadmins.find(s => s.referralCode === subCode);
    check('the sub-admin dashboard counts their own referred sales',
      !!(subRow && subRow.referralStats && subRow.referralStats.totalOrders === 1),
      JSON.stringify(subRow && subRow.referralStats));
    check('the task-link purchase total is untouched by a referred order',
      !!(overall2.data && overall2.data.task && overall2.data.task.purchases === 1),
      JSON.stringify(overall2.data && overall2.data.task));

    const unknown = await req('POST', '/api/task-referral/track', { body: { code: 'TASK-DOESNOTEXIST', visitorId: 'visitor-alpha-1' } });
    check('unknown task codes are rejected (404)', unknown.status === 404, 'status=' + unknown.status);

    const badVisitor = await req('POST', '/api/task-referral/track', { body: { code: task.code, visitorId: 'x' } });
    check('malformed visitor ids are rejected (400)', badVisitor.status === 400, 'status=' + badVisitor.status);

    const noCode = await req('POST', '/api/task-referral/track', { body: { visitorId: 'visitor-alpha-1' } });
    check('missing task codes are rejected (400)', noCode.status === 400, 'status=' + noCode.status);
  } catch (e) {
    check('isolated server test run', false, String(e && e.message ? e.message : e) +
      (childLog ? '\nserver log: ' + childLog.slice(-600) : ''));
  } finally {
    child.kill('SIGTERM');
  }

  console.log(failures === 0 ? '\nALL TASK REFERRAL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
