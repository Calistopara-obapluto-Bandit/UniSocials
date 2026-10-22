// DOM-level verification of the new dashboards (jsdom runScripts, mocked fetch).
//
// worker.html
//   * signed-out starts on the login view; a worker login renders the dashboard
//   * the quota bar, salary notice and task link render from the API fixture
//   * requesting salary posts bank details and surfaces the server message
//   * a non-worker role is rejected with the right error copy
// university-subadmin.html
//   * a university_subadmin login renders scoped chips/stats/orders/customers/events/referral
//   * a wrong role is rejected with the right error copy
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

let failures = 0;
const check = (name, ok, extra) => {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? '  :: ' + extra : '')); }
};

function makeResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

const WORKER_DASH = {
  success: true,
  user: { name: 'Wale Worker', email: 'wale.worker@unisocials.com', role: 'worker' },
  task: { code: 'TASK-ABCDEF12', url: 'https://site.test/events?task=TASK-ABCDEF12', createdAt: '2026-10-01T10:00:00.000Z' },
  ledger: {
    totalSales: 165, quota: 150, salaryPerBlock: 25000, blocksEarned: 1, totalSalary: 25000,
    currentMonth: '2026-10', monthSales: 5, carryIn: 10, credited: 15, carryOut: 0,
    remainingToBlock: 135,
    months: [
      { month: '2026-10', sales: 5, carryIn: 10, credited: 15, carryOut: 0, blockCompleted: false },
      { month: '2026-09', sales: 160, carryIn: 0, credited: 150, carryOut: 10, blockCompleted: true }
    ]
  },
  salary: {
    amountPerBlock: 25000, totalEarned: 25000, committedAmount: 0, availableAmount: 25000,
    availableBlocks: 1, cooldownDays: 21, canRequest: true, lastRequestedAt: null,
    nextRequestAt: null, totalPaid: 0, openAmount: 0
  },
  requests: [],
  savedBankAccount: null,
  notificationEmail: '', notificationEmailOnFile: false
};

async function testWorkerPage() {
  const html = fs.readFileSync(path.join(ROOT, 'worker.html'), 'utf8');
  const routes = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/worker.html',
    runScripts: 'dangerously',
    resources: undefined, // inline scripts only; the shared nav script stays unloaded
    beforeParse(window) {
      window.fetch = (url, opts = {}) => {
        routes.push({ url: String(url), method: opts.method || 'GET', body: opts.body || null });
        const u = String(url);
        if (u.includes('/api/worker/dashboard')) return makeResponse(WORKER_DASH);
        if (u.includes('/api/worker/salary-requests') && (opts.method || 'GET') === 'POST') {
          return makeResponse({ success: true, message: 'Salary request submitted: ₦25,000 (1 completed quota block of 150 sales each). Your campus sub-admin has been notified and will handle it — the Main Admin sees the request too.' });
        }
        if (u.includes('/api/auth/login') && (opts.method || 'GET') === 'POST') {
          const body = JSON.parse(opts.body || '{}');
          if (body.email === 'buyer@example.com') return makeResponse({ success: false, error: 'Invalid email or password.' }, 401);
          return makeResponse({ success: true, token: 'tok-worker', user: { id: 'WRK-1', name: 'Wale Worker', email: body.email, role: 'worker' } });
        }
        if (u.includes('/api/auth/logout')) return makeResponse({ success: true });
        return makeResponse({ success: false, error: 'unmocked: ' + u }, 404);
      };
    }
  });
  const { window } = dom;
  const doc = window.document;
  const tick = () => new Promise((r) => setTimeout(r, 20));

  await tick();

  // Signed out → login view visible, dashboard hidden.
  check('signed out shows the login view', !doc.getElementById('loginView').classList.contains('hidden') &&
    doc.getElementById('dashboard').classList.contains('hidden'));

  // Wrong role is rejected.
  doc.getElementById('email').value = 'buyer@example.com';
  doc.getElementById('password').value = 'x';
  doc.getElementById('loginForm').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await tick();
  const err = doc.getElementById('loginError');
  check('non-worker credentials rejected', err.classList.contains('show') && err.textContent.indexOf('Incorrect worker credentials') !== -1, err.textContent);

  // Worker login renders the dashboard.
  doc.getElementById('email').value = 'wale.worker@unisocials.com';
  doc.getElementById('password').value = 'WorkerPass123!';
  doc.getElementById('loginForm').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  check('worker login reveals the dashboard', !doc.getElementById('dashboard').classList.contains('hidden') &&
    doc.getElementById('loginView').classList.contains('hidden'));
  check('worker welcome header shows the account name', doc.getElementById('userName').textContent === 'Wale Worker', doc.getElementById('userName').textContent);

  check('task code renders', doc.getElementById('taskCode').textContent === 'TASK-ABCDEF12', doc.getElementById('taskCode').textContent);
  check('task link renders with the events?task URL', doc.getElementById('taskLink').href.indexOf('/events?task=TASK-ABCDEF12') !== -1, doc.getElementById('taskLink').href);
  check('quota month renders', doc.getElementById('quotaMonth').textContent === 'October 2026', doc.getElementById('quotaMonth').textContent);
  check('quota credited shows rollover math', doc.getElementById('quotaCredited').textContent === '15', doc.getElementById('quotaCredited').textContent);
  check('remaining-to-block copy', doc.getElementById('quotaRemaining').textContent.indexOf('135 more sales') !== -1, doc.getElementById('quotaRemaining').textContent);
  check('quota bar width reflects 15/150', doc.getElementById('quotaFill').style.width === '10%', doc.getElementById('quotaFill').style.width);
  check('salary available renders ₦25,000', doc.getElementById('statAvailable').textContent === '₦25,000', doc.getElementById('statAvailable').textContent);
  check('salary notice offers the request', doc.getElementById('salaryNotice').textContent.indexOf('can request') !== -1, doc.getElementById('salaryNotice').textContent);
  check('amount prefilled to available', doc.getElementById('poAmount').value === '25000', doc.getElementById('poAmount').value);
  check('month list renders both months', doc.querySelectorAll('#monthList tbody tr').length === 2, String(doc.querySelectorAll('#monthList tbody tr').length));
  check('salary history empty state', doc.getElementById('poHistory').textContent.indexOf('No salary requests yet') !== -1);

  // Request salary → posts bank details and surfaces the server message.
  doc.getElementById('poBankName').value = 'GTBank';
  doc.getElementById('poAccountNumber').value = '0123456789';
  doc.getElementById('poAccountName').value = 'WALE WORKER';
  doc.getElementById('poRequestBtn').click();
  await new Promise((r) => setTimeout(r, 80));
  const post = routes.find((r) => r.method === 'POST' && r.url.includes('/api/worker/salary-requests'));
  check('salary request posts bank details + amount', !!post, JSON.stringify(routes.map((r) => r.method + ' ' + r.url)));
  if (post) {
    const body = JSON.parse(post.body);
    check('salary request payload is well-formed',
      body.amount === 25000 && body.bank.bankName === 'GTBank' && body.bank.accountNumber === '0123456789' &&
      body.bank.accountName === 'WALE WORKER', JSON.stringify(body));
  }
  check('salary success message shown', doc.getElementById('poMsg').textContent.indexOf('Salary request submitted') !== -1, doc.getElementById('poMsg').textContent);

  dom.window.close();
}

const USUB_FIXTURES = {
  overview: {
    success: true,
    user: { id: 'USUB-1', name: 'Uchenna Sub', email: 'uchenna.sub@unisocials.com', role: 'university_subadmin' },
    universities: [{ id: 'uni-unn', slug: 'unn', name: 'University of Nigeria Nsukka' }],
    sales: {
      totalOrders: 12, pendingOrders: 2, verifiedOrders: 9, rejectedOrders: 1,
      totalTickets: 14, totalRevenue: 70000, uniquePeople: 9,
      events: [{ eventId: 'EVT-UNN', eventName: 'UNN Mega Party', universityName: 'University of Nigeria Nsukka', tickets: 14, orders: 9, revenue: 70000 }]
    }
  },
  orders: {
    success: true, readOnly: true,
    orders: [
      { orderId: 'ORD-1', eventName: 'UNN Mega Party', buyerName: 'Ada', buyerEmail: 'ada@example.com', qty: 2, amount: 10000, status: 'verified', verifiedAt: '2026-10-10T12:00:00.000Z' },
      { orderId: 'ORD-2', eventName: 'UNN Mega Party', buyerName: 'Bola', buyerEmail: 'bola@example.com', qty: 1, amount: 5000, status: 'pending', createdAt: '2026-10-11T12:00:00.000Z' }
    ]
  },
  customers: {
    success: true, totalCount: 2,
    customers: [
      { name: 'Ada', email: 'ada@example.com', phone: '0801', universityName: 'University of Nigeria Nsukka', totalOrders: 1, verifiedOrders: 1, totalTickets: 2, totalSpent: 10000, lastOrderAt: '2026-10-10T12:00:00.000Z' }
    ]
  },
  events: {
    success: true,
    universities: [{ id: 'uni-unn', slug: 'unn', name: 'University of Nigeria Nsukka' }],
    events: [{ id: 'EVT-UNN', name: 'UNN Mega Party', date: 'Saturday, 15 Nov 2026', venue: 'UNN Main Auditorium', universityName: 'University of Nigeria Nsukka', seats: 500, price: 5000 }]
  },
  link: { success: true, link: { code: 'REF-1234ABCD', referralUrl: 'https://site.test/events?ref=REF-1234ABCD' } },
  stats: { success: true, stats: { totalOrders: 3, totalRevenue: 15000, totalTickets: 4, uniquePeople: 3, link: { code: 'REF-1234ABCD' } } },
  pool: {
    success: true,
    pool: {
      rate: 0.55, sales: 70000, platformShare: 14000, platformKeeps: 6300, entitled: 7700, committed: 7700, available: 0,
      byUniversity: [{ universityKey: 'unn', universityName: 'University of Nigeria Nsukka', sales: 70000, platformShare: 14000, pool: 7700, committed: 7700, available: 0 }]
    },
    requests: [{ id: 'PO-1', amount: 7700, status: 'pending', createdAt: '2026-10-12T10:00:00.000Z', paidAt: null, adminNote: '' }],
    savedBankAccount: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'UCHENNA SUB' },
    totals: { requested: 7700, openAmount: 7700, paidAmount: 0, openCount: 1 }
  },
  workerPayouts: {
    success: true,
    workers: [{
      id: 'WRK-1', name: 'Wale Worker', email: 'wale.worker@unisocials.com', taskCode: 'TASK-ABCDEF12',
      authorizedUniversities: [{ id: 'uni-unn', slug: 'unn', name: 'University of Nigeria Nsukka' }],
      ledger: { quota: 150, monthSales: 5, credited: 15, blocksEarned: 1, totalSalary: 25000 }
    }],
    payouts: [{
      id: 'PAY-1', requesterRole: 'worker', requesterName: 'Wale Worker', amount: 25000, status: 'pending',
      createdAt: '2026-10-13T10:00:00.000Z', paidAt: null, bankName: 'GTBank', accountNumber: '0123456789', accountName: 'WALE WORKER'
    }],
    canPay: true
  }
};

async function testUniversitySubadminPage() {
  const html = fs.readFileSync(path.join(ROOT, 'university-subadmin.html'), 'utf8');
  const routes = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/university-subadmin.html',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = (url, opts = {}) => {
        const u = String(url);
        routes.push({ url: u, method: opts.method || 'GET', body: opts.body || null });
        if (u.includes('/api/university-subadmin/overview')) return makeResponse(USUB_FIXTURES.overview);
        if (u.includes('/api/university-subadmin/orders')) return makeResponse(USUB_FIXTURES.orders);
        if (u.includes('/api/university-subadmin/customers')) return makeResponse(USUB_FIXTURES.customers);
        if (u.includes('/api/university-subadmin/events')) return makeResponse(USUB_FIXTURES.events);
        if (u.includes('/api/university-subadmin/referral-link')) return makeResponse(USUB_FIXTURES.link);
        if (u.includes('/api/university-subadmin/referral-stats')) return makeResponse(USUB_FIXTURES.stats);
        if (u.includes('/api/university-subadmin/pool') && (opts.method || 'GET') === 'GET') return makeResponse(USUB_FIXTURES.pool);
        if (u.includes('/api/university-subadmin/worker-payouts') && (opts.method || 'GET') === 'GET') return makeResponse(USUB_FIXTURES.workerPayouts);
        if (u.includes('/api/university-subadmin/worker-payouts') && (opts.method || 'GET') === 'POST') return makeResponse({ success: true, message: 'Salary request updated.' });
        if (u.includes('/api/admin/events/commission-plan') && (opts.method || 'GET') === 'POST') return makeResponse({ success: true, message: 'Split authorized: direct sales on this event now split 25% Unisocials / 75% event owner.' });
        if (u.includes('/api/auth/login') && (opts.method || 'GET') === 'POST') {
          const body = JSON.parse(opts.body || '{}');
          if (body.email === 'wrong@example.com') return makeResponse({ success: false, error: 'Invalid email or password.' }, 401);
          return makeResponse({ success: true, token: 'tok-usub', user: { id: 'USUB-1', name: 'Uchenna Sub', email: body.email, role: 'university_subadmin' } });
        }
        if (u.includes('/api/auth/logout')) return makeResponse({ success: true });
        return makeResponse({ success: false, error: 'unmocked: ' + u }, 404);
      };
      window.confirm = () => true;
    }
  });
  const { window } = dom;
  const doc = window.document;
  const tick = () => new Promise((r) => setTimeout(r, 20));
  await tick();

  check('usub: signed out shows the login view', !doc.getElementById('loginView').classList.contains('hidden') &&
    doc.getElementById('dashboard').classList.contains('hidden'));

  // Wrong role copy check (server returns 401 for bad creds → same path).
  doc.getElementById('email').value = 'wrong@example.com';
  doc.getElementById('password').value = 'x';
  doc.getElementById('loginForm').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await tick();
  const err = doc.getElementById('loginError');
  check('usub: bad credentials rejected', err.classList.contains('show') && err.textContent.indexOf('Incorrect university sub-admin credentials') !== -1, err.textContent);

  doc.getElementById('email').value = 'uchenna.sub@unisocials.com';
  doc.getElementById('password').value = 'SubPass123!';
  doc.getElementById('loginForm').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  check('usub: login reveals the dashboard', !doc.getElementById('dashboard').classList.contains('hidden') &&
    doc.getElementById('loginView').classList.contains('hidden'));
  check('usub: welcome header shows the account name', doc.getElementById('userName').textContent === 'Uchenna Sub', doc.getElementById('userName').textContent);

  check('usub: authorized campus chip renders', doc.getElementById('uniChips').textContent.indexOf('University of Nigeria Nsukka') !== -1, doc.getElementById('uniChips').textContent);
  check('usub: overview revenue renders', doc.getElementById('statRevenue').textContent === '₦70,000', doc.getElementById('statRevenue').textContent);
  check('usub: per-event table renders', doc.querySelectorAll('#eventPerf tbody tr').length === 1, String(doc.querySelectorAll('#eventPerf tbody tr').length));
  check('usub: orders table renders scoped rows', doc.querySelectorAll('#ordersList tbody tr').length === 2, String(doc.querySelectorAll('#ordersList tbody tr').length));
  check('usub: customers render', doc.querySelectorAll('#customersList tbody tr').length === 1, String(doc.querySelectorAll('#customersList tbody tr').length));
  check('usub: events render', doc.querySelectorAll('#eventsList .usub-event').length === 1, String(doc.querySelectorAll('#eventsList .usub-event').length) + ' html=' + doc.getElementById('eventsList').innerHTML.replace(/\s+/g, ' ').slice(0, 200));
  check('usub: referral code renders', doc.getElementById('refCode').textContent === 'REF-1234ABCD', doc.getElementById('refCode').textContent);
  check('usub: referral link renders', doc.getElementById('refLink').href.indexOf('ref=REF-1234ABCD') !== -1, doc.getElementById('refLink').href);
  check('usub: referral revenue renders', doc.getElementById('refRevenue').textContent === '₦15,000', doc.getElementById('refRevenue').textContent);

  // Tab switching works.
  const ordersTab = Array.from(doc.querySelectorAll('.usub-tab')).find((b) => b.getAttribute('data-utab') === 'orders');
  ordersTab.click();
  check('usub: tab switch activates the orders panel', doc.querySelector('[data-upanel="orders"]').classList.contains('active') &&
    !doc.querySelector('[data-upanel="overview"]').classList.contains('active'));

  // Order filter narrows the table.
  const pendingFilter = Array.from(doc.querySelectorAll('.usub-filter-btn')).find((b) => b.getAttribute('data-ofilter') === 'pending');
  pendingFilter.click();
  check('usub: pending filter narrows to 1 row', doc.querySelectorAll('#ordersList tbody tr').length === 1, String(doc.querySelectorAll('#ordersList tbody tr').length));

  // ── New tabs: commission split, campus pool, workers ──
  const tabNames = Array.from(doc.querySelectorAll('.usub-tab')).map((b) => b.getAttribute('data-utab'));
  check('usub: commission/pool/workers tabs exist',
    tabNames.includes('commission') && tabNames.includes('pool') && tabNames.includes('workers'), JSON.stringify(tabNames));

  // Commission: one event row, five plan options including the 25/75 plan.
  const commissionTab = Array.from(doc.querySelectorAll('.usub-tab')).find((b) => b.getAttribute('data-utab') === 'commission');
  commissionTab.click();
  check('usub: commission panel activates', doc.querySelector('[data-upanel="commission"]').classList.contains('active'));
  check('usub: commission list renders the scoped event', doc.getElementById('commissionList').textContent.indexOf('UNN Mega Party') !== -1,
    doc.getElementById('commissionList').textContent.replace(/\s+/g, ' ').slice(0, 200));
  const planSel = doc.querySelector('#commissionList select[data-plan-select]');
  check('usub: plan select exists for the event', !!planSel);
  const planValues = planSel ? Array.from(planSel.options).map((o) => o.value) : [];
  check('usub: five plans offered incl. 25/75', planValues.length === 5 && planValues.includes('plan_25'), JSON.stringify(planValues));
  if (planSel) {
    planSel.value = 'plan_25';
    planSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    const planPost = routes.find((r) => r.method === 'POST' && r.url.includes('/api/admin/events/commission-plan'));
    check('usub: authorising the sales % posts plan_25', !!planPost && JSON.parse(planPost.body).plan === 'plan_25',
      planPost ? planPost.body : 'no POST');
    check('usub: plan confirmation message surfaces', doc.getElementById('commissionStatus').textContent.indexOf('25% Unisocials / 75% event owner') !== -1,
      doc.getElementById('commissionStatus').textContent);
  }

  // Pool: 55% figures, per-campus row, prefilled bank, disabled draw at ₦0.
  const poolTab = Array.from(doc.querySelectorAll('.usub-tab')).find((b) => b.getAttribute('data-utab') === 'pool');
  poolTab.click();
  check('usub: pool panel activates', doc.querySelector('[data-upanel="pool"]').classList.contains('active'));
  check('usub: pool shows the 55% entitled pool', doc.getElementById('poolEntitled').textContent === '₦7,700', doc.getElementById('poolEntitled').textContent);
  check('usub: pool availability renders', doc.getElementById('poolAvailable').textContent === '₦0', doc.getElementById('poolAvailable').textContent);
  check('usub: pool sales + platform share render', doc.getElementById('poolSales').textContent === '₦70,000' && doc.getElementById('poolShare').textContent === '₦14,000',
    doc.getElementById('poolSales').textContent + ' / ' + doc.getElementById('poolShare').textContent);
  // 45/55 of the fee: ₦14,000 fee → platform keeps ₦6,300, campuses get ₦7,700.
  check('usub: pool shows the platform\'s 45% cut', doc.getElementById('poolKeeps').textContent === '₦6,300', doc.getElementById('poolKeeps').textContent);
  check('usub: pool copy explains the 45 / 55 split', doc.querySelector('[data-upanel="pool"]').textContent.indexOf('45 / 55') !== -1);
  check('usub: per-campus pool row renders', doc.querySelectorAll('#poolByUni tbody tr').length === 1 &&
    doc.getElementById('poolByUni').textContent.indexOf('University of Nigeria Nsukka') !== -1);
  check('usub: pool totals line renders', doc.getElementById('poolTotals').textContent.indexOf('Open ₦7,700') !== -1,
    doc.getElementById('poolTotals').textContent);
  check('usub: bank details prefilled from the saved account', doc.getElementById('poolBankName').value === 'GTBank' &&
    doc.getElementById('poolAcctNumber').value === '0123456789', doc.getElementById('poolBankName').value);
  check('usub: draw disabled while nothing is available', doc.getElementById('poolRequestBtn').disabled === true);
  check('usub: own pool request rows render', doc.getElementById('poolRequests').textContent.indexOf('PO-1') === -1 &&
    doc.querySelectorAll('#poolRequests tbody tr').length === 1,
    doc.getElementById('poolRequests').textContent.replace(/\s+/g, ' ').slice(0, 200));

  // Workers: campus workers render and salary actions POST.
  const workersTab = Array.from(doc.querySelectorAll('.usub-tab')).find((b) => b.getAttribute('data-utab') === 'workers');
  workersTab.click();
  check('usub: workers panel activates', doc.querySelector('[data-upanel="workers"]').classList.contains('active'));
  check('usub: worker row renders with campus + task code',
    doc.getElementById('workersList').textContent.indexOf('Wale Worker') !== -1 &&
    doc.getElementById('workersList').textContent.indexOf('University of Nigeria Nsukka') !== -1 &&
    doc.getElementById('workersList').textContent.indexOf('TASK-ABCDEF12') !== -1,
    doc.getElementById('workersList').textContent.replace(/\s+/g, ' ').slice(0, 300));
  check('usub: pending salary request renders with actions',
    doc.getElementById('workerPayoutsList').textContent.indexOf('₦25,000') !== -1 &&
    !!doc.querySelector('#workerPayoutsList [data-pay-action="approve"]'));
  const approveBtn = doc.querySelector('#workerPayoutsList [data-pay-action="approve"]');
  if (approveBtn) approveBtn.click();
  await tick();
  const payPost = routes.find((r) => r.method === 'POST' && r.url.includes('/api/university-subadmin/worker-payouts'));
  check('usub: approving a salary posts the action', !!payPost && JSON.parse(payPost.body).action === 'approve' &&
    JSON.parse(payPost.body).payoutId === 'PAY-1', payPost ? payPost.body : 'no POST');
  check('usub: salary action confirmation surfaces', doc.getElementById('workerStatus').textContent.indexOf('Salary request updated') !== -1,
    doc.getElementById('workerStatus').textContent);

  dom.window.close();
}

(async () => {
  await testWorkerPage();
  await testUniversitySubadminPage();
  console.log(failures === 0 ? '\nALL DOM CHECKS PASSED' : '\n' + failures + ' DOM CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
