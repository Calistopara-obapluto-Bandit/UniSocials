/*
Unisocials — Node.js server
----------------------------------
- Serves the static site + dynamic config.js
- Persistent data storage:
    • PostgreSQL if DATABASE_URL is set (recommended for Render — survives restarts/redeploys)
    • JSON files in ./data otherwise (persists on local disk)
- Flutterwave-only checkout with server-authoritative verification:
    order is created PENDING → Flutterwave confirms → webhook or /api/verify-payment
    re-verifies the transaction server-side and checks reference+amount+currency BEFORE issuing tickets.
- One unique ticket code per ticket purchased (qty = N → N QR tickets).
- Buyer accounts (register/login) so tickets are stored and don't require refresh.
- Admin gate scan endpoint for check-in.
*/

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// ── Load local .env (if present) so local dev uses the same secrets as Render.
// Never commit .env — it holds live API keys (gitignored).
try {
  const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envRaw.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  });
} catch (e) { /* no .env file — fall back to process.env / defaults */ }

const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days


// ────────────────────────────────────────────
// STORAGE LAYER (async)
// ────────────────────────────────────────────
let db = null;      // pg Pool when using PostgreSQL
let usePg = false;

async function initStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      // Database connection hardening: keep the pool bounded and fail slow/hung
      // database operations instead of allowing them to consume all server workers.
      // Neon/Postgres normally provides a trusted TLS certificate; an explicit
      // opt-out is available only when a deployment requires it.
      const sslConfig = String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'false'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true };
      db = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: sslConfig,
        max: 10,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        query_timeout: 15000,
        statement_timeout: 15000,
        keepAlive: true
      });
      await db.query(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
await db.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS universities (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS subscribers (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS referral_links (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS payouts (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      usePg = true;
      console.log('Storage: PostgreSQL connected.');
      return;
    } catch (e) {
      db = null;
      usePg = false;
      // In production, never silently fall back from the persistent database to
      // local JSON storage. Render's filesystem is not a safe substitute for the
      // production database and a silent fallback could make writes appear to
      // succeed while the real data remains unchanged.
      if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
        console.error('FATAL: PostgreSQL is configured but unavailable:', e.message);
        process.exitCode = 1;
        throw e;
      }
      console.warn('PostgreSQL unavailable, using JSON files for local development:', e.message);
    }
  }
  console.log('Storage: JSON files in ./data (set DATABASE_URL to use PostgreSQL).');
}

/* ── Orders ── */
// Run a set of statements as one atomic transaction. All-or-nothing writes keep
// concurrent requests (gate scans, registrations, logins) from seeing half-
// finished table rewrites or wiping each other's data.
// Serialize JSON-storage read-modify-write cycles. In JSON-file mode every
// "read list → modify → write list" done concurrently can silently drop other
// requests' changes (last writer wins). The mutex guarantees one full cycle
// completes before the next starts. PG mode does not need this (row-level ops).
const jsonWriteLocks = new Map();
async function withJsonWriteLock(key, work) {
  const prev = jsonWriteLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(r => { release = r; });
  jsonWriteLocks.set(key, gate);
  await prev.catch(() => {});
  try {
    return await work();
  } finally {
    release();
    if (jsonWriteLocks.get(key) === gate) jsonWriteLocks.delete(key);
  }
}

async function withDbTransaction(work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* already aborted */ }
    throw e;
  } finally {
    client.release();
  }
}

async function readOrders() {
  if (usePg) {
    const r = await db.query('SELECT data FROM orders ORDER BY data->>\'createdAt\' DESC');
    return r.rows.map(row => row.data);
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'orders.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
async function writeOrders(orders) {
  if (usePg) {
    // Upsert the full list and delete only rows that disappeared, in ONE
    // transaction. The old DELETE-all + re-insert left the table empty for the
    // duration of the rewrite: concurrent scans/orders hit timeouts and a race
    // could permanently drop rows.
    const rows = orders
      .filter(o => o && o.orderId)
      .map(o => [String(o.orderId), JSON.stringify(o)]);
    await withDbTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += 250) {
        const chunk = rows.slice(i, i + 250);
        const values = [];
        const params = [];
        chunk.forEach((r, j) => {
          const b = j * 2;
          values.push('($' + (b + 1) + ', $' + (b + 2) + '::jsonb)');
          params.push(r[0], r[1]);
        });
        await client.query(
          'INSERT INTO orders (id, data) VALUES ' + values.join(', ') +
          ' ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
          params
        );
      }
      if (rows.length) await client.query('DELETE FROM orders WHERE NOT (id = ANY($1::text[]))', [rows.map(r => r[0])]);
      else await client.query('DELETE FROM orders');
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify(orders, null, 2), 'utf8');
}
async function getOrder(orderId) {
  if (usePg) {
    const r = await db.query('SELECT data FROM orders WHERE id = $1', [orderId]);
    return r.rows.length ? r.rows[0].data : null;
  }
  const orders = await readOrders();
  return orders.find(o => o.orderId === orderId) || null;
}
async function addOrder(order) {
  if (usePg) {
    // Create only this order. Do NOT rewrite/delete the entire orders table.
    // This avoids a checkout failure caused by unrelated existing orders.
    await db.query(
      'INSERT INTO orders (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [order.orderId, JSON.stringify(order)]
    );
    const saved = await getOrder(order.orderId);
    if (!saved) throw new Error('Order could not be saved to PostgreSQL.');
    return saved;
  }
  const orders = await readOrders();
  orders.unshift(order);
  await writeOrders(orders);
  return order;
}
async function patchOrder(orderId, patch) {
  if (usePg) {
    // Update ONLY this order's row, locked so concurrent gate scans cannot
    // overwrite each other. The old path rewrote the whole orders table on
    // every scan, which held locks, queued every other request behind it, and
    // made check-in time out during busy periods.
    return withDbTransaction(async (client) => {
      const cur = await client.query('SELECT data FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!cur.rows.length) return null;
      const updated = Object.assign({}, cur.rows[0].data, patch);
      await client.query('UPDATE orders SET data = $2::jsonb, updated_at = NOW() WHERE id = $1', [orderId, JSON.stringify(updated)]);
      return updated;
    });
  }
  const orders = await withJsonWriteLock('orders', async () => {
    const orders = await readOrders();
    const idx = orders.findIndex(o => o.orderId === orderId);
    if (idx === -1) return null;
    orders[idx] = Object.assign({}, orders[idx], patch);
    await writeOrders(orders);
    return orders[idx];
  });
  return orders;
}

/* ── Coupons ── */
/* ── Payout requests (Influencer Admin commissions) ── */
const PAYOUT_METHODS = {
  '7_days': { label: 'Every 7 days', description: 'Payout cycle: every 7 days' },
  '14_days': { label: 'Every 14 days', description: 'Payout cycle: every 14 days' },
  'after_event': { label: 'After event day', description: 'Payout after the event day' }
};const PAYOUT_STATUSES = ['pending','approved','paid','rejected'];

// ── How a verified ticket payment is split ──
// A sale made through an influencer's referral link:
//   2.5%  → Unisocials      (the platform fee, instead of the usual 20%)
//   20%   → the influencer (20% of the FULL ticket, not of the remainder)
//   77.5% → the event owner
// A sale with no link used:
//   20% → Unisocials
//   80% → the event owner
// Both branches total 100%. The event owner is credited 97.5% of a referred
// sale and 80% of a direct one, and withdraws what is left after the
// influencer's 20% is allocated out of their credit — 77.5% referred, 80%
// direct. The event's Influencer Admin is the one who pays that commission to
// their referrer.
const PLATFORM_FEE_REFERRED = 0.025;
const PLATFORM_FEE_DIRECT = 0.20;
const INFLUENCER_COMMISSION_RATE = 0.20;
// A direct sale still pays the owner 80%. On a referred sale the owner nets
// 77.5% (97.5% credited less the influencer's 20%), which falls out of
// commissionSplit rather than being stored separately.
const EVENT_OWNER_RATE = 0.80;
const EVENT_OWNER_RATE_REFERRED = 1 - PLATFORM_FEE_REFERRED - INFLUENCER_COMMISSION_RATE;
// What the event owner is CREDITED with before any referrer allocation:
// 97.5% of a referred sale, 80% of a direct one.
const OWNER_CREDIT_REFERRED = 1 - PLATFORM_FEE_REFERRED;
const OWNER_CREDIT_DIRECT = 1 - PLATFORM_FEE_DIRECT;
// Neither the owner's share nor the influencer's 20% is deducted again at
// payout: both platform fees are already taken from the ticket itself.
const PAYOUT_FEE_RATE = 0;
// Payments made through the site mature for 7 days before they can be
// requested as a withdrawal.
const PAYOUT_HOLD_DAYS = 7;
const PAYOUT_HOLD_MS = PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000;

// Split one payment. `referred` decides which platform fee applies, and the
// influencer's share is always 20% of the FULL amount. The platform fee is
// taken off the top, then the influencer's commission is allocated out of what
// the owner was credited, so the parts always add back up to the gross.
function commissionSplit(amount, referred) {
  const gross = Math.max(0, Number(amount) || 0);
  const round2 = n => Math.round(n * 100) / 100;
  const isReferred = referred === true;
  const platformRate = isReferred ? PLATFORM_FEE_REFERRED : PLATFORM_FEE_DIRECT;
  const influencerAmount = isReferred ? round2(gross * INFLUENCER_COMMISSION_RATE) : 0;
  const platformAmount = round2(gross * platformRate);
  const ownerCreditAmount = round2(gross - platformAmount);
  return {
    referred: isReferred,
    platformRate,
    influencerRate: INFLUENCER_COMMISSION_RATE,
    ownerCreditAmount,
    influencerAmount,
    ownerNetAmount: round2(ownerCreditAmount - influencerAmount),
    platformAmount
  };
}

// Aggregate referred and direct payments into one split.
// Render a rate as a percentage label. Rounding kept hiding small halves.
// into "18%", so keep one decimal and drop it when the rate is a whole number.
function rateLabel(rate) {
  const pct = (Number(rate) || 0) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return (Math.abs(rounded - Math.round(rounded)) < 0.001 ? String(Math.round(rounded)) : String(rounded)) + '%';
}

function commissionTotals(referredAmount, directAmount) {
  const referred = commissionSplit(referredAmount, true);
  const direct = commissionSplit(directAmount, false);
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  return {
    referredAmount: round2(referredAmount),
    directAmount: round2(directAmount),
    grossAmount: round2(referredAmount + directAmount),
    ownerCreditAmount: round2(referred.ownerCreditAmount + direct.ownerCreditAmount),
    influencerAmount: round2(referred.influencerAmount + direct.influencerAmount),
    ownerNetAmount: round2(referred.ownerNetAmount + direct.ownerNetAmount),
    platformAmount: round2(referred.platformAmount + direct.platformAmount)
  };
}

// The headline rates, for the dashboards and the emails. The owner's rate
// depends on whether a referral link was used, so both are published rather
// than a single figure that would be wrong half the time.
const COMMISSION_SPLIT = {
  eventOwner: EVENT_OWNER_RATE,
  eventOwnerReferred: EVENT_OWNER_RATE_REFERRED,
  influencer: INFLUENCER_COMMISSION_RATE,
  platformReferred: PLATFORM_FEE_REFERRED,
  platformDirect: PLATFORM_FEE_DIRECT,
  ownerCreditReferred: OWNER_CREDIT_REFERRED,
  ownerCreditDirect: OWNER_CREDIT_DIRECT
};

// Every verified payment sits on a 7-day hold before its share becomes
// withdrawable. One definition of that rule, so the owner, the referrer and the
// site-wide admin view all count down to the same unlock moment.
function collectHeldPayments(orders, matches, shareOf) {
  const nowMs = Date.now();
  const isMine = matches || function () { return true; };
  const share = shareOf || function (amount) { return amount; };
  const held = [];
  (orders || []).forEach(o => {
    if (String(o.status || '').toLowerCase() !== 'verified') return;
    if (!isMine(o)) return;
    const amount = Number(o.amount) || 0;
    const referred = !!String(o.referralCode || '').trim();
    const paidMs = Date.parse(o.paymentReceivedAt || o.verifiedAt || o.createdAt || '');
    if (!Number.isFinite(paidMs)) return;
    const unlocksMs = paidMs + PAYOUT_HOLD_MS;
    if (nowMs >= unlocksMs) return;
    held.push({
      orderId: o.orderId || '',
      eventName: o.eventName || '',
      amount,
      referred,
      commissionAmount: Math.round((Number(share(amount, referred)) || 0) * 100) / 100,
      paidAt: new Date(paidMs).toISOString(),
      unlocksAt: new Date(unlocksMs).toISOString()
    });
  });
  held.sort((a, b) => new Date(a.unlocksAt) - new Date(b.unlocksAt));
  return held;
}

// ── Payout requests: who may withdraw what ──
// The event owner withdraws their 77.5% on a referred sale (97.5% credited,
// to the referrer). The INFLUENCER who owns the referral code withdraws their
// less the 20% allocated to the referrer) and 80% on a direct one. The referrer
// withdraws their own 20% of the full ticket. Both are separate requests paid from the same
// verified payment, and neither is deducted twice.

// Validate a payout request body. Shared by the referrer and the legacy
// Influencer Admin flow so both enforce exactly the same rules.
function parsePayoutRequestBody(body) {
  let data = {};
  try { data = JSON.parse(body || '{}'); } catch (e) {}
  const amount = Math.round(Number(data.amount) * 100) / 100;
  const payoutMethod = String(data.payoutMethod || '').trim();
  const note = String(data.note || '').trim().slice(0, 500);
  const bank = data.bank || {};
  const bankName = String(bank.bankName || '').trim();
  const accountNumber = String(bank.accountNumber || '').replace(/[\s-]/g, '');
  const accountName = String(bank.accountName || '').trim().toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter the payout amount you are requesting.' };
  if (!PAYOUT_METHODS[payoutMethod]) return { error: 'Choose a payment schedule: every 7 days, every 14 days, or after event day.' };
  if (!bankName) return { error: 'Bank name is required.' };
  if (!/^\d{10}$/.test(accountNumber)) return { error: 'Enter a valid 10-digit Nigerian bank account number.' };
  if (!accountName) return { error: 'Bank account name is required.' };
  return { amount, payoutMethod, note, bank: { bankName, accountNumber, accountName } };
}

// Build and store a payout request for a session user. The same records, the
// same admin approve/pay endpoints and the same emails are used for every role;
// only who may request, and against which balance, differs.
async function storePayoutRequest(user, parsed, extra) {
  const { amount, payoutMethod, note, bank } = parsed;
  // No further deduction: the platform fee (2.5% referred / 20% direct) was
  // already taken from the ticket itself, not from this share.
  const fee = payoutFeeSplit({ amount });
  const payout = {
    id: 'PAY-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    requestedBy: user.id,
    requesterRole: user.role || '',
    requesterName: user.name || '',
    requesterEmail: user.email || '',
    // Snapshot the real inbox so a completion email reaches them even if
    // their profile is edited later. The login is @unisocials.com and
    // cannot receive mail, so this is the only usable address.
    requesterContactEmail: isInternalLoginEmail(user.contactEmail) ? '' : String(user.contactEmail || '').trim().toLowerCase(),
    amount,
    feeRate: fee.feeRate,
    feeAmount: fee.feeAmount,
    netAmount: fee.netAmount,
    payoutMethod,
    bank,
    note,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    paidAt: null,
    reviewedBy: null,
    adminNote: ''
  };
  // A referrer's commission is paid by the Influencer Admin of the event, so
  // stamp the owners who are allowed to release it. Without this a payout could
  // be approved by whoever happened to be signed in.
  if (extra && Array.isArray(extra.eventOwnerIds) && extra.eventOwnerIds.length) {
    payout.eventOwnerIds = extra.eventOwnerIds.map(String);
  }
  await addPayoutRequest(payout);

  // Remember the bank account so the next request prefills it.
  try {
    const fresh = await findUserById(user.id);
    if (fresh) {
      fresh.payoutBankAccount = bank;
      await replaceUser(fresh);
    }
  } catch (e) { /* non-fatal */ }
  return payout;
}

// Turn an earned total into the balance a request may draw from: only the
// matured share, less everything already requested.
function payoutBalance(earned, held, payouts) {
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const matured = round2(Math.max(0, earned - held));
  const committed = round2(payouts
    .filter(p => ['pending', 'approved', 'paid'].includes(String(p.status || '').toLowerCase()))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  return {
    earned: round2(earned),
    held: round2(held),
    matured,
    committed,
    availableBalance: round2(Math.max(0, matured - committed))
  };
}

// Save the real inbox payout notifications go to, and re-send the completion
// notice for anything already paid before that address was on file.
async function savePayoutNotificationEmail(userId, notificationEmail) {
  const fresh = await findUserById(userId);
  if (!fresh) return { status: 404, error: 'Account not found' };
  fresh.contactEmail = notificationEmail;
  await replaceUser(fresh);

  const mine = (await readPayouts())
    .filter(p => String(p.requestedBy) === String(userId) && String(p.status || '').toLowerCase() === 'paid')
    .sort((a, b) => new Date(b.paidAt || b.createdAt) - new Date(a.paidAt || a.createdAt));
  let resent = 0;
  for (const p of mine) {
    if (p.notifiedEmail) break;
    const sent = await sendPayoutStatusEmailToRequester(p);
    if (!sent) break;
    await updatePayoutRequest(p.id, { notifiedEmail: notificationEmail, notifiedAt: new Date().toISOString() });
    resent++;
  }
  return { user: fresh, resent };
}

// Gross → fee → net split for a payout request. The rate is stored on each
// request: new payouts carry 0% because the platform fee (2.5% referred / 20%
// direct) was already taken from the ticket, while anything requested under the
// old model keeps showing the rate it was actually made with.
function payoutFeeSplit(p) {
  const gross = Math.max(0, Number(p && p.amount) || 0);
  const rateNum = Number(p && p.feeRate);
  const rate = Number.isFinite(rateNum) ? rateNum : PAYOUT_FEE_RATE;
  let fee = Number(p && p.feeAmount);
  if (!Number.isFinite(fee)) fee = Math.round(gross * rate * 100) / 100;
  let net = Number(p && p.netAmount);
  if (!Number.isFinite(net)) net = Math.round((gross - fee) * 100) / 100;
  return { feeRate: rate, feeAmount: fee, netAmount: net };
}

function payoutPublic(p) {
  if (!p) return null;
  const fee = payoutFeeSplit(p);
  return {
    id: p.id,
    requestedBy: p.requestedBy,
    requesterName: p.requesterName || '',
    requesterEmail: p.requesterEmail || '',
    // 'influencer' = the referrer withdrawing their 20% commission. Older
    // records have no role stored, so fall back to the requester itself.
    requesterRole: p.requesterRole || '',
    // The Influencer Admins allowed to release a referrer's commission: the
    // owners of the events the referrer's links point at.
    eventOwnerIds: Array.isArray(p.eventOwnerIds) ? p.eventOwnerIds.map(String) : [],
    // The real, receivable inbox the requester gave on their account form.
    requesterContactEmail: p.requesterContactEmail || '',
    // False means no completion email can be delivered for this payout: neither
    // the snapshotted contact email nor the requester email is a real inbox.
    notifiable: !isInternalLoginEmail(p.requesterContactEmail) || !isInternalLoginEmail(p.requesterEmail),
    // Proof of delivery for the completion email the requester sees.
    notifiedEmail: p.notifiedEmail || '',
    notifiedAt: p.notifiedAt || null,
    amount: Number(p.amount) || 0,
    feeRate: fee.feeRate,
    feeAmount: fee.feeAmount,
    netAmount: fee.netAmount,
    // The rates this request sits in, so the admin and sub-admin
    // dashboards can show the whole picture next to the payout itself.
    commissionRates: COMMISSION_SPLIT,
    influencerRate: COMMISSION_SPLIT.influencer,
    eventOwnerRate: COMMISSION_SPLIT.eventOwner,
    payoutMethod: p.payoutMethod,
    payoutMethodLabel: (PAYOUT_METHODS[p.payoutMethod] || {}).label || p.payoutMethod,
    bankName: p.bank ? p.bank.bankName : '',
    accountNumber: p.bank ? p.bank.accountNumber : '',
    accountName: p.bank ? p.bank.accountName : '',
    status: p.status,
    note: p.note || '',
    adminNote: p.adminNote || '',
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt || null,
    paidAt: p.paidAt || null,
    paymentDueBy: p.paymentDueBy || null,
    reviewedBy: p.reviewedBy || ''
  };
}

async function readPayouts() {
  if (usePg) {
    const r = await db.query('SELECT data FROM payouts ORDER BY created_at DESC');
    return r.rows.map(row => row.data);
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'payouts.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
async function writePayouts(payouts) {
  if (usePg) {
    const rows = payouts
      .filter(p => p && p.id)
      .map(p => [String(p.id), JSON.stringify(p)]);
    await withDbTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += 250) {
        const chunk = rows.slice(i, i + 250);
        const values = [];
        const params = [];
        chunk.forEach((r, j) => {
          const b = j * 2;
          values.push('($' + (b + 1) + ', $' + (b + 2) + '::jsonb)');
          params.push(r[0], r[1]);
        });
        await client.query(
          'INSERT INTO payouts (id, data) VALUES ' + values.join(', ') +
          ' ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
          params
        );
      }
      if (rows.length) await client.query('DELETE FROM payouts WHERE NOT (id = ANY($1::text[]))', [rows.map(r => r[0])]);
      else await client.query('DELETE FROM payouts');
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'payouts.json'), JSON.stringify(payouts, null, 2), 'utf8');
}
async function addPayoutRequest(payout) {
  if (usePg) {
    await db.query(
      'INSERT INTO payouts (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
      [payout.id, JSON.stringify(payout)]
    );
    return;
  }
  await withJsonWriteLock('payouts', async () => {
    const payouts = await readPayouts();
    payouts.unshift(payout);
    await writePayouts(payouts);
  });
}
async function updatePayoutRequest(id, patch) {
  if (usePg) {
    return withDbTransaction(async (client) => {
      const cur = await client.query('SELECT data FROM payouts WHERE id = $1 FOR UPDATE', [id]);
      if (!cur.rows.length) return null;
      const updated = Object.assign({}, cur.rows[0].data, patch);
      await client.query('UPDATE payouts SET data = $2::jsonb WHERE id = $1', [id, JSON.stringify(updated)]);
      return updated;
    });
  }
  return withJsonWriteLock('payouts', async () => {
    const payouts = await readPayouts();
    const idx = payouts.findIndex(p => p.id === id);
    if (idx === -1) return null;
    payouts[idx] = Object.assign({}, payouts[idx], patch);
    await writePayouts(payouts);
    return payouts[idx];
  });
}

async function readCoupons() {
  if (usePg) {
    const r = await db.query('SELECT data FROM coupons ORDER BY created_at DESC');
    return r.rows.map(row => row.data);
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'coupons.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
async function writeCoupons(coupons) {
  if (usePg) {
    const rows = coupons
      .filter(c => c && c.id)
      .map(c => [String(c.id), JSON.stringify(c)]);
    await withDbTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += 250) {
        const chunk = rows.slice(i, i + 250);
        const values = [];
        const params = [];
        chunk.forEach((r, j) => {
          const b = j * 2;
          values.push('($' + (b + 1) + ', $' + (b + 2) + '::jsonb)');
          params.push(r[0], r[1]);
        });
        await client.query(
          'INSERT INTO coupons (id, data) VALUES ' + values.join(', ') +
          ' ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
          params
        );
      }
      if (rows.length) await client.query('DELETE FROM coupons WHERE NOT (id = ANY($1::text[]))', [rows.map(r => r[0])]);
      else await client.query('DELETE FROM coupons');
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'coupons.json'), JSON.stringify(coupons, null, 2), 'utf8');
}
async function getCouponByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  const coupons = await readCoupons();
  return coupons.find(c => String(c.code || '').toUpperCase() === normalized && c.active !== false) || null;
}
async function getCouponById(id) {
  const coupons = await readCoupons();
  return coupons.find(c => String(c.id) === String(id)) || null;
}

/* ── Users ── */
async function readUsers() {
  if (usePg) {
    const r = await db.query('SELECT data FROM users');
    return r.rows.map(row => row.data);
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
async function writeUsers(users) {
  if (usePg) {
    // Upsert all + delete only rows that disappeared, in ONE transaction.
    // The old DELETE FROM users wiped every account for the whole rewrite:
    // a login landing in that window failed, and a racing read-modify-write
    // could permanently drop newly created staff/influencer accounts, which
    // made their logins report "Invalid email or password" forever.
    const rows = users
      .filter(u => u && u.id && u.email)
      .map(u => [String(u.id), String(u.email), JSON.stringify(u)]);
    await withDbTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += 250) {
        const chunk = rows.slice(i, i + 250);
        const values = [];
        const params = [];
        chunk.forEach((r, j) => {
          const b = j * 3;
          values.push('($' + (b + 1) + ', $' + (b + 2) + ', $' + (b + 3) + '::jsonb)');
          params.push(r[0], r[1], r[2]);
        });
        await client.query(
          'INSERT INTO users (id, email, data) VALUES ' + values.join(', ') +
          ' ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data',
          params
        );
      }
      if (rows.length) await client.query('DELETE FROM users WHERE NOT (id = ANY($1::text[]))', [rows.map(r => r[0])]);
      else await client.query('DELETE FROM users');
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2), 'utf8');
}
async function findUserByEmail(email) {
  const users = await readUsers();
  return users.find(u => u.email.toLowerCase() === String(email).toLowerCase()) || null;
}
async function findUserById(id) {
  const users = await readUsers();
  return users.find(u => u.id === id) || null;
}
async function addUser(user) {
  if (usePg) {
    // Insert only this user's row. The old read-all → rewrite-all path raced
    // with concurrent logins/registrations and silently dropped the new
    // account, so freshly created check-in staff and influencers could never
    // sign in even though creation reported success.
    await db.query(
      'INSERT INTO users (id, email, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data',
      [user.id, user.email, JSON.stringify(user)]
    );
    return;
  }
  await withJsonWriteLock('users', async () => {
    const users = await readUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx === -1) users.push(user);
    else users[idx] = user;
    await writeUsers(users);
  });
}
// Update one account in place (single-row upsert in PG mode). Never rewrites
// unrelated accounts, so concurrent logins/registrations cannot be lost.
async function replaceUser(user) {
  if (usePg) {
    await db.query(
      'INSERT INTO users (id, email, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data',
      [user.id, user.email, JSON.stringify(user)]
    );
    return;
  }
  await withJsonWriteLock('users', async () => {
    const users = await readUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx === -1) users.push(user);
    else users[idx] = user;
    await writeUsers(users);
  });
}
// Remove one account by id (single-row delete in PG mode).
async function deleteUserById(id) {
  if (usePg) {
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    return;
  }
  await withJsonWriteLock('users', async () => {
    const users = await readUsers();
    await writeUsers(users.filter(u => u.id !== id));
  });
}

/* ── Influencer ↔ Influencer Admin relationships ── */
// One influencer account can have multiple independent IA relationships.
// Referral codes remain separate and will be attached in Step 4.
function normalizeInfluencerAssignments(influencer) {
  if (!influencer || influencer.role !== 'influencer') return [];
  const existing = Array.isArray(influencer.influencerAssignments) ? influencer.influencerAssignments : [];
  const out = [];
  const seen = new Set();
  for (const a of existing) {
    const adminId = String(a && (a.influencerAdminId || a.adminId || '')).trim();
    if (!adminId || seen.has(adminId)) continue;
    const status = ['pending','accepted','rejected'].includes(String(a.status || '').toLowerCase()) ? String(a.status).toLowerCase() : 'accepted';
    out.push({
      id: String(a.id || ('IA-ASSIGN-' + crypto.randomBytes(6).toString('hex').toUpperCase())),
      influencerAdminId: adminId,
      status,
      requestedAt: a.requestedAt || a.createdAt || new Date().toISOString(),
      acceptedAt: status === 'accepted' ? (a.acceptedAt || a.requestedAt || a.createdAt || new Date().toISOString()) : (a.acceptedAt || null),
      rejectedAt: status === 'rejected' ? (a.rejectedAt || new Date().toISOString()) : (a.rejectedAt || null),
      legacy: a.legacy === true
    });
    seen.add(adminId);
  }

  // Migrate the current single-admin ownership fields into one accepted
  // relationship so existing influencers continue working unchanged.
  const legacyAdminId = String(
    influencer.assignedInfluencerAdminId || influencer.influencerAdminId || influencer.ownerInfluencerAdminId ||
    (typeof influencer.createdBy === 'string' ? influencer.createdBy : (influencer.createdBy && influencer.createdBy.id)) || ''
  ).trim();
  if (legacyAdminId && !seen.has(legacyAdminId)) {
    out.push({
      id: 'IA-ASSIGN-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
      influencerAdminId: legacyAdminId,
      status: 'accepted',
      requestedAt: influencer.createdAt || new Date().toISOString(),
      acceptedAt: influencer.createdAt || new Date().toISOString(),
      rejectedAt: null,
      legacy: true
    });
  }
  return out;
}

function getInfluencerAssignments(influencer) { return normalizeInfluencerAssignments(influencer); }
function getAcceptedInfluencerAssignments(influencer) { return getInfluencerAssignments(influencer).filter(a => a.status === 'accepted'); }
function influencerHasAdminAssignment(influencer, influencerAdminId, statuses = ['accepted']) {
  const adminId = String(influencerAdminId || '').trim();
  return !!adminId && getInfluencerAssignments(influencer).some(a => a.influencerAdminId === adminId && statuses.includes(a.status));
}

async function migrateInfluencerAssignments() {
  const users = await readUsers();
  let changed = false;
  const migrated = users.map(user => {
    if (!user || user.role !== 'influencer') return user;
    const before = Array.isArray(user.influencerAssignments) ? JSON.stringify(user.influencerAssignments) : '';
    const assignments = normalizeInfluencerAssignments(user);
    if (before !== JSON.stringify(assignments)) {
      changed = true;
      return Object.assign({}, user, { influencerAssignments: assignments });
    }
    return user;
  });
  if (changed) await writeUsers(migrated);
  return migrated;
}

// Step 4 migration: attach existing influencer referral records to their
// accepted relationship when possible, without changing existing codes.
async function migrateInfluencerReferralLinks() {
  const [users, links] = await Promise.all([readUsers(), readReferralLinks()]);
  let changed = false;
  for (const link of links) {
    const influencerId = String(link.influencerId || '').trim();
    if (!influencerId || link.assignmentId) continue;
    const influencer = users.find(u => String(u.id || '') === influencerId && u.role === 'influencer');
    if (!influencer) continue;
    const accepted = getAcceptedInfluencerAssignments(influencer);
    const originalAdminId = String(
      link.influencerAdminId || influencer.assignedInfluencerAdminId || influencer.influencerAdminId ||
      influencer.ownerInfluencerAdminId ||
      (typeof influencer.createdBy === 'string' ? influencer.createdBy : (influencer.createdBy && influencer.createdBy.id)) || ''
    ).trim();
    const originalAssignment = accepted.find(a => String(a.influencerAdminId || '').trim() === originalAdminId) ||
      (accepted.length === 1 ? accepted[0] : null);
    if (originalAssignment) {
      link.assignmentId = originalAssignment.id;
      link.influencerAdminId = originalAssignment.influencerAdminId;
      link.legacyScoped = true;
      if (!link.ownerRole || link.ownerRole === 'subadmin') link.ownerRole = 'influencer';
      link.subadminId = null;
      link.subadminName = null;
      link.subadminEmail = null;
      link.influencerName = link.influencerName || influencer.name || '';
      link.influencerEmail = link.influencerEmail || influencer.email || '';
      changed = true;
    }
  }
  if (changed) await writeReferralLinks(links);
  return links;
}

/* ── Sessions ── */
async function readSessions() {
  if (usePg) {
    const r = await db.query('SELECT token, user_id FROM sessions');
    const out = {};
    r.rows.forEach(row => { out[row.token] = row.user_id; });
    return out;
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'sessions.json'), 'utf8');
    return JSON.parse(raw) || {};
  } catch (e) { return {}; }
}
async function writeSessions(sessions) {
  if (usePg) {
    // Same atomic upsert + delete-missing pattern so a rewrite can never
    // briefly erase live sessions and log everyone out.
    const entries = Object.entries(sessions);
    await withDbTransaction(async (client) => {
      for (let i = 0; i < entries.length; i += 250) {
        const chunk = entries.slice(i, i + 250);
        const values = [];
        const params = [];
        chunk.forEach(([token, userId], j) => {
          const b = j * 2;
          values.push('($' + (b + 1) + ', $' + (b + 2) + ')');
          params.push(token, userId);
        });
        await client.query(
          'INSERT INTO sessions (token, user_id) VALUES ' + values.join(', ') +
          ' ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id',
          params
        );
      }
      if (entries.length) await client.query('DELETE FROM sessions WHERE NOT (token = ANY($1::text[]))', [entries.map(([t]) => t)]);
      else await client.query('DELETE FROM sessions');
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'sessions.json'), JSON.stringify(sessions, null, 2), 'utf8');
}
async function createSession(token, userId) {
  if (usePg) {
    // Do not rewrite the entire sessions table. A full DELETE + INSERT cycle
    // can race with another login/logout and accidentally remove a live session.
    await db.query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, created_at = NOW()', [token, userId]);
    return;
  }
  const sessions = await readSessions();
  sessions[token] = userId;
  await writeSessions(sessions);
  // Keep creation times separately so existing JSON session format remains compatible.
  const metaPath = path.join(DATA_DIR, 'session-meta.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {}; } catch (e) {}
  meta[token] = Date.now();
  fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
}
async function getSessionUser(token) {
  if (!token) return null;
  if (usePg) {
    const r = await db.query("SELECT user_id FROM sessions WHERE token = $1 AND created_at > NOW() - INTERVAL '7 days' LIMIT 1", [token]);
    if (!r.rows.length) {
      // Expired sessions are removed so a stolen token cannot be reused indefinitely.
      await db.query('DELETE FROM sessions WHERE token = $1', [token]).catch(() => {});
      return null;
    }
    const user = await findUserById(r.rows[0].user_id);
    return user && user.archived === true ? null : user;
  }
  const sessions = await readSessions();
  const userId = sessions[token];
  if (!userId) return null;
  const metaPath = path.join(DATA_DIR, 'session-meta.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {}; } catch (e) {}
  const createdAt = Number(meta[token] || 0);
  if (!createdAt || Date.now() - createdAt > SESSION_MAX_AGE_MS) {
    delete sessions[token];
    delete meta[token];
    await writeSessions(sessions);
    try { fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8'); } catch (e) {}
    return null;
  }
  const user = await findUserById(userId);
  return user && user.archived === true ? null : user;
}
async function deleteSession(token) {
  if (!token) return;
  if (usePg) {
    await db.query('DELETE FROM sessions WHERE token = $1', [token]);
    return;
  }
  const sessions = await readSessions();
  delete sessions[token];
  await writeSessions(sessions);
  const metaPath = path.join(DATA_DIR, 'session-meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {};
    delete meta[token];
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
  } catch (e) {}
}
async function deleteUserSessions(userId) {
  if (usePg) {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return;
  }
  const sessions = await readSessions();
  const removed = [];
  for (const [t, uid] of Object.entries(sessions)) {
    if (uid === userId) { delete sessions[t]; removed.push(t); }
  }
  await writeSessions(sessions);
  const metaPath = path.join(DATA_DIR, 'session-meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {};
    removed.forEach(t => delete meta[t]);
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
  } catch (e) {}
}

/* ── Referral Links (subadmin referral tracking) ── */
async function readReferralLinks() {
  if (usePg) {
    const r = await db.query('SELECT data FROM referral_links');
    return r.rows.map(row => row.data);
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'referral_links.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
async function writeReferralLinks(links) {
  if (usePg) {
    // Keep the PostgreSQL table authoritative without deleting every referral
    // row on each update. The old DELETE+INSERT approach could erase or race
    // with another referral update and made statistics unreliable.
    for (const l of links) {
      await db.query(
        'INSERT INTO referral_links (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
        [l.code, JSON.stringify(l)]
      );
    }
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'referral_links.json'), JSON.stringify(links, null, 2), 'utf8');
}

async function writeReferralLink(link) {
  if (!link) return;
  if (usePg) {
    await db.query(
      'INSERT INTO referral_links (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
      [link.code, JSON.stringify(link)]
    );
    return;
  }
  const links = await readReferralLinks();
  const idx = links.findIndex(l => l.code === link.code);
  if (idx >= 0) links[idx] = link; else links.push(link);
  await writeReferralLinks(links);
}
async function getReferralLinkByCode(code) {
  const links = await readReferralLinks();
  return links.find(l => l.code === code) || null;
}
async function getReferralLinkByOwnerId(ownerId) {
  const links = await readReferralLinks();
  return links.find(l => l.ownerId === ownerId || l.subadminId === ownerId || l.influencerId === ownerId) || null;
}

// Backward-compatible helper for existing sub-admin referral records.
async function getReferralLinkBySubadminId(subadminId) {
  const links = await readReferralLinks();
  return links.find(l => l.subadminId === subadminId || l.ownerId === subadminId) || null;
}

// Backward-compatible helper for influencer referral records.
async function getReferralLinkByInfluencerId(influencerId) {
  const links = await readReferralLinks();
  return links.find(l => l.influencerId === influencerId || l.ownerId === influencerId) || null;
}
async function getReferralLinksByInfluencerId(influencerId) {
  const id = String(influencerId || '').trim();
  if (!id) return [];
  const links = await readReferralLinks();
  return links.filter(l => String(l.influencerId || l.ownerId || '').trim() === id);
}
async function getReferralLinkForAssignment(influencerId, assignmentId) {
  const links = await getReferralLinksByInfluencerId(influencerId);
  return links.find(l => String(l.assignmentId || '') === String(assignmentId || '')) || null;
}
function canonicalReferralUrl(code) {
  const safeCode = String(code || '').trim().toUpperCase();
  return safeCode ? ((process.env.SITE_URL || '').replace(/\/$/, '') + '/events.html?ref=' + encodeURIComponent(safeCode)) : '';
}

function referralLinkResponse(link) {
  if (!link) return null;
  return { ...link, referralUrl: canonicalReferralUrl(link.code) };
}
async function generateReferralLink(ownerId, ownerName, ownerEmail, ownerRole = 'subadmin', assignmentId = null, influencerAdminId = null) {
  const links = await readReferralLinks();
  // Sub-admins keep one stable global referral record. Influencers get one
  // separate code for each accepted Influencer Admin relationship.
  const existing = ownerRole === 'influencer' && assignmentId
    ? links.find(l => String(l.influencerId || l.ownerId || '') === String(ownerId) && String(l.assignmentId || '') === String(assignmentId))
    : ownerRole === 'influencer'
      ? links.find(l => String(l.influencerId || l.ownerId || '') === String(ownerId) && !l.assignmentId)
      : links.find(l => l.ownerId === ownerId || l.subadminId === ownerId);
  if (existing) return existing;

  // Generate a cryptographically strong unique code.
  let code = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  while (links.find(l => l.code === code)) {
    code = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }
  
  const link = {
    code: code,
    ownerId: ownerId,
    ownerRole: ownerRole,
    subadminId: ownerRole === 'subadmin' ? ownerId : null,
    influencerId: ownerRole === 'influencer' ? ownerId : null,
    subadminName: ownerRole === 'subadmin' ? ownerName : null,
    subadminEmail: ownerRole === 'subadmin' ? ownerEmail : null,
    influencerName: ownerRole === 'influencer' ? ownerName : null,
    influencerEmail: ownerRole === 'influencer' ? ownerEmail : null,
    assignmentId: ownerRole === 'influencer' ? (assignmentId || null) : null,
    influencerAdminId: ownerRole === 'influencer' ? (influencerAdminId || null) : null,
    createdAt: new Date().toISOString(),
    totalOrders: 0,
    totalRevenue: 0,
    uniquePeople: 0,
    totalTickets: 0
  };
  links.push(link);
  await writeReferralLinks(links);
  return link;
}
function isReferralOrderCounted(order, referralCode) {
  if (!order || order.referralCode !== referralCode) return false;
  const status = String(order.status || '').toLowerCase();
  // Only count verified (paid) orders for referral stats
  return status === 'verified';
}

// Influencer referral codes are scoped to the Influencer Admin who created the
// influencer. That admin must be authorized for the event (or own the event)
// before the code can be used. Sub-admin referral links are intentionally not
// subject to this rule because their referral model is global.
async function influencerReferralAuthorizedForEvent(referralLink, event) {
  if (!referralLink || !event) return false;

  const influencerId = String(referralLink.influencerId || referralLink.ownerId || '').trim();
  if (!influencerId) return true; // legacy/sub-admin referral link

  const users = await readUsers();
  const influencer = users.find(u => String(u.id || '').trim() === influencerId && u.role === 'influencer');
  if (!influencer) return false;

  // Step 5: relationship-scoped links must still belong to an ACTIVE
  // accepted relationship. Merely having influencerAdminId on the link is
  // not enough: a relationship may have been rejected after the link was
  // created, and that must immediately revoke the referral code.
  const authorizedIds = new Set(getAuthorizedInfluencerAdminIds(event));
  const assignment = getAcceptedInfluencerAssignments(influencer).find(a =>
    String(a.id || '') === String(referralLink.assignmentId || '')
  );
  if (!assignment) return false;
  const adminId = String(assignment.influencerAdminId || '').trim();
  return !!adminId && authorizedIds.has(adminId);
}

async function getScopedReferralOrders(referralLink, orders, events, scopedAdminId = null) {
  if (!referralLink) return [];
  const verifiedOrders = orders.filter(o => isReferralOrderCounted(o, referralLink.code));

  // Sub-admin/global referral links retain their existing global scope.
  const influencerId = String(referralLink.influencerId || referralLink.ownerId || '').trim();
  if (!influencerId) return verifiedOrders;

  const users = await readUsers();
  const influencer = users.find(u => String(u.id || '').trim() === influencerId && u.role === 'influencer');
  if (!influencer) return [];

  let ownerAdminId = String(scopedAdminId || '').trim();
  if (!ownerAdminId) ownerAdminId = String(referralLink.influencerAdminId || '').trim();
  if (referralLink.assignmentId && referralLink.influencerAdminId && ownerAdminId !== String(referralLink.influencerAdminId).trim()) return [];
  if (!ownerAdminId) return verifiedOrders;

  return verifiedOrders.filter(order => {
    const event = events.find(ev => eventMatchesOrder(order, ev));
    if (!event) return false;
    return getAuthorizedInfluencerAdminIds(event).includes(ownerAdminId);
  });
}

async function updateReferralStats(referralCode) {
  if (!referralCode) return;
  const links = await readReferralLinks();
  const link = links.find(l => l.code === referralCode);
  if (!link) return;
  
  const [orders, events] = await Promise.all([readOrders(), readEvents()]);
  const referredOrders = await getScopedReferralOrders(link, orders, events);
  
  link.totalOrders = referredOrders.length;
  link.totalRevenue = referredOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  link.totalTickets = referredOrders.reduce((sum, o) => sum + (parseInt(o.qty, 10) || 0), 0);
  link.uniquePeople = new Set(
    referredOrders
      .map(o => String(o.buyerEmail || '').trim().toLowerCase())
      .filter(Boolean)
  ).size;

  console.log(`updateReferralStats: code=${referralCode} orders=${link.totalOrders} tickets=${link.totalTickets} people=${link.uniquePeople} revenue=${link.totalRevenue}`);
  await writeReferralLink(link);
}

async function refreshReferralStatsForVerifiedOrder(order, previousStatus) {
  const referralCode = String(order && order.referralCode ? order.referralCode : '').trim();
  const currentStatus = String(order && order.status ? order.status : '').toLowerCase();
  const prevStatus = String(previousStatus || '').toLowerCase();

  console.log(`refreshReferralStatsForVerifiedOrder called - code=${referralCode} prev=${prevStatus} current=${currentStatus}`);

  if (!referralCode) return;
  if (currentStatus !== 'verified') return;
  if (prevStatus === 'verified') return;

  await updateReferralStats(referralCode);
  console.log(`refreshReferralStatsForVerifiedOrder completed for code=${referralCode}`);
}

/* ── Events (admin-managed catalog shown on client pages) ── */
const DEFAULT_EVENTS = [];

async function readEvents() {
  if (usePg) {
    const r = await db.query("SELECT data FROM events ORDER BY data->>'date' ASC");
    return r.rows.map(row => row.data);
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'events.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function getAuthorizedInfluencerAdminIds(ev) {
  const ids = Array.isArray(ev && ev.authorizedInfluencerAdminIds) ? ev.authorizedInfluencerAdminIds : [];
  return ids.map(String).filter(Boolean);
}

function eventIdentifierMatches(event, eventId) {
  const requestedId = String(eventId || '').trim();
  if (!requestedId || !event) return false;
  return [event.id, event._id, event.eventId].some(id => String(id || '').trim() === requestedId);
}

function eventMatchesOrder(order, ev) {
  if (!order || !ev) return false;
  const oid = String(order.eventId || '').trim();
  const eid = String(ev.id || '').trim();
  if (oid && eid && oid === eid) return true;
  return String(order.eventName || '').trim().toLowerCase() === String(ev.name || '').trim().toLowerCase();
}

async function getOrdersForCurrentSiteEvents() {
  const [orders, events] = await Promise.all([readOrders(), readEvents()]);
  // Match orders against the live event catalog using every identifier the
  // site has historically used.  Do NOT require eventId to match when the
  // order also carries the event name: existing orders can legitimately have
  // an older/alternate event id while still belonging to the same event.
  const eventIds = new Set();
  const eventNames = new Set();
  events.forEach(e => {
    [e && e.id, e && e._id, e && e.eventId].forEach(v => {
      const id = String(v || '').trim();
      if (id) eventIds.add(id);
    });
    const name = String(e && (e.name || e.eventName) || '').trim().toLowerCase();
    if (name) eventNames.add(name);
  });
  return orders.filter(o => {
    const id = String(o && (o.eventId || o.event_id || o.eventID) || '').trim();
    const name = String(o && (o.eventName || o.event_name) || '').trim().toLowerCase();
    return (id && eventIds.has(id)) || (name && eventNames.has(name));
  });
}

async function writeEvents(events) {
  if (usePg) {
    const rows = events
      .filter(ev => ev && ev.id)
      .map(ev => [String(ev.id), JSON.stringify(ev)]);
    await withDbTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += 250) {
        const chunk = rows.slice(i, i + 250);
        const values = [];
        const params = [];
        chunk.forEach((r, j) => {
          const b = j * 2;
          values.push('($' + (b + 1) + ', $' + (b + 2) + '::jsonb)');
          params.push(r[0], r[1]);
        });
        await client.query(
          'INSERT INTO events (id, data) VALUES ' + values.join(', ') +
          ' ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
          params
        );
      }
      if (rows.length) await client.query('DELETE FROM events WHERE NOT (id = ANY($1::text[]))', [rows.map(r => r[0])]);
      else await client.query('DELETE FROM events');
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'events.json'), JSON.stringify(events, null, 2), 'utf8');
}
async function addEvent(ev) {
  const events = await readEvents();
  const idx = events.findIndex(e => e.id === ev.id);
  if (idx === -1) events.push(ev);
  else events[idx] = ev;
  await writeEvents(events);
  return ev;
}
async function deleteEvent(eventId) {
  const events = await readEvents();
  const next = events.filter(e => e.id !== eventId);
  if (next.length === events.length) return false;
  await writeEvents(next);
  return true;
}

/* ── Universities (multi-tenant) ── */
const UNI_CATEGORIES = ['Arts & Culture', 'Engineering', 'Business', 'Music', 'Academic', 'Sports', 'Medical', 'General'];

// Comprehensive list of universities across Nigeria (federal, state & private).
function uniDefaults() {
  const nowStamp = new Date().toISOString();
  const rows = [
    // ── Federal Universities ──
    ['unn', 'University of Nigeria, Nsukka', 'UNN', 'Nsukka', 'Enugu'],
    ['unilag', 'University of Lagos', 'UNILAG', 'Akoka', 'Lagos'],
    ['ui', 'University of Ibadan', 'UI', 'Ibadan', 'Oyo'],
    ['oau', 'Obafemi Awolowo University', 'OAU', 'Ile-Ife', 'Osun'],
    ['uniben', 'University of Benin', 'UNIBEN', 'Benin City', 'Edo'],
    ['abu', 'Ahmadu Bello University', 'ABU', 'Zaria', 'Kaduna'],
    ['unimaid', 'University of Maiduguri', 'UNIMAID', 'Maiduguri', 'Borno'],
    ['fuoye', 'Federal University Oye-Ekiti', 'FUOYE', 'Oye-Ekiti', 'Ekiti'],
    ['futo', 'Federal University of Technology, Owerri', 'FUTO', 'Owerri', 'Imo'],
    ['futminna', 'Federal University of Technology, Minna', 'FUT MINNA', 'Minna', 'Niger'],
    ['futa', 'Federal University of Technology, Akure', 'FUTA', 'Akure', 'Ondo'],
    ['eksu-federal', 'Federal University, Lokoja', 'FUL', 'Lokoja', 'Kogi'],
    ['fudutsinma', 'Federal University Dutsin-Ma', 'FUDMA', 'Dutsin-Ma', 'Katsina'],
    ['fud', 'Federal University Dutse', 'FUD', 'Dutse', 'Jigawa'],
    ['fuo', 'Federal University of Agriculture, Abeokuta', 'FUNAAB', 'Abeokuta', 'Ogun'],
    ['fumam', 'Federal University of Agriculture, Makurdi', 'FUAM', 'Makurdi', 'Benue'],
    ['unilokoja', 'Federal University, Lokoja', 'FULOKOJA', 'Lokoja', 'Kogi'],
    ['fugusau', 'Federal University, Gusau', 'FUGUS', 'Gusau', 'Zamfara'],
    ['fugashua', 'Federal University, Gashua', 'FUGASHUA', 'Gashua', 'Yobe'],
    ['fukashere', 'Federal University, Kashere', 'FUK', 'Kashere', 'Gombe'],
    ['funai', 'Federal University, Ndufu-Alike Ikwo', 'FUNAI', 'Ndufu-Alike', 'Ebonyi'],
    ['fuwukari', 'Federal University, Wukari', 'FUW', 'Wukari', 'Taraba'],
    ['fubirnin-kebbi', 'Federal University, Birnin Kebbi', 'FUBK', 'Birnin Kebbi', 'Kebbi'],
    ['fufuf', 'Federal University, Lafia', 'FULAFIA', 'Lafia', 'Nasarawa'],
    ['fuotas', 'Federal University, Otuoke', 'FUO', 'Otuoke', 'Bayelsa'],
    ['fudutsin', 'Federal University, Dutsin-Ma', 'FUDMA', 'Dutsin-Ma', 'Katsina'],
    ['unu', 'National Open University of Nigeria', 'NOUN', 'Lagos', 'Lagos'],
    ['university-of-calabar', 'University of Calabar', 'UNICAL', 'Calabar', 'Cross River'],
    ['uniport', 'University of Port Harcourt', 'UNIPORT', 'Port Harcourt', 'Rivers'],
    ['unijos', 'University of Jos', 'UNIJOS', 'Jos', 'Plateau'],
    ['unilorin', 'University of Ilorin', 'UNILORIN', 'Ilorin', 'Kwara'],
    ['unimaiden', 'University of Maiduguri', 'UNIMAID', 'Maiduguri', 'Borno'],
    ['unabuja', 'University of Abuja', 'UNIABUJA', 'Gwagwalada', 'FCT'],
    ['uniben2', 'University of Benin', 'UNIBEN', 'Benin City', 'Edo'],
    ['uniami', 'University of Uyo', 'UNIUYO', 'Uyo', 'Akwa Ibom'],
    ['unig', 'University of Ibadan', 'UI', 'Ibadan', 'Oyo'],
    ['unibayero', 'Bayero University Kano', 'BUK', 'Kano', 'Kano'],
    ['unimaid2', 'University of Maiduguri', 'UNIMAID', 'Maiduguri', 'Borno'],
    ['unizik', 'Nnamdi Azikiwe University', 'UNIZIK', 'Awka', 'Anambra'],
    ['unial', 'Alvan Ikoku Federal College of Education', 'AIFCE', 'Owerri', 'Imo'],
    // ── State Universities ──
    ['lasu', 'Lagos State University', 'LASU', 'Ojo', 'Lagos'],
    ['unilag-state', 'Lagos State University of Education', 'LASUED', 'Ijanikin', 'Lagos'],
    ['kaduna-state', 'Kaduna State University', 'KASU', 'Kaduna', 'Kaduna'],
    ['oun', 'Olabisi Onabanjo University', 'OOU', 'Ago-Iwoye', 'Ogun'],
    ['run', 'Rivers State University', 'RSU', 'Port Harcourt', 'Rivers'],
    ['ekiti-state', 'Ekiti State University', 'EKSU', 'Ado-Ekiti', 'Ekiti'],
    ['abia-state', 'Abia State University', 'ABSU', 'Uturu', 'Abia'],
    ['ndu', 'Niger Delta University', 'NDU', 'Amassoma', 'Bayelsa'],
    ['del-su', 'Delta State University', 'DELSU', 'Abraka', 'Delta'],
    ['enasu', 'Enugu State University of Science and Technology', 'ESUT', 'Enugu', 'Enugu'],
    ['imsu', 'Imo State University', 'IMSU', 'Owerri', 'Imo'],
    ['tasued', 'Tai Solarin University of Education', 'TASUED', 'Ijagun', 'Ogun'],
    ['ojukwu', 'Ondo State University of Science and Technology', 'OSUSTECH', 'Okitipupa', 'Ondo'],
    ['adekunle', 'Adekunle Ajasin University', 'AAUA', 'Akungba-Akoko', 'Ondo'],
    ['tarba', 'Taraba State University', 'TSU', 'Jalingo', 'Taraba'],
    ['yobe-state', 'Yobe State University', 'YSU', 'Damaturu', 'Yobe'],
    ['plateau-state', 'University of Jos', 'PLASU', 'Jos', 'Plateau'],
    ['kogi-state', 'Kogi State University', 'KSU', 'Anyigba', 'Kogi'],
    ['kwara-state', 'Kwara State University', 'KWASU', 'Malete', 'Kwara'],
    ['nassarawa-state', 'Nasarawa State University', 'NSUK', 'Keffi', 'Nasarawa'],
    ['sokoto-state', 'Usmanu Danfodiyo University', 'UDUS', 'Sokoto', 'Sokoto'],
    ['zamfara-state', 'Federal University, Gusau', 'FUGUS', 'Gusau', 'Zamfara'],
    ['borno-state', 'University of Maiduguri', 'UNIMAID', 'Maiduguri', 'Borno'],
    ['bauchi-state', 'Abubakar Tafawa Balewa University', 'ATBU', 'Bauchi', 'Bauchi'],
    ['gombe-state', 'Gombe State University', 'GSU', 'Gombe', 'Gombe'],
    ['adamawa-state', 'Modibbo Adama University', 'MAU', 'Yola', 'Adamawa'],
    ['katsina-state', 'Umaru Musa Yar\u2019Adua University', 'UMYU', 'Katsina', 'Katsina'],
    ['jigawa-state', 'Federal University Dutse', 'FUD', 'Dutse', 'Jigawa'],
    ['kebbi-state', 'Usmanu Danfodiyo University', 'UDUS', 'Sokoto', 'Sokoto'],
    ['benue-state', 'Benue State University', 'BSU', 'Makurdi', 'Benue'],
    ['cross-river-state', 'University of Calabar', 'UNICAL', 'Calabar', 'Cross River'],
    ['akwa-ibom-state', 'University of Uyo', 'UNIUYO', 'Uyo', 'Akwa Ibom'],
    ['ebonyi-state', 'Ebonyi State University', 'EBSU', 'Abakaliki', 'Ebonyi'],
    ['anambra-state', 'Nnamdi Azikiwe University', 'UNIZIK', 'Awka', 'Anambra'],
    ['bayelsa-state', 'Niger Delta University', 'NDU', 'Amassoma', 'Bayelsa'],
    ['edo-state', 'University of Benin', 'UNIBEN', 'Benin City', 'Edo'],
    ['ogun-state', 'Olabisi Onabanjo University', 'OOU', 'Ago-Iwoye', 'Ogun'],
    ['ondo-state', 'Adekunle Ajasin University', 'AAUA', 'Akungba-Akoko', 'Ondo'],
    ['osun-state', 'Osun State University', 'UNIOSUN', 'Osogbo', 'Osun'],
    ['oyo-state', 'Ladoke Akintola University of Technology', 'LAUTECH', 'Ogbomoso', 'Oyo'],
    // ── Private Universities ──
    ['covenant', 'Covenant University', 'CU', 'Ota', 'Ogun'],
    ['babcock', 'Babcock University', 'BU', 'Ilishan-Remo', 'Ogun'],
    ['bells', 'Bells University of Technology', 'BUT', 'Ota', 'Ogun'],
    ['bowen', 'Bowen University', 'BU', 'Iwo', 'Osun'],
    ['abuad', 'Afe Babalola University', 'ABUAD', 'Ado-Ekiti', 'Ekiti'],
    ['aau', 'Ajayi Crowther University', 'ACU', 'Oyo', 'Oyo'],
    ['acs', 'Achievers University', 'AU', 'Owo', 'Ondo'],
    ['american', 'American University of Nigeria', 'AUN', 'Yola', 'Adamawa'],
    ['baze', 'Baze University', 'BU', 'Abuja', 'FCT'],
    ['bingham', 'Bingham University', 'BU', 'Karu', 'Nasarawa'],
    ['bu', 'Benson Idahosa University', 'BIU', 'Benin City', 'Edo'],
    ['crescent', 'Crescent University', 'CU', 'Abeokuta', 'Ogun'],
    ['elizade', 'Elizade University', 'EU', 'Ilara-Mokin', 'Ondo'],
    ['gmu', 'Godfrey Okoye University', 'GOU', 'Enugu', 'Enugu'],
    ['gregory', 'Gregory University', 'GUU', 'Uturu', 'Abia'],
    ['hallmark', 'Hallmark University', 'HU', 'Ijebu-Itele', 'Ogun'],
    ['lcu', 'Lead City University', 'LCU', 'Ibadan', 'Oyo'],
    ['mfamu', 'Mountain Top University', 'MTU', 'Mowe', 'Ogun'],
    ['nginar', 'Nigerian Turkish Niler University', 'NTNU', 'Abuja', 'FCT'],
    ['pan-atlantic', 'Pan-Atlantic University', 'PAU', 'Lekki', 'Lagos'],
    ['redeemers', 'Redeemer\u2019s University', 'RUN', 'Ede', 'Osun'],
    ['southwestern', 'Southwestern University', 'SWU', 'Ogun', 'Ogun'],
    ['summit', 'Summit University', 'SU', 'Offa', 'Kwara'],
    ['veritas', 'Veritas University', 'VU', 'Abuja', 'FCT'],
    ['wellspring', 'Wellspring University', 'WU', 'Irhirhi', 'Edo'],
    ['wesley', 'Wesley University', 'WU', 'Ondo', 'Ondo'],
    ['landmark', 'Landmark University', 'LMU', 'Omu-Aran', 'Kwara'],
    ['crawford', 'Crawford University', 'CU', 'Igbesa', 'Ogun'],
    ['joseph-ayo', 'Joseph Ayo Babalola University', 'JABU', 'Ikeji-Arakeji', 'Osun'],
    ['kwararafa', 'Kwararafa University', 'KU', 'Wukari', 'Taraba'],
    ['michael', 'Michael and Cecilia Ibru University', 'MCIU', 'Agbara-Otor', 'Delta'],
    ['novena', 'Novena University', 'NU', 'Ogume', 'Delta'],
    ['oduduwa', 'Oduduwa University', 'OU', 'Ipetumodu', 'Osun'],
    ['paul', 'Paul University', 'PU', 'Awka', 'Anambra'],
    ['rhema', 'Rhema University', 'RU', 'Aba', 'Abia'],
    ['salem', 'Salem University', 'SU', 'Lokoja', 'Kogi'],
    ['samuel', 'Samuel Adegboyega University', 'SAU', 'Ogwa', 'Edo'],
    ['tansian', 'Tansian University', 'TU', 'Umunya', 'Anambra'],
    ['trinity', 'Trinity University', 'TU', 'Yaba', 'Lagos'],
    ['unimed', 'University of Medical Sciences, Ondo', 'UNIMED', 'Ondo', 'Ondo']
  ];

  return rows.map(function(r) {
    return {
      id: 'uni-' + r[0],
      slug: r[0],
      name: r[1],
      shortName: r[2],
      location: r[3],
      state: r[4],
      categories: UNI_CATEGORIES.slice(),
      contactEmail: 'support.sbiamautos@gmail.com',
      createdAt: nowStamp
    };
  });
}
const DEFAULT_UNIVERSITIES = uniDefaults();

async function readUniversities() {
  let list;
  if (usePg) {
    const r = await db.query('SELECT data FROM universities ORDER BY data->>\'name\' ASC');
    list = r.rows.map(row => row.data);
  } else {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, 'universities.json'), 'utf8');
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      list = [];
    }
  }
  // Auto-seed the full Nigerian university catalog when the store is empty
  // (e.g. first run, an empty JSON file, or an empty PostgreSQL table), so the
  // campus selectors are never empty.
  if (list.length === 0) {
    list = DEFAULT_UNIVERSITIES.slice();
    await writeUniversities(list);
    console.log('Seeded ' + list.length + ' default universities.');
  }
  return list;
}
async function writeUniversities(list) {
  if (usePg) {
    await db.query('DELETE FROM universities');
    for (const u of list) {
      await db.query('INSERT INTO universities (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [u.id, JSON.stringify(u)]);
    }
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'universities.json'), JSON.stringify(list, null, 2), 'utf8');
}
async function findUniversityById(id) {
  const list = await readUniversities();
  return list.find(u => u.id === id || u.slug === id) || null;
}
async function findUniversityBySlug(slug) {
  const list = await readUniversities();
  return list.find(u => u.slug === slug) || null;
}
async function addUniversity(u) {
  const list = await readUniversities();
  const idx = list.findIndex(x => x.id === u.id);
  if (idx === -1) list.push(u);
  else list[idx] = u;
  await writeUniversities(list);
  return u;
}
async function deleteUniversity(id) {
  const list = await readUniversities();
  const next = list.filter(u => u.id !== id);
  if (next.length === list.length) return false;
  await writeUniversities(next);
  return true;
}

/* ── Subscribers (event email notifications) ── */
// A subscriber is a user who opted in to receive event notifications for a campus.
// Shape: { id, email, name, universityId, universityName, source: 'button'|'register', createdAt }
async function readSubscribers() {
  if (usePg) {
    const r = await db.query('SELECT data FROM subscribers ORDER BY data->>\'createdAt\' DESC');
    return r.rows.map(row => row.data);
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'subscribers.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
async function writeSubscribers(list) {
  if (usePg) {
    const rows = list
      .filter(s => s && s.id)
      .map(s => [String(s.id), JSON.stringify(s)]);
    await withDbTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += 250) {
        const chunk = rows.slice(i, i + 250);
        const values = [];
        const params = [];
        chunk.forEach((r, j) => {
          const b = j * 2;
          values.push('($' + (b + 1) + ', $' + (b + 2) + '::jsonb)');
          params.push(r[0], r[1]);
        });
        await client.query(
          'INSERT INTO subscribers (id, data) VALUES ' + values.join(', ') +
          ' ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
          params
        );
      }
      if (rows.length) await client.query('DELETE FROM subscribers WHERE NOT (id = ANY($1::text[]))', [rows.map(r => r[0])]);
      else await client.query('DELETE FROM subscribers');
    });
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'subscribers.json'), JSON.stringify(list, null, 2), 'utf8');
}
async function findSubscriber(email, universityId) {
  const list = await readSubscribers();
  return list.find(s => s.email.toLowerCase() === String(email).toLowerCase() && s.universityId === universityId) || null;
}
async function addSubscriber(sub) {
  const list = await readSubscribers();
  const idx = list.findIndex(s => s.email.toLowerCase() === sub.email.toLowerCase() && s.universityId === sub.universityId);
  if (idx === -1) list.unshift(sub);
  else list[idx] = sub;
  await writeSubscribers(list);
  return sub;
}
async function removeSubscriber(email, universityId) {
  const list = await readSubscribers();
  const next = list.filter(s => !(s.email.toLowerCase() === String(email).toLowerCase() && s.universityId === universityId));
  if (next.length === list.length) return false;
  await writeSubscribers(next);
  return true;
}

// ────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────
const orderLog = [];
const orderLogLimit = 1000;

function randCode6() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}
function generateTicketCodes(qty) {
  const arr = [];
  const count = Math.max(1, parseInt(qty) || 1);
  for (let i = 0; i < count; i++) {
    arr.push({ code: 'TKT-' + randCode6(), used: false, usedAt: null });
  }
  return arr;
}
function unseenOrderCount(orders) {
  return orders.filter(o => o.notifyAdmin && !o.seenByAdmin).length;
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch (e) { return false; }
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000)); // cryptographically secure 6-digit OTP
}
function hashResetSecret(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return 'Email address is required.';
  if (value.length > 254) return 'Email address is too long.';
  // Practical application-level email validation; DNS/mailbox existence is not checked here.
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value)) {
    return 'Please enter a valid email address.';
  }
  return null;
}
function validatePhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return 'Phone number is required.';
  if (value.length > 25) return 'Phone number is too long.';
  // Accept common Nigerian formats: 08012345678 or +2348012345678,
  // allowing spaces, hyphens and parentheses for readability.
  const normalized = value.replace(/[\s()-]/g, '');
  if (!/^(?:0[789][01]\d{8}|\+234[789][01]\d{8})$/.test(normalized)) {
    return 'Please enter a valid Nigerian phone number.';
  }
  return null;
}
function validatePassword(password) {
  const pw = String(password || '');
  if (pw.length < 8) return 'Password must be at least 8 characters long.';
  if (pw.length > 128) return 'Password must be 128 characters or fewer.';
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
  if (!/[^A-Za-z0-9\s]/.test(pw)) return 'Password must contain at least one symbol.';
  return null;
}
function isAdminAuthorized(req) {
  const auth = String(req.headers['authorization'] || '');
  if (!auth.startsWith('Bearer ')) return false;

  const token = auth.slice(7).trim();
  // Fail closed: never allow the documented/default placeholder to become
  // a real admin credential if ADMIN_PASSWORD was forgotten in production.
  const expected = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!token || !expected || expected === 'CHANGE_ME_STRONG_PASSWORD') return false;

  // Compare secrets in constant time to avoid leaking the password through
  // timing differences. Buffer lengths must match before timingSafeEqual().
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
// Authorize either the master admin password OR a logged-in sub-admin account.
// Sub-admins have limited privileges (check-in + add events).
async function isAdminOrInfluencerAdmin(req) {
  if (isAdminAuthorized(req)) return { role: 'admin' };
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await getSessionUser(token);
  if (user && ['influencer_admin','influencer-admin','influencerAdmin'].includes(String(user.role))) return { role: 'influencer_admin', user: Object.assign({}, user, { role: 'influencer_admin' }) };
  return null;
}

// Influencer ownership is enforced server-side. Master admin can manage any
// influencer; an influencer admin can manage only accounts whose createdBy
// matches the authenticated influencer admin's user id.
function influencerAdminOwnsInfluencer(authCtx, influencer) {
  if (!authCtx || authCtx.role !== 'influencer_admin' || !authCtx.user || !influencer) return false;
  const adminId = String(authCtx.user.id || '').trim();
  const hasRelationshipArray = Array.isArray(influencer.influencerAssignments);
  if (hasRelationshipArray) {
    // Once the relationship model exists, its explicit status is authoritative.
    // This prevents a rejected relationship from accidentally retaining access
    // through one of the old single-admin ownership fields.
    return influencerHasAdminAssignment(influencer, adminId, ['accepted']);
  }

  // Legacy fallback for records that predate the relationship migration.
  const adminEmail = String(authCtx.user.email || '').trim().toLowerCase();
  const adminName = String(authCtx.user.name || '').trim().toLowerCase();
  const assigned = influencer.assignedInfluencerAdminId || influencer.influencerAdminId || influencer.ownerInfluencerAdminId;
  if (assigned && String(assigned) === adminId) return true;
  const owner = influencer.createdBy;
  if (owner && typeof owner === 'object') {
    const oid = String(owner.id || owner.userId || owner.ownerId || owner.influencerAdminId || '').trim();
    const oemail = String(owner.email || '').trim().toLowerCase();
    const oname = String(owner.name || '').trim().toLowerCase();
    if (oid && oid === adminId) return true;
    if (oemail && adminEmail && oemail === adminEmail) return true;
    if (oname && adminName && oname === adminName) return true;
    return false;
  }
  const ownerValue = String(owner || '').trim();
  return ownerValue === adminId || (!!adminEmail && ownerValue.toLowerCase() === adminEmail) || (!!adminName && ownerValue.toLowerCase() === adminName);
}

function canManageInfluencer(authCtx, influencer) {
  if (!authCtx || !influencer || influencer.role !== 'influencer') return false;
  if (authCtx.role === 'admin') return true;
  return influencerAdminOwnsInfluencer(authCtx, influencer);
}

// Event ownership/authorization is checked server-side. An Influencer Admin may
// edit/archive only events they created; authorized events are view-only. Main
// Admin has unrestricted event access.
function influencerAdminOwnsEvent(authCtx, event) {
  if (!authCtx || authCtx.role !== 'influencer_admin' || !authCtx.user || !event) return false;
  const myId = String(authCtx.user.id || '').trim();
  const myEmail = String(authCtx.user.email || '').trim().toLowerCase();
  const directOwnerId = String(event.influencerAdminId || event.ownerInfluencerAdminId || event.createdByInfluencerAdminId || '').trim();
  if (directOwnerId && directOwnerId === myId) return true;
  const c = event.createdBy;
  if (typeof c === 'string') return c.trim() === myId || (!!myEmail && c.trim().toLowerCase() === myEmail);
  if (c && typeof c === 'object') {
    const oid = String(c.id || c.userId || c.ownerId || c.influencerAdminId || c.assignedInfluencerAdminId || '').trim();
    const oemail = String(c.email || '').trim().toLowerCase();
    return oid === myId || (!!myEmail && oemail === myEmail);
  }
  return false;
}
// Events an Influencer Admin may see sales and commission for: explicitly
// authorized to them, OR created by them. Matching only on
// authorizedInfluencerAdminIds hid every event created before authorization
// was recorded, which left the Overview empty ("No events have been
// authorized to you yet") even though the same event showed up in the
// Influencer Admin's own Add Events list.
function influencerAdminVisibleEvents(authCtx, allEvents) {
  const myId = String((authCtx && authCtx.user && authCtx.user.id) || '').trim();
  if (!myId) return [];
  return (allEvents || []).filter(ev =>
    getAuthorizedInfluencerAdminIds(ev).includes(myId) || influencerAdminOwnsEvent(authCtx, ev)
  );
}
async function isAdminOrSubadmin(req) {
  // This helper is intentionally limited to management roles. Ordinary
  // influencers and check-in staff must never inherit admin/sub-admin API
  // privileges merely because they have a valid login session.
  if (isAdminAuthorized(req)) return { role: 'admin' };
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const user = await getSessionUser(token);
  if (!user) return null;
  const role = String(user.role || '').trim();
  if (role === 'subadmin') return { role: 'subadmin', user: user };
  if (['influencer_admin','influencer-admin','influencerAdmin'].includes(role)) {
    return { role: 'influencer_admin', user: Object.assign({}, user, { role: 'influencer_admin' }) };
  }
  return null;
}

// Check-in is a separate privilege from management. Keeping it separate
// prevents check-in staff from inheriting event/account/coupon management
// access through a shared authorization helper.
async function isAdminOrCheckinStaff(req) {
  if (isAdminAuthorized(req)) return { role: 'admin' };
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const user = await getSessionUser(token);
  if (!user) return null;
  const role = String(user.role || '').trim();
  if (role === 'checkin_staff' || role === 'subadmin') return { role: role, user: user };
  return null;
}

// Default configuration values (overridden by environment variables on Render).
// ⚠️ SECURITY: NO live secrets are stored here. All secret values (Flutterwave
// secret key, webhook hash, admin password, API keys) MUST be provided via
// environment variables (set in the Render dashboard / local .env). See .env.example.
const defaults = {
  WHATSAPP_FLOAT_NUMBER: '2348122104576',
  WHATSAPP_ORDER_NUMBER: '2348122104576',
  ADMIN_PASSWORD: 'CHANGE_ME_STRONG_PASSWORD',
  FLUTTERWAVE_SECRET_KEY: '',
  FLUTTERWAVE_PUBLIC_KEY: 'FLWPUBK-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-X',
  FLUTTERWAVE_BANK_NAME: 'Flutterwave MfB (formerly ok mfb)',
  FLUTTERWAVE_ACCOUNT_NUMBER: '9707788756',
  FLUTTERWAVE_WEBHOOK_HASH: '',
  SITE_URL: 'https://unisocials.onrender.com',
  CONTACT_EMAIL: 'support.sbiamautos@gmail.com',
  FORMSUBMIT_KEY: 'support.sbiamautos@gmail.com',
  REDIRECT_URL: 'https://unisocials.onrender.com/thank-you.html',
  // Email notifications — admin gets an alert the moment a payment is confirmed,
  // and the buyer gets a confirmation email with their ticket QR links.
  ADMIN_EMAIL: 'soludobenedict5@gmail.com',
// "From" address for Resend. In Resend test mode you must use onboarding@resend.dev
  // and only the account owner's email can receive. After verifying a domain
  // (e.g. your university's domain or your own domain), set EMAIL_FROM="Unisocials <no-reply@yourdomain>"
  EMAIL_FROM: 'Unisocials <onboarding@resend.dev>',
  // Brevo API key — sends buyer ticket confirmation emails (no domain required;
  // just verify a sender email at https://app.brevo.com). Never exposed to browser.
  BREVO_API_KEY: '',
  BREVO_SENDER_EMAIL: 'support.sbiamautos@gmail.com',
  BREVO_SENDER_NAME: 'Unisocials',
  // NOTE: RESEND_API_KEY is intentionally NOT hardcoded here. Set it in the
  // Render dashboard (Environment → Env Vars) so it's never committed to the
  // repo — GitHub secret scanning rejects live Resend keys in commits.
  RESEND_API_KEY: ''
};

function getConfig() {
  const cfg = {};
  for (const [key, val] of Object.entries(defaults)) {
    // Never expose secret keys, passwords, API keys, or the webhook HMAC hash to the browser
    if (/SECRET|PRIVATE|PASSWORD|WEBHOOK|API_KEY|RESEND/i.test(key)) continue;
    cfg[key] = process.env[key] !== undefined ? process.env[key] : val;
  }
  return cfg;
}

// Files that must never be reachable over HTTP. The static handler resolves
// paths against the project root, so without this list the server shipped its
// own source, its package manifest, and the runtime data store (orders, users,
// password hashes, session tokens) to anyone who guessed the URL.
const BLOCKED_STATIC_NAMES = new Set([
  'server.js',
  'build.js',
  'package.json',
  'package-lock.json',
  'render.yaml',
  'config.js', // served dynamically from getConfig() further up, never from disk
  'templatemo_622_clearwave.code-workspace'
]);

const BLOCKED_STATIC_DIRS = new Set([
  'data',      // orders, users, sessions, payouts — the live datastore
  'node_modules',
  '.git'
]);

const BLOCKED_STATIC_EXTS = new Set([
  '.env', '.log', '.pid', '.sql', '.py', '.map', '.bak', '.tmp'
]);

function isBlockedStaticPath(urlPath) {
  // Normalise to a leading-slash path with no "." / ".." segments so the check
  // cannot be bypassed with encoded traversal or doubled slashes.
  let p;
  try { p = decodeURIComponent(String(urlPath || '')); } catch (e) { return true; }
  if (p.indexOf('\0') !== -1) return true;
  const segments = p.split(/[/\\]+/).filter(s => s && s !== '.' && s !== '..');
  if (segments.some(s => s === '..' || s === '.')) return true;
  if (!segments.length) return false;

  const lower = segments.map(s => s.toLowerCase());

  // Any dotfile or dot-directory anywhere in the path (.env, .env.local, .git/...).
  if (lower.some(s => s.startsWith('.'))) return true;

  for (let i = 0; i < segments.length; i++) {
    const seg = lower[i];
    const ext = path.extname(seg);
    if (BLOCKED_STATIC_NAMES.has(seg)) return true;
    if (BLOCKED_STATIC_EXTS.has(ext)) return true;
    // Directory deny-list applies to any position, so /assets/min/... is refused too.
    if (i < segments.length - 1 && BLOCKED_STATIC_DIRS.has(seg)) return true;
    if (BLOCKED_STATIC_DIRS.has(seg) && i === segments.length - 1) return true;
  }
  return false;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

// ────────────────────────────────────────────
// SECURITY HARDENING
// ────────────────────────────────────────────
// Security headers applied to every response.
function securityHeaders(req) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://checkout.flutterwave.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://formsubmit.co https://checkout.flutterwave.com https://checkout-v3.flutterwave.com https://api.flutterwave.com https://api.ravepay.co https://ravesandboxapi.flutterwave.com",
      "frame-src 'self' https://checkout.flutterwave.com https://checkout-v3.flutterwave.com",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests"
    ].join('; ')
  };
  const forwardedProto = req && req.headers ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() : '';
  const isHttps = Boolean((req && req.socket && req.socket.encrypted) || forwardedProto === 'https');
  if (isHttps) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

// Hard ceiling on a single order's value. Quantity is already capped at 100
// per order; this bounds the money side of that product so no single checkout
// can create an arbitrarily large receivable, and so a tampered event price
// cannot turn into an unbounded payout obligation.
const MAX_ORDER_AMOUNT = 5000000; // ₦5,000,000

// How many times larger the shared per-route ceiling is than the per-client
// limit. High enough that ordinary traffic never reaches it, low enough that
// address rotation cannot be used to bypass a limit.
const ROUTE_LIMIT_MULTIPLIER = 20;

// The client address a rate-limit bucket should be keyed on.
//
// X-Forwarded-For is a comma-separated chain where each proxy APPENDS the peer
// it received from, so the LAST entry is the one written by our own edge and is
// the only one we can trust. The first entry is whatever the caller sent, which
// is why taking it let an attacker mint a fresh bucket per request by sending a
// different header value — that defeated every limit in the app, including
// login, OTP verification and the order lookup.
//
// Falls back to the socket address when the header is absent or unparseable.
function rateLimitClientIp(req) {
  const raw = String(req.headers['x-forwarded-for'] || '');
  // An overlong chain is rejected outright rather than truncated: cutting it
  // mid-list would leave an attacker-supplied entry sitting in last position.
  if (raw && raw.length <= 512) {
    const hops = raw.split(',').map(h => h.trim()).filter(Boolean);
    if (hops.length) {
      const last = hops[hops.length - 1];
      // Only accept something that actually looks like an address, so a garbage
      // header cannot collapse every caller into one shared "unknown" bucket.
      if (/^[0-9a-f:.]{2,45}$/i.test(last)) return last;
    }
  }
  const sock = String((req.socket && req.socket.remoteAddress) || '').trim();
  return sock || 'unknown';
}

// Very small in-memory rate limiter for sensitive endpoints (auth).
//
// Two limits apply to every call, and both must pass:
//
//   1. Per client  — the usual limit, keyed on the resolved client address.
//   2. Per route   — a global ceiling shared by everyone. Rotating the
//      X-Forwarded-For header can mint a fresh per-client bucket, but it
//      cannot mint a fresh route bucket, so a caller that changes its claimed
//      address on every request still runs out of attempts.
//
// The route ceiling is deliberately several times the per-client limit so it
// only bites on sustained abuse from many addresses, not on normal traffic.
const rateBuckets = new Map();
const routeRateBuckets = new Map();
function bumpBucket(store, key, now, windowMs) {
  const bucket = store.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count++;
  store.set(key, bucket);
  return bucket;
}
function pruneBuckets(store) {
  if (store.size <= 10000) return;
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, b] of store) {
    if (b.resetAt < cutoff) store.delete(k);
  }
}
function rateLimit(req, route, limit, windowMs) {
  const now = Date.now();
  const client = bumpBucket(rateBuckets, rateLimitClientIp(req) + '|' + route, now, windowMs);
  const global = bumpBucket(routeRateBuckets, route, now, windowMs);
  pruneBuckets(rateBuckets);
  pruneBuckets(routeRateBuckets);
  return {
    allowed: client.count <= limit && global.count <= limit * ROUTE_LIMIT_MULTIPLIER,
    retryAfter: Math.ceil((Math.max(client.resetAt, global.resetAt) - now) / 1000)
  };
}

// Apply security headers to a plain header object.
function withSecurityHeaders(headers, req) {
  return Object.assign({}, headers, securityHeaders(req));
}

function sendJson(res, status, obj) {
  res.writeHead(status, withSecurityHeaders({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let tooLarge = false;
    req.on('data', c => {
      if (tooLarge) return;
      body += c;
      if (body.length > 1e6) {
        tooLarge = true;
        resolve(null);
        req.destroy();
      }
    });
    req.on('end', () => { if (!tooLarge) resolve(body); });
    req.on('error', () => { if (!tooLarge) resolve(''); });
  });
}

// Accept only image URLs that cannot execute script in an HTML src attribute.
// Relative site paths are allowed; remote images must use HTTPS (HTTP is kept
// available for local/dev compatibility). Only base64 raster image data URLs
// produced by the admin image resize flow are accepted.
function isSafeImageUrl(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return true;
  if (/^[\x00-\x1F\x7F]/.test(v) || /[\x00-\x1F\x7F]/.test(v)) return false;
  if (v.startsWith('/')) return !v.startsWith('//');
  // Admin image uploads are converted in the browser to base64 image data.
  // Allow those uploads (up to the request-body safety limit) instead of
  // treating them like short remote image URLs.
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)) return v.length <= 850000;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

// Prevent duplicate fulfillment when Flutterwave retries a webhook or an admin
// verifies the same order at the same time. Persistent ticketIssued/ticketEmailSent
// flags below remain the source of truth across restarts.
const paymentVerificationLocks = new Set();

// Verify a transaction reference against Flutterwave (server-side)
function verifyFlutterwave(txRef, expectedAmount, expectedCurrency) {
  return new Promise((resolve) => {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY !== undefined
      ? String(process.env.FLUTTERWAVE_SECRET_KEY).trim()
      : String(defaults.FLUTTERWAVE_SECRET_KEY || '').trim();
    const cleanTxRef = String(txRef || '').trim();
    const expected = Number(expectedAmount);
    const expectedCur = String(expectedCurrency || '').trim().toUpperCase();

    // Never call the provider with incomplete verification inputs. A payment
    // is only eligible for fulfillment when our order has a real reference,
    // positive amount and expected currency, and the secret key is configured.
    if (!secretKey || !cleanTxRef || !Number.isFinite(expected) || expected <= 0 || !expectedCur) {
      return resolve({ success: false, apiSuccess: false, error: 'Incomplete Flutterwave verification configuration' });
    }

    const apiPath = '/v3/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(cleanTxRef);
    const options = {
      hostname: 'api.flutterwave.com',
      port: 443,
      path: apiPath,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + secretKey, 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };
    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', c => { data += c; });
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const t = json.data || {};
          const status = String(t.status || '').toLowerCase();
          const amount = parseFloat(t.amount) || 0;
          const currency = String(t.currency || '').toUpperCase();
          const returnedTxRef = String(t.tx_ref || t.reference || '').trim();
          const verified = json.status === 'success' && ['successful', 'succeeded', 'completed'].includes(status);

          // Strong verification: Flutterwave must return the exact transaction
          // reference, exact expected currency, and the expected amount. Do not
          // treat missing provider fields as a match.
          const txRefOk = !!returnedTxRef && returnedTxRef === cleanTxRef;
          const amountOk = Number.isFinite(amount) && Math.abs(amount - expected) < 0.01;
          const currencyOk = !!currency && currency === expectedCur;
          const httpOk = Number(apiRes.statusCode || 0) >= 200 && Number(apiRes.statusCode || 0) < 300;

          resolve({
            success: httpOk && verified && txRefOk && amountOk && currencyOk,
            apiSuccess: verified,
            amount: amount,
            currency: currency,
            status: status,
            returnedTxRef: returnedTxRef,
            txRefOk: txRefOk,
            amountOk: amountOk,
            currencyOk: currencyOk
          });
        } catch (e) {
          resolve({ success: false, apiSuccess: false, error: 'Bad response' });
        }
      });
    });
    apiReq.setTimeout(10000, () => {
      apiReq.destroy();
      resolve({ success: false, apiSuccess: false, error: 'Flutterwave verification timed out' });
    });
    apiReq.on('error', () => {
      resolve({ success: false, apiSuccess: false, error: 'Network error' });
    });
    apiReq.end();
  });
}

// Build a rich ticket summary for the gate scan result panel (admin/sub-admin).
// Includes the full order context so staff can verify the ticket at a glance.
function scanTicketDetails(order, entry, idx, codes, alreadyUsed) {
  return {
    orderId: order.orderId,
    ticketCode: entry.code,
    ticketIndex: idx + 1,
    totalTickets: codes.length,
    used: alreadyUsed ? true : !!entry.used,
    usedAt: entry.usedAt || null,
    checkedInBy: entry.checkedInBy || null,
    eventName: order.eventName,
    eventCategory: order.eventCategory || '',
    eventDate: order.eventDate,
    eventVenue: order.eventVenue,
    universityName: order.universityName || '',
    ticketTier: order.ticketTier || 'regular',
    qty: order.qty,
    amount: order.amount,
    currency: order.currency,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    buyerPhone: order.buyerPhone,
    buyerFaculty: order.buyerFaculty || '',
    verifiedAt: order.verifiedAt
  };
}

// Mark an order verified + ensure tickets exist
function verifyOrderTicketData(order) {
  if (!order.ticketCodes || !order.ticketCodes.length) {
    order.ticketCodes = generateTicketCodes(order.qty);
  }
  order.ticketCode = order.ticketCodes[0].code; // legacy single-code reference
  order.status = 'verified';
  order.verifiedAt = order.verifiedAt || new Date().toISOString();
  order.ticketIssued = true;
  order.ticketIssuedAt = new Date().toISOString();
  order.notifyAdmin = true;
  order.seenByAdmin = false;
  return order;
}

// ────────────────────────────────────────────
// EMAIL NOTIFICATIONS
// ────────────────────────────────────────────
// Sends an HTTPS POST to any JSON API (Resend, FormSubmit, etc.)
function postJson(hostname, pathname, headers, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: hostname,
      port: 443,
      path: pathname,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers)
    };
    const req = https.request(options, (res) => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (e) {}
        resolve({ status: res.statusCode, body: out, json: json });
      });
    });
    req.on('error', () => { resolve({ status: 0, body: '', json: null }); });
    req.end(data);
  });
}

function postForm(hostname, pathname, fields) {
  return new Promise((resolve) => {
    const data = new URLSearchParams(fields).toString();
    const options = {
      hostname: hostname,
      port: 443,
      path: pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: body }));
    });
    req.on('error', (error) => resolve({ status: 0, body: error.message }));
    req.end(data);
  });
}

function emailFrom() {
  return process.env.EMAIL_FROM !== undefined ? process.env.EMAIL_FROM : defaults.EMAIL_FROM;
}
function resendKey() {
  return process.env.RESEND_API_KEY !== undefined ? process.env.RESEND_API_KEY : defaults.RESEND_API_KEY;
}
function adminEmail() {
  return process.env.ADMIN_EMAIL !== undefined ? process.env.ADMIN_EMAIL : defaults.ADMIN_EMAIL;
}
function siteUrl() {
  return process.env.SITE_URL !== undefined ? process.env.SITE_URL : defaults.SITE_URL;
}

// Brevo (transactional email — free tier works WITHOUT a verified domain; you just
// verify a sender email address). Used for buyer ticket emails; admin alerts stay on Resend.
function brevoApiKey() {
  return process.env.BREVO_API_KEY !== undefined ? process.env.BREVO_API_KEY : '';
}
function brevoSenderEmail() {
  if (process.env.BREVO_SENDER_EMAIL !== undefined) return process.env.BREVO_SENDER_EMAIL;
  return process.env.CONTACT_EMAIL !== undefined ? process.env.CONTACT_EMAIL : defaults.CONTACT_EMAIL;
}
function brevoSenderName() {
  if (process.env.BREVO_SENDER_NAME !== undefined) return process.env.BREVO_SENDER_NAME;
  return 'Unisocials';
}

// Send an email via Brevo (transactional API — works WITHOUT a verified domain;
// you only verify a sender email at https://app.brevo.com → Senders).
// Returns the Brevo response JSON on success, or null when BREVO_API_KEY is
// missing / the request fails. Never throws / never blocks.
async function sendBrevoEmail(to, subject, text, html, toName) {
  try {
    const apiKey = brevoApiKey();
    if (!apiKey || !to) return null;
    const payload = {
      sender: { name: brevoSenderName(), email: brevoSenderEmail() },
      to: [{ email: to, name: toName || '' }],
      subject: subject,
      textContent: text,
      htmlContent: html
    };
    const r = await postJson('api.brevo.com', '/v3/smtp/email', { 'api-key': apiKey }, payload);
    if (r.status === 200 || r.status === 201) return r.json;
    console.warn('Brevo email failed (' + r.status + '):', r.body && r.body.slice(0, 200));
    return null;
  } catch (e) {
    console.warn('Brevo email error:', e.message);
    return null;
  }
}

async function sendContactEmail(data) {
  const subject = '[Unisocials Contact] ' + data.subject;
  const text = 'Name: ' + data.name + '\nEmail: ' + data.email + '\nPhone: ' + (data.phone || '—') + '\nSubject: ' + data.subject + '\n\n' + data.message;
  const html = '<div style="font-family:Arial,sans-serif;white-space:pre-wrap"><strong>Name:</strong> ' + escapeHtml(data.name) + '<br><strong>Email:</strong> ' + escapeHtml(data.email) + '<br><strong>Phone:</strong> ' + escapeHtml(data.phone || '—') + '<br><strong>Subject:</strong> ' + escapeHtml(data.subject) + '<br><br>' + escapeHtml(data.message).replace(/\n/g, '<br>') + '</div>';
  const to = adminEmail();
  const formSubmitKey = String(process.env.FORMSUBMIT_KEY !== undefined ? process.env.FORMSUBMIT_KEY : defaults.FORMSUBMIT_KEY || '').trim();
  if (formSubmitKey) {
    const result = await postJson('formsubmit.co', '/ajax/' + encodeURIComponent(formSubmitKey), {
      'Accept': 'application/json'
    }, {
      Name: data.name,
      Email: data.email,
      Phone: data.phone || '',
      Subject: data.subject,
      Message: data.message,
      _subject: 'New Contact Form Submission from Unisocials',
      _captcha: 'false',
      _template: 'table',
      _next: siteUrl() + '/thank-you.html'
    });
    if (result.status >= 200 && result.status < 400) return { sent: true, configured: true, provider: 'FormSubmit' };
    console.warn('FormSubmit contact delivery failed (' + result.status + '):', result.body && result.body.slice(0, 200));
    return { sent: false, configured: true, provider: 'FormSubmit', status: result.status };
  }
  return { sent: false, configured: false, provider: '' };
}

// Domain every self-service Unisocials staff account logs in with: their name,
// e.g. ada.nwosu@unisocials.com. Both Influencer Admins and check-in staff use
// it, so the login convention is identical across the two dashboards. The
// generated password is emailed to the real address they signed up with, never
// to this address.
const INFLUENCER_ADMIN_EMAIL_DOMAIN = 'unisocials.com';

// A staff login on our own domain is an internal alias and cannot receive mail,
// so it must never be used as a notification address. Notifications (payout
// updates, credentials) always need a real inbox: the address captured on the
// account-creation form, stored as contactEmail.
function isInternalLoginEmail(address) {
  const value = String(address || '').trim().toLowerCase();
  return !value || value.endsWith('@' + INFLUENCER_ADMIN_EMAIL_DOMAIN);
}

// "Ada Nwosu" -> "ada.nwosu"; strips anything that is not safe for an email local part.
function influencerAdminEmailLocalPart(name) {
  const cleaned = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s._-]/g, '').trim();
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  return parts.join('.') || 'influencer.admin';
}

// Reserve a free <name>@unisocials.com login, auto-suffixed when taken.
// Returns null only when every variant up to 99 is already in use.
async function reserveStaffLoginEmail(name) {
  const localPart = influencerAdminEmailLocalPart(name);
  let loginEmail = localPart + '@' + INFLUENCER_ADMIN_EMAIL_DOMAIN;
  if (await findUserByEmail(loginEmail)) {
    loginEmail = null;
    for (let n = 2; n <= 99 && !loginEmail; n++) {
      const candidate = localPart + n + '@' + INFLUENCER_ADMIN_EMAIL_DOMAIN;
      if (!(await findUserByEmail(candidate))) loginEmail = candidate;
    }
  }
  return loginEmail;
}

// Build (but do not save) a self-service staff account with a one-time password.
// Shared by the Influencer Admin and check-in staff signup flows so both mint
// logins, hash passwords and stamp ids the same way.
async function buildSelfServiceStaffUser({ name, contactEmail, role, prefix, extra }) {
  const loginEmail = await reserveStaffLoginEmail(name);
  if (!loginEmail) return null;
  const password = generateTemporaryPassword();
  const user = Object.assign({
    id: prefix + crypto.randomBytes(4).toString('hex').toUpperCase(),
    name: name,
    email: loginEmail,
    contactEmail: contactEmail,
    phone: '',
    passwordHash: hashPassword(password),
    role: role,
    selfRegistered: true,
    createdAt: new Date().toISOString()
  }, extra || {});
  return { user, password };
}

// A readable one-time password that still satisfies validatePassword.
function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return 'Uni-' + out + String(crypto.randomInt(0, 10));
}

// Email a new self-service Influencer Admin their login email + password at the
// address they signed up with. Returns true only when it really went out.
async function sendInfluencerAdminCredentialsEmail(user, password) {
  const to = String(user.contactEmail || '').trim();
  if (!to) return false;
  const subject = 'Your Unisocials Influencer Admin account is ready';
  const text =
    'Hi ' + (user.name || 'there') + ',\n\n' +
    'Your Influencer Admin account has been created and is ready to use.\n\n' +
    'Login email: ' + user.email + '\n' +
    'Password: ' + password + '\n\n' +
    'Sign in here: ' + siteUrl() + '/influencer-admin.html\n\n' +
    'University: ' + (user.university || '—') + '\n\n' +
    'This is your login. Keep it safe and don\'t share it with anyone.\n\n' +
    '— Unisocials';
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">' +
    '<h2 style="margin:0 0 6px">Welcome to Unisocials 🎉</h2>' +
    '<p style="margin:0 0 14px;color:#475569">Your Influencer Admin account is ready to use.</p>' +
    '<table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">' +
    payoutEmailRow('Name', user.name) +
    payoutEmailRow('Login email', user.email) +
    payoutEmailRow('Password', password) +
    payoutEmailRow('University', user.university || '—') +
    '</table>' +
    '<p style="margin:16px 0"><a href="' + escapeHtml(siteUrl() + '/influencer-admin.html') + '" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">Sign in to your dashboard</a></p>' +
    '<p style="margin:0 0 8px;color:#475569;font-size:14px">🔐 This is your login. Keep it safe and don&rsquo;t share it with anyone.</p>' +
    '<p style="margin:0;color:#94a3b8;font-size:12px">You are receiving this because you requested an Influencer Admin account on Unisocials.</p>' +
    '</div>';
  const sent = await sendBrevoEmail(to, subject, text, html, user.name);
  if (!sent) console.warn('Influencer Admin credentials email not sent to', to, '(no BREVO_API_KEY or delivery failed)');
  return !!sent;
}

function payoutEmailRow(label, value) {
  return '<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:40%">' + escapeHtml(label) + '</td><td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">' + escapeHtml(String(value == null ? '—' : value)) + '</td></tr>';
}

// Email a check-in staff member their check-in login email + password at the
// address they gave. Mirrors sendInfluencerAdminCredentialsEmail but points at
// the check-in dashboard, which is where this role actually signs in.
async function sendCheckinStaffCredentialsEmail(user, password) {
  const to = String(user.contactEmail || '').trim();
  if (!to) return false;
  const subject = 'Your Unisocials check-in staff account is ready';
  const text =
    'Hi ' + (user.name || 'there') + ',\n\n' +
    'Your check-in staff account has been created and is ready to use.\n\n' +
    'Login email: ' + user.email + '\n' +
    'Password: ' + password + '\n\n' +
    'Sign in here: ' + siteUrl() + '/checkin.html\n\n' +
    'You will be able to scan and verify guest tickets at the gate.\n\n' +
    'This is your login. Keep it safe and don\'t share it with anyone.\n\n' +
    '— Unisocials';
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">' +
    '<h2 style="margin:0 0 6px">You&rsquo;re on the gate team 🎟️</h2>' +
    '<p style="margin:0 0 14px;color:#475569">Your Unisocials check-in staff account is ready to use.</p>' +
    '<table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">' +
    payoutEmailRow('Name', user.name) +
    payoutEmailRow('Login email', user.email) +
    payoutEmailRow('Password', password) +
    payoutEmailRow('Event', user.eventName || '—') +
    '</table>' +
    '<p style="margin:16px 0"><a href="' + escapeHtml(siteUrl() + '/checkin.html') + '" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">Sign in to check guests in</a></p>' +
    '<p style="margin:0 0 8px;color:#475569;font-size:14px">🔐 This is your login. Keep it safe and don&rsquo;t share it with anyone.</p>' +
    '<p style="margin:0;color:#94a3b8;font-size:12px">You are receiving this because you were added as check-in staff for an Unisocials event.</p>' +
    '</div>';
  const sent = await sendBrevoEmail(to, subject, text, html, user.name);
  if (!sent) console.warn('Check-in staff credentials email not sent to', to, '(no BREVO_API_KEY or delivery failed)');
  return !!sent;
}

// "12 Mar 2026, 14:05" in the email's own timezone (UTC) — payout notices are
// read days after they are sent, so keep the day and month, not just the time.
function fmtEmailDate(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return String(iso || '—');
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }) + ' UTC';
}

// Email the Main Admin whenever an Influencer Admin requests a payout.
async function sendPayoutRequestEmailToAdmin(payout) {
  try {
    const to = adminEmail();
    if (!to) return false;
    const m = PAYOUT_METHODS[payout.payoutMethod] || {};
    const fee = payoutFeeSplit(payout);
    const amount = '₦' + Number(payout.amount || 0).toLocaleString();
    const feeAmount = '₦' + fee.feeAmount.toLocaleString();
    const netAmount = '₦' + fee.netAmount.toLocaleString();
    const subject = '💰 Payout Request — ' + netAmount + ' for ' + (payout.requesterName || payout.requesterEmail);
    const text =
      'New payout request on Unisocials.\n\n' +
      'Requested by: ' + (payout.requesterName || '') + ' <' + payout.requesterEmail + '>\n' +
      'Amount requested: ' + amount + '\n' +
      'Send to them: ' + netAmount + '\n' +
      'Payment schedule: ' + (m.label || payout.payoutMethod) + '\n' +
      'Bank: ' + (payout.bank ? payout.bank.bankName : '') + '\n' +
      'Account number: ' + (payout.bank ? payout.bank.accountNumber : '') + '\n' +
      'Account name: ' + (payout.bank ? payout.bank.accountName : '') + '\n\n' +
      'Please review and pay this request within 24 hours in the Admin Dashboard → Payout Requests.\n\nUnisocials Team';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
      '<div style="background:#1B5E20;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">Unisocials — Payout Request 💰</div>' +
      '<div style="padding:24px">' +
      '<p style="margin:0 0 14px;color:#475569">An Influencer Admin has requested a commission payout. Please pay within <strong>24 hours</strong>.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">' +
      payoutEmailRow('Requested by', (payout.requesterName || '') + ' <' + payout.requesterEmail + '>') +
      payoutEmailRow('Amount requested', amount) +
      payoutEmailRow('Send to them', netAmount) +
      payoutEmailRow('Payment schedule', m.label || payout.payoutMethod) +
      payoutEmailRow('Bank', payout.bank ? payout.bank.bankName : '') +
      payoutEmailRow('Account number', payout.bank ? payout.bank.accountNumber : '') +
      payoutEmailRow('Account name', payout.bank ? payout.bank.accountName : '') +
      '</table>' +
      '<p style="font-size:13px;color:#475569">Review it in the Admin Dashboard → Payout Requests.</p>' +
      '</div></div>';
    let sent = false;
    if (brevoApiKey()) sent = !!(await sendBrevoEmail(to, subject, text, html));
    if (!sent && resendKey()) {
      const r = await postJson('api.resend.com', '/emails', { 'Authorization': 'Bearer ' + resendKey() }, { from: process.env.EMAIL_FROM || defaults.EMAIL_FROM, to: [to], subject: subject, text: text, html: html });
      sent = r.status >= 200 && r.status < 300;
    }
    return sent;
  } catch (e) {
    console.warn('Payout request email error:', e.message);
    return false;
  }
}

// The real inbox a payout notification should go to, or '' when the account has
// no receivable address on file. Priority: the address captured when the payout
// was requested, then the account's contactEmail, then the requester email only
// when it is not an internal @unisocials.com login.
async function payoutRecipientEmail(payout) {
  if (!payout) return '';
  const candidates = [payout.requesterContactEmail, payout.requesterEmail];
  if (payout.requestedBy) {
    let user = null;
    try { user = await findUserById(payout.requestedBy); } catch (e) { /* non-fatal */ }
    if (user && user.contactEmail) candidates.push(user.contactEmail);
  }
  for (const candidate of candidates) {
    const value = String(candidate || '').trim().toLowerCase();
    if (value && !isInternalLoginEmail(value)) return value;
  }
  return '';
}

// Notify the Influencer Admin of a decision on their payout request — including
// when the payout is marked paid, which is the completion notice they asked for.
async function sendPayoutStatusEmailToRequester(payout) {
  try {
    const to = await payoutRecipientEmail(payout);
    if (!to) {
      console.warn('Payout status email skipped for ' + (payout.id || '?') + ': no real email address on file for', payout.requesterName || payout.requesterEmail || 'the requester');
      return false;
    }
    const fee = payoutFeeSplit(payout);
    const amount = '₦' + Number(payout.amount || 0).toLocaleString();
    const feeAmount = '₦' + fee.feeAmount.toLocaleString();
    const netAmount = '₦' + fee.netAmount.toLocaleString();
    const statusText = String(payout.status || '').toLowerCase();
    const subject = statusText === 'paid'
      ? '✅ Payout complete — ' + netAmount + ' has been sent to you (' + payout.id + ')'
      : statusText === 'approved'
        ? '✅ Payout approved — ' + netAmount + ' will be sent to you within 24 hours'
        : '❌ Payout request ' + (payout.id) + ' was rejected';
    const bankLine = payout.bank ? payout.bank.bankName + ' ••••' + String(payout.bank.accountNumber || '').slice(-4) : '';
    const text =
      'Hi ' + (payout.requesterName || 'there') + ',\n\n' +
      (statusText === 'paid'
        ? 'Your payout is complete. ' + netAmount + ' has been sent to your bank account (' + bankLine + '). Bank transfers usually reflect within minutes; some banks take up to 24 hours.'
        : statusText === 'approved'
          ? 'Your payout request of ' + amount + ' has been approved: ' + netAmount + ' will be sent to you within 24 hours.'
          : 'Your payout request of ' + amount + ' was rejected.\n\nReason: ' + (payout.adminNote || 'Not specified') + '\n\nYou can submit a new request at any time.') +
      '\n\nThank you for growing Unisocials.\n\nUnisocials Team';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
      '<div style="background:' + (statusText === 'rejected' ? '#B71C1C' : '#1B5E20') + ';color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">Unisocials — Payout Update</div>' +
      '<div style="padding:24px">' +
      '<p style="margin:0 0 14px">Hi <strong>' + escapeHtml(payout.requesterName || 'there') + '</strong>,</p>' +
      '<p style="margin:0 0 14px;color:#475569">' +
      (statusText === 'paid'
        ? 'Your payout is complete: <strong>' + netAmount + '</strong> has been sent to your bank account (' + escapeHtml(bankLine) + '). Bank transfers usually reflect within minutes; some banks take up to 24 hours.'
        : statusText === 'approved'
          ? 'Your payout request of <strong>' + amount + '</strong> has been approved: <strong>' + netAmount + '</strong> will be sent to you within 24 hours.'
          : 'Your payout request of <strong>' + amount + '</strong> was rejected. Reason: ' + escapeHtml(payout.adminNote || 'Not specified') + ' You can submit a new request at any time.') +
      '</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">' +
      payoutEmailRow('Request ID', payout.id) +
      payoutEmailRow('Amount requested', amount) +
      payoutEmailRow('Sent to you', netAmount) +
      payoutEmailRow('Bank', bankLine) +
      (payout.paidAt ? payoutEmailRow('Paid on', fmtEmailDate(payout.paidAt)) : '') +
      '</table>' +
      '<p style="margin:0 0 16px"><a href="' + escapeHtml(siteUrl() + '/influencer-admin.html') + '" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">View your payout history</a></p>' +
      '<p style="font-size:12px;color:#94a3b8;margin:20px 0 0">Thank you for growing Unisocials. We use this address for your payout notifications only.</p>' +
      '</div></div>';
    let sent = false;
    if (brevoApiKey()) sent = !!(await sendBrevoEmail(to, subject, text, html, payout.requesterName));
    if (!sent && resendKey()) {
      const r = await postJson('api.resend.com', '/emails', { 'Authorization': 'Bearer ' + resendKey() }, { from: process.env.EMAIL_FROM || defaults.EMAIL_FROM, to: [to], subject: subject, text: text, html: html });
      sent = r.status >= 200 && r.status < 300;
    }
    return sent;
  } catch (e) {
    console.warn('Payout status email error:', e.message);
    return false;
  }
}

// Plain-text digest of the order for the email body
function orderEmailLines(order) {
  const site = siteUrl();
  const codes = order.ticketCodes || [];
  let ticketLines = '';
  if (codes.length) {
    ticketLines = '\n\nYour digital ticket(s):\n';
    codes.forEach((t, i) => {
      ticketLines += (i + 1) + '. ' + t.code + ' — ' + site + '/ticket.html?orderId=' + encodeURIComponent(order.orderId) + '&code=' + encodeURIComponent(t.code) + '\n';
    });
  }
  return {
    subject: 'Ticket Confirmation — ' + order.eventName + ' (' + order.orderId + ')',
    text:
      'Hi ' + (order.buyerName || 'there') + ',\n\n' +
      'Your payment has been confirmed! Here are your ticket details:\n\n' +
      'Order ID: ' + order.orderId + '\n' +
      'Event: ' + order.eventName + '\n' +
      'Category: ' + (order.eventCategory || '—') + '\n' +
      'Date: ' + (order.eventDate || '—') + '\n' +
      'Venue: ' + (order.eventVenue || '—') + '\n' +
      'Quantity: ' + order.qty + '\n' +
      'Total paid: ₦' + Number(order.amount || 0).toLocaleString() + ' ' + (order.currency || 'NGN') + '\n' +
      ticketLines +
      '\nNo account needed — these ticket links work straight from your email.\n' +
      'Please keep this email safe, it is your copy of your tickets.\n' +
      'See you at the event!\n\nUnisocials Team'
  };
}

// Build the buyer confirmation HTML (shared by Brevo + Resend providers)
function buildBuyerHtml(order) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
    '<div style="background:#1B5E20;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">Unisocials — Ticket Confirmation 🎟️</div>' +
    '<div style="padding:24px">' +
    '<p style="margin:0 0 16px">Hi <strong>' + escapeHtml(order.buyerName || 'there') + '</strong>,</p>' +
    '<p style="margin:0 0 16px;color:#475569">Your payment has been confirmed! Here are your ticket details:</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">' +
    rowHtml('Order ID', escapeHtml(order.orderId)) +
    rowHtml('Event', escapeHtml(order.eventName)) +
    rowHtml('Category', escapeHtml(order.eventCategory || '—')) +
    rowHtml('Date', escapeHtml(order.eventDate || '—')) +
    rowHtml('Venue', escapeHtml(order.eventVenue || '—')) +
    rowHtml('Quantity', String(order.qty)) +
    rowHtml('Total paid', '₦' + Number(order.amount || 0).toLocaleString() + ' ' + (order.currency || 'NGN')) +
    '</table>' +
    ticketLinksHtml(order) +
    '<p style="font-size:13px;color:#475569;margin:20px 0 6px"><strong>No account needed.</strong> The ticket links above open straight from this email — there is nothing to sign up for or sign in to.</p>' +
    '<p style="font-size:12px;color:#94a3b8;margin:0">Please keep this email safe, it is your copy of your tickets.</p>' +
    '</div></div>';
}

// Send the immediate post-purchase acknowledgement BEFORE admin verification.
// This email confirms that the purchase/payment submission was received; it does
// NOT contain tickets. Tickets are sent only after an admin/server verification.
// Best-effort and non-blocking so the purchase flow is never held up by email.
async function sendBuyerPurchaseAcknowledgement(order) {
  try {
    const email = String(order && order.buyerEmail || '').trim();
    if (!email) return false;
    const name = order.buyerName || 'there';
    const subject = 'Payment received — your Unisocials tickets will be sent shortly';
    const text =
      'Hi ' + name + ',\n\n' +
      'Thank you for your purchase on Unisocials. We have received your payment submission.\n\n' +
      'Your tickets will be sent to you shortly after your payment is verified. Please keep an eye on your inbox (and your spam/junk folder just in case).\n\n' +
      'Order ID: ' + order.orderId + '\n' +
      'Event: ' + order.eventName + '\n' +
      'Quantity: ' + order.qty + '\n\n' +
      'Thank you for choosing Unisocials.\n\nUnisocials Team';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
      '<div style="background:#1B5E20;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">Payment Received ✓</div>' +
      '<div style="padding:24px">' +
      '<p style="margin:0 0 16px">Hi <strong>' + escapeHtml(name) + '</strong>,</p>' +
      '<p style="margin:0 0 16px;color:#475569">Thank you for your purchase on Unisocials. We have received your payment submission.</p>' +
      '<p style="margin:0 0 16px;color:#0f172a;font-weight:600">Your tickets will be sent to you shortly after your payment is verified.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">' +
      rowHtml('Order ID', escapeHtml(order.orderId)) +
      rowHtml('Event', escapeHtml(order.eventName)) +
      rowHtml('Quantity', String(order.qty)) +
      '</table>' +
      '<p style="font-size:12px;color:#64748b;margin:0">Please keep an eye on your inbox and check your spam/junk folder if you do not see the ticket email.</p>' +
      '<p style="font-size:12px;color:#94a3b8;margin:20px 0 0">Unisocials Team</p>' +
      '</div></div>';

    if (brevoApiKey()) {
      const sent = await sendBrevoEmail(email, subject, text, html, name);
      if (sent) console.log('Immediate purchase acknowledgement sent via Brevo to', email);
      return !!sent;
    }
    const key = resendKey();
    if (!key) {
      console.warn('Buyer acknowledgement not sent: no BREVO_API_KEY or RESEND_API_KEY configured');
      return false;
    }
    const r = await postJson('api.resend.com', '/emails', { 'Authorization': 'Bearer ' + key }, {
      from: emailFrom(), to: [email], subject: subject, text: text, html: html
    });
    if (r.status === 200) {
      console.log('Immediate purchase acknowledgement sent via Resend to', email);
      return true;
    }
    console.warn('Resend purchase acknowledgement failed (' + r.status + '):', r.body && r.body.slice(0, 200));
    return false;
  } catch (e) {
    console.warn('Buyer purchase acknowledgement error:', e.message);
    return false;
  }
}

// Send buyer ticket email. Prefers Brevo and falls back to Resend.
// Best-effort: never throws / never blocks the payment response.
async function sendBuyerConfirmation(order) {
  try {
    const email = order.buyerEmail;
    if (!email) return;
    const lines = orderEmailLines(order);
    const html = buildBuyerHtml(order);

    // Brevo first — delivers to ANY client email without a verified domain
    if (brevoApiKey()) {
      const sent = await sendBrevoEmail(email, lines.subject, lines.text, html, order.buyerName || '');
      if (sent) console.log('Buyer confirmation email sent via Brevo to', email);
      return;
    }

    // Fallback: Resend
    const key = resendKey();
    if (!key) return;
    const payload = {
      from: emailFrom(),
      to: [email],
      subject: lines.subject,
      text: lines.text,
      html: html
    };
    const r = await postJson('api.resend.com', '/emails', { 'Authorization': 'Bearer ' + key }, payload);
    if (r.status === 200) {
      console.log('Buyer confirmation email sent via Resend to', email);
    } else {
      console.warn('Resend buyer email failed (' + r.status + '):', r.body && r.body.slice(0, 200));
    }
  } catch (e) {
    console.warn('Buyer email error:', e.message);
  }
}

// Admin instant alert — sends via Resend (primary), falls back to Brevo so it
// always lands immediately even if the Resend key is unavailable.
async function sendAdminAlert(order) {
  try {
    const key = resendKey();
    const to = adminEmail();
    if (!to) return;
    const site = siteUrl();
    const codes = order.ticketCodes || [];
    let ticketList = '';
    if (codes.length) {
      ticketList = '<ul>';
      codes.forEach(function(t) {
        ticketList += '<li>' + escapeHtml(t.code) + ' — <a href="' + site + '/ticket.html?orderId=' + encodeURIComponent(order.orderId) + '&code=' + encodeURIComponent(t.code) + '">view</a></li>';
      });
      ticketList += '</ul>';
    }
    const payload = {
      from: emailFrom(),
      to: [to],
      subject: '💸 New payment received — ' + order.orderId + ' — ₦' + Number(order.amount || 0).toLocaleString(),
      text:
        'New payment confirmed!\n\n' +
        'Order ID: ' + order.orderId + '\n' +
        'Event: ' + order.eventName + '\n' +
        'Category: ' + (order.eventCategory || '—') + '\n' +
        'Date: ' + (order.eventDate || '—') + '\n' +
        'Venue: ' + (order.eventVenue || '—') + '\n' +
        'Qty: ' + order.qty + '\n' +
        'Amount: ₦' + Number(order.amount || 0).toLocaleString() + ' ' + (order.currency || 'NGN') + '\n' +
        'Buyer: ' + order.buyerName + '\n' +
        'Email: ' + order.buyerEmail + '\n' +
        'Phone: ' + order.buyerPhone + '\n' +
        'Paid at: ' + (order.verifiedAt || new Date().toISOString()) + '\n\n' +
        'View in admin: ' + site + '/admin.html\n'
      ,
      html: '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
        '<div style="background:#B71C1C;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">💸 New Payment Received</div>' +
        '<div style="padding:24px">' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">' +
        rowHtml('Order ID', escapeHtml(order.orderId)) +
        rowHtml('Event', escapeHtml(order.eventName)) +
        rowHtml('Category', escapeHtml(order.eventCategory || '—')) +
        rowHtml('Date', escapeHtml(order.eventDate || '—')) +
        rowHtml('Venue', escapeHtml(order.eventVenue || '—')) +
        rowHtml('Qty', String(order.qty)) +
        rowHtml('Amount', '₦' + Number(order.amount || 0).toLocaleString() + ' ' + (order.currency || 'NGN')) +
        rowHtml('Buyer', escapeHtml(order.buyerName || '')) +
        rowHtml('Email', escapeHtml(order.buyerEmail || '')) +
        rowHtml('Phone', escapeHtml(order.buyerPhone || '')) +
        rowHtml('Paid at', escapeHtml(order.verifiedAt || new Date().toISOString())) +
        '</table>' +
        (ticketList ? '<div style="margin-bottom:16px"><strong>Tickets:</strong>' + ticketList + '</div>' : '') +
        '<a href="' + site + '/admin.html" style="display:inline-block;background:#1B5E20;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none">Open Admin Dashboard</a>' +
        '</div></div>'
    };
    if (key) {
      const r = await postJson('api.resend.com', '/emails', { 'Authorization': 'Bearer ' + key }, payload);
      if (r.status === 200) {
        console.log('Admin alert email sent to', to);
        return;
      }
      console.warn('Admin alert failed via Resend (' + r.status + '):', r.body && r.body.slice(0, 200));
    }
    // Brevo fallback — so admin alerts still land even if Resend is unavailable
    const bsent = await sendBrevoEmail(to, payload.subject, payload.text, payload.html);
    if (bsent) console.log('Admin alert email sent via Brevo to', to);
  } catch (e) {
    console.warn('Admin alert error:', e.message);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c];
  });
}
function rowHtml(label, value) {
  return '<tr><td style="padding:8px 10px;border-bottom:1px solid #eef2f7;color:#64748b;width:40%">' + label + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;color:#0f172a;font-weight:600">' + value + '</td></tr>';
}
function ticketLinksHtml(order) {
  const site = siteUrl();
  const codes = order.ticketCodes || [];
  if (!codes.length) return '';
  let html = '<div style="margin-bottom:12px"><strong style="display:block;margin-bottom:8px">Your tickets:</strong>';
  codes.forEach(function(t, i) {
    html += '<a href="' + site + '/ticket.html?orderId=' + encodeURIComponent(order.orderId) + '&code=' + encodeURIComponent(t.code) +
      '" style="display:block;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:10px 14px;border-radius:8px;text-decoration:none;margin-bottom:6px">' +
      'Ticket ' + (i + 1) + ' — ' + escapeHtml(t.code) + ' → View & QR</a>';
  });
  html += '</div>';
  return html;
}

// Fire ONLY the ticket-delivery email after an order becomes verified.
// The pre-verification acknowledgement is sent when the order is first created.
// This separation guarantees that no ticket links are emailed before verification.
async function notifyOrderVerified(order) {
  try {
    sendAdminAlert(order);
    setTimeout(function() {
      try { sendBuyerConfirmation(order); } catch (e) { console.warn('Delayed buyer ticket email error:', e.message); }
    }, 1500);
  } catch (e) {
    console.warn('notifyOrderVerified error:', e.message);
  }
}

// Admin instant alert when a NEW order is placed (payment NOT confirmed yet).
// The admin uses this to watch for the payment and verify it in the dashboard.
// Sends via Resend (primary), falls back to Brevo so the alert always lands.
async function sendNewOrderAlert(order) {
  try {
    const key = resendKey();
    const to = adminEmail();
    if (!to) return;
    const site = siteUrl();
    const payload = {
      from: emailFrom(),
      to: [to],
      subject: '🛒 New order awaiting verification — ' + order.orderId + ' — ₦' + Number(order.amount || 0).toLocaleString(),
      text:
        'A new order has been placed and is awaiting payment verification.\n\n' +
        'Order ID: ' + order.orderId + '\n' +
        'Event: ' + order.eventName + '\n' +
        'Category: ' + (order.eventCategory || '—') + '\n' +
        'Date: ' + (order.eventDate || '—') + '\n' +
        'Venue: ' + (order.eventVenue || '—') + '\n' +
        'Qty: ' + order.qty + '\n' +
        'Amount: ₦' + Number(order.amount || 0).toLocaleString() + ' ' + (order.currency || 'NGN') + '\n' +
        'Buyer: ' + order.buyerName + '\n' +
        'Email: ' + order.buyerEmail + '\n' +
        'Phone: ' + order.buyerPhone + '\n\n' +
        'Go to the admin dashboard to verify the payment: ' + site + '/admin.html\n'
      ,
      html: '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
        '<div style="background:#E65100;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">🛒 New Order — Awaiting Payment Verification</div>' +
        '<div style="padding:24px">' +
        '<p style="margin:0 0 16px;color:#475569">A new order was just placed. Please confirm the payment and verify it in the dashboard.</p>' +
        '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">' +
        rowHtml('Order ID', escapeHtml(order.orderId)) +
        rowHtml('Event', escapeHtml(order.eventName)) +
        rowHtml('Category', escapeHtml(order.eventCategory || '—')) +
        rowHtml('Date', escapeHtml(order.eventDate || '—')) +
        rowHtml('Venue', escapeHtml(order.eventVenue || '—')) +
        rowHtml('Qty', String(order.qty)) +
        rowHtml('Amount', '₦' + Number(order.amount || 0).toLocaleString() + ' ' + (order.currency || 'NGN')) +
        rowHtml('Buyer', escapeHtml(order.buyerName || '')) +
        rowHtml('Email', escapeHtml(order.buyerEmail || '')) +
        rowHtml('Phone', escapeHtml(order.buyerPhone || '')) +
        '</table>' +
        '<a href="' + site + '/admin.html" style="display:inline-block;background:#E65100;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none">Verify Payment in Admin</a>' +
        '</div></div>'
    };
    if (key) {
      const r = await postJson('api.resend.com', '/emails', { 'Authorization': 'Bearer ' + key }, payload);
      if (r.status === 200) {
        console.log('New-order admin alert sent to', to);
        return;
      }
      console.warn('New-order alert failed via Resend (' + r.status + '):', r.body && r.body.slice(0, 200));
    }
    // Brevo fallback — so the new-order alert still lands even if Resend is unavailable
    const bsent = await sendBrevoEmail(to, payload.subject, payload.text, payload.html);
    if (bsent) console.log('New-order admin alert sent via Brevo to', to);
  } catch (e) {
    console.warn('New-order alert error:', e.message);
  }
}

// Fire only the admin alert when an order is created.
// The buyer's payment-received acknowledgement is sent only after the server
// verifies the Flutterwave transaction. Actual tickets are sent only from
// notifyOrderVerified() after the order becomes verified.
function notifyNewOrder(order) {
  try {
    sendNewOrderAlert(order);
  } catch (e) { console.warn('notifyNewOrder error:', e.message); }
}

// ────────────────────────────────────────────
// EVENT NOTIFICATION EMAILS (subscribers)
// ────────────────────────────────────────────
// Email a subscriber about an event (type = 'new' announcement or 'reminder').
async function sendEventEmailToSubscriber(sub, ev, type) {
  try {
    const to = sub && sub.email;
    if (!to || !ev) return false;
    const site = siteUrl();
const isReminder = type === 'reminder' || type === 'today';
    const isToday = type === 'today';
    const headline = isToday ? '🎉 Happening Today' : (isReminder ? '⏰ Event Reminder' : '🎉 New Event Announced');
    const intro = isToday
      ? 'Great news — this event is happening today!'
      : (isReminder ? 'Just a reminder that this event is happening:' : 'There is a new event at ' + escapeHtml(ev.universityName || 'your campus') + ':');
    const subject = isToday
      ? '🎉 Happening TODAY: ' + ev.name + ' — ' + (ev.date || '') + '!'
      : isReminder
        ? '⏰ Reminder: ' + ev.name + ' — happening ' + (ev.date || 'soon') + '!'
        : '🎉 New event on Unisocials: ' + ev.name;
    const text =
      'Hi ' + (sub.name || 'there') + ',\n\n' +
      (isReminder ? 'This is a friendly reminder that this event is happening:\n\n'
                 : 'There is a new event at ' + (ev.universityName || 'your campus') + ':\n\n') +
      'Event: ' + ev.name + '\n' +
      'Category: ' + (ev.category || '—') + '\n' +
      'Date: ' + (ev.date || '—') + ' ' + (ev.time || '') + '\n' +
      'Venue: ' + (ev.venue || '—') + '\n' +
      'Price: ₦' + Number(ev.price || 0).toLocaleString() + '\n\n' +
      'Get your tickets: ' + site + '/tickets.html?event=' + encodeURIComponent(ev.id || '') + '\n\n' +
      (isReminder ? 'See you there!\n\nUnisocials Team' : 'Don\'t miss out!\n\nUnisocials Team');
const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
      '<div style="background:' + (isToday ? '#B71C1C' : (isReminder ? '#E65100' : '#1B5E20')) + ';color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">' + headline + '</div>' +
      '<div style="padding:24px">' +
      '<p style="margin:0 0 16px">Hi <strong>' + escapeHtml(sub.name || 'there') + '</strong>,</p>' +
      '<p style="margin:0 0 16px;color:#475569">' + intro + '</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">' +
      rowHtml('Event', escapeHtml(ev.name)) +
      rowHtml('Category', escapeHtml(ev.category || '—')) +
      rowHtml('Date', escapeHtml((ev.date || '—') + ' ' + (ev.time || ''))) +
      rowHtml('Venue', escapeHtml(ev.venue || '—')) +
      rowHtml('Price', '₦' + Number(ev.price || 0).toLocaleString()) +
      '</table>' +
      '<a href="' + site + '/tickets.html?event=' + encodeURIComponent(ev.id || '') + '" style="display:inline-block;background:#1B5E20;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none">Get Tickets</a>' +
      '<p style="font-size:12px;color:#94a3b8;margin:20px 0 0">You are receiving this because you subscribed to event notifications for ' + escapeHtml(ev.universityName || 'your campus') + '.</p>' +
      '</div></div>';
    const sent = await sendBrevoEmail(to, subject, text, html, sub.name || '');
    if (sent) console.log('Event ' + type + ' email sent to ' + to + ' for "' + ev.name + '"');
    return sent ? true : false;
  } catch (e) {
    console.warn('Event notification email error:', e.message);
    return false;
  }
}

// Notify all subscribers of an event's university about that event (best-effort).
async function notifySubscribersAboutEvent(ev) {
  try {
    const subs = await readSubscribers();
    const matched = subs.filter(s => !ev.universityId || s.universityId === ev.universityId);
    if (!matched.length) return;
    let sent = 0;
    await Promise.all(matched.map(async function(s) {
      const ok = await sendEventEmailToSubscriber(s, ev, 'new');
      if (ok) sent++;
    }));
console.log('Notified ' + sent + ' subscriber(s) about "' + ev.name + '"');
    return sent;
  } catch (e) {
    console.warn('notifySubscribersAboutEvent error:', e.message);
    return 0;
  }
}

// Weekly reminder job — emails subscribers of events happening within the next 7 days.
// Events happening TODAY get a special "happening now" reminder so subscribers are
// pinged the day of the event (in addition to the standard up-to-7-days reminder).
async function runEventReminders() {
  try {
    const events = await readEvents();
    const now = new Date();
    const todayKey = now.toDateString();
    const upcoming = events.filter(function(ev) {
      if (!ev.date) return false;
      const d = new Date(ev.date);
      if (isNaN(d)) return false;
      const diffDays = (d - now) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 7;
    });
    if (!upcoming.length) return;
    const subs = await readSubscribers();
    let sent = 0;
    for (const ev of upcoming) {
      const evDate = new Date(ev.date);
      const isToday = !isNaN(evDate) && evDate.toDateString() === todayKey;
      const type = isToday ? 'today' : 'reminder';
      const matched = subs.filter(s => !ev.universityId || s.universityId === ev.universityId);
      for (const s of matched) {
        const ok = await sendEventEmailToSubscriber(s, ev, type);
        if (ok) sent++;
      }
    }
    if (sent) console.log('Event reminder job sent ' + sent + ' reminder email(s).');
  } catch (e) {
    console.warn('runEventReminders error:', e.message);
  }
}

// Run reminder job every 6 hours (non-blocking).
setInterval(function() {
  try { runEventReminders(); } catch (e) {}
}, 6 * 60 * 60 * 1000);

// ────────────────────────────────────────────
// HTTP SERVER
// ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  for (const [key, value] of Object.entries(securityHeaders(req))) res.setHeader(key, value);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    if (pathname === '/api/contact' && req.method === 'POST') {
      const rl = rateLimit(req, 'contact', 5, 60000);
      if (!rl.allowed) return sendJson(res, 429, { success: false, error: 'Too many messages. Please try again shortly.' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim();
      const phone = String(data.phone || '').trim();
      const subject = String(data.subject || '').trim();
      const message = String(data.message || '').trim();
      if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !subject || subject.length > 120 || !message || message.length > 5000) {
        return sendJson(res, 400, { success: false, error: 'Please complete the form with a valid name, email, subject, and message.' });
      }
      const delivery = await sendContactEmail({ name, email, phone, subject, message });
      if (!delivery.sent) {
        const error = delivery.configured
          ? 'Email provider rejected the message. Check the sender verification and API key in Render.'
          : 'No email provider is configured. Add BREVO_API_KEY or RESEND_API_KEY in Render.';
        return sendJson(res, 503, { success: false, error: error, provider: delivery.provider || null });
      }
      return sendJson(res, 200, { success: true });
    }

    // Lightweight health/keep-alive endpoint.
    // Deliberately performs no database queries or external API calls so periodic
    // uptime checks keep the web service warm without consuming Neon compute.
    if (pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, withSecurityHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }));
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(JSON.stringify({ status: 'ok' }));
      }
      return;
    }

    // ── Dynamic config.js ──
    if (pathname === '/config.js') {
      const cfg = getConfig();
      const js = '/* Generated by server.js from environment variables */\nwindow.SITE_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n';
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(js);
      return;
    }

// ── AUTH: Register (rate-limited) ──
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const rl = rateLimit(req, 'register', 5, 60000); // 5/min per IP
      if (!rl.allowed) {
        res.writeHead(429, withSecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) }));
        res.end(JSON.stringify({ success: false, error: 'Too many attempts. Please try again later.' }));
        return;
      }
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim().toLowerCase();
      const phone = String(data.phone || '').trim();
      const password = String(data.password || '');

      const passwordError = validatePassword(password);
      const emailError = validateEmail(email);
      const phoneError = validatePhone(phone);
      if (!name || !email || !phone || passwordError || emailError || phoneError) {
        return sendJson(res, 400, { success: false, error: passwordError || emailError || phoneError || 'Please provide name, email and phone.' });
      }
      const existing = await findUserByEmail(email);
      if (existing) {
        return sendJson(res, 409, { success: false, error: 'An account with this email already exists. Please log in.' });
      }
const user = {
        id: 'USR-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        name: name,
        email: email,
        phone: phone,
        passwordHash: hashPassword(password),
        role: 'buyer',
        createdAt: new Date().toISOString()
      };
      await addUser(user);
      const token = generateToken();
      await createSession(token, user.id);
      return sendJson(res, 200, { success: true, token: token, user: publicUser(user) });
    }

// ── PUBLIC: request a self-service Influencer Admin account ──
// The applicant gives their name, their real email and their university. We mint
// the login as <name>@unisocials.com, generate a one-time password and email both
// to the address they signed up with. Instant approval, as requested.
if (pathname === '/api/influencer-admin-requests' && req.method === 'POST') {
  const rl = rateLimit(req, 'influencer-admin-request', 5, 60000); // 5/min per IP
  if (!rl.allowed) {
    res.writeHead(429, withSecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) }));
    res.end(JSON.stringify({ success: false, error: 'Too many attempts. Please try again later.' }));
    return;
  }
  const body = await readBody(req);
  let data = {}; try { data = JSON.parse(body || '{}'); } catch (e) {}
  const name = String(data.name || '').trim().replace(/\s+/g, ' ');
  const contactEmail = String(data.email || '').trim().toLowerCase();
  const university = String(data.university || '').trim();
  if (name.length < 2 || name.length > 80) {
    return sendJson(res, 400, { success: false, error: 'Please enter your full name.' });
  }
  const emailError = validateEmail(contactEmail);
  if (emailError) return sendJson(res, 400, { success: false, error: emailError });
  // This address is the account's real inbox: it receives the login details and
  // every payout update, so it must not be one of our internal @unisocials.com
  // logins, which can never receive mail.
  if (isInternalLoginEmail(contactEmail)) {
    return sendJson(res, 400, { success: false, error: 'Use your real email address (Gmail, Yahoo, Outlook) — we send your login details and payout updates there.' });
  }
  if (!university || university.length > 120) {
    return sendJson(res, 400, { success: false, error: 'Please select your university.' });
  }

  const users = await readUsers();
  // One account per real address: otherwise anyone could farm accounts by
  // re-submitting the same inbox with variations of the same name.
  const alreadyRegistered = users.find(u => String(u.contactEmail || '').trim().toLowerCase() === contactEmail);
  if (alreadyRegistered) {
    return sendJson(res, 409, { success: false, error: 'An Influencer Admin account has already been created for ' + contactEmail + '. Check your inbox for your login details, or reset your password from the sign-in page.' });
  }

  // <name>@unisocials.com, uniquified if that name is already taken.
  const built = await buildSelfServiceStaffUser({
    name, contactEmail, role: 'influencer_admin', prefix: 'IADM-',
    extra: { university: university }
  });
  if (!built) {
    return sendJson(res, 409, { success: false, error: 'That name is already taken on Unisocials. Please request the account using a slightly different full name.' });
  }
  const user = built.user;
  const password = built.password;
  const loginEmail = user.email;
  await addUser(user);
  // Never let a mail failure leave somebody locked out of an account that exists.
  const emailSent = await sendInfluencerAdminCredentialsEmail(user, password);
  return sendJson(res, 200, {
    success: true,
    loginEmail: loginEmail,
    emailSent: emailSent,
    // The password is only echoed back when the email could not be delivered,
    // so the applicant can still get in. Change it after the first sign in.
    credentials: emailSent ? null : { email: loginEmail, password: password },
    message: emailSent
      ? 'Your Influencer Admin account is ready — we emailed your login email and password to ' + contactEmail + '.'
      : 'Your Influencer Admin account is ready. We could not send the email, so save the login details below now.'
  });
}

// ── Check-in staff: create + list, for Influencer Admins (and self-service) ──
// ⚠️ SCOPE: the self-service path lets anyone who knows the site create a gate
// account. A checkin_staff can only scan tickets (mark a code used) — they get
// no orders, events, payouts or account access — but that is still gate access.
// If that is too open, gate the POST behind an Influencer Admin session and keep
// only the dashboard flow; the rest of this route is unchanged.
// An Influencer Admin running an event needs staff who can scan tickets at the
// gate. They get the same <name>@unisocials.com login convention as an Influencer
// Admin, but the role is checkin_staff, so they sign in at /checkin.html and can
// do nothing else. The password is emailed to the address they supplied.
if (pathname === '/api/checkin-staff' && (req.method === 'GET' || req.method === 'POST')) {
  const authCtx = await isAdminOrInfluencerAdmin(req);

  // ── List: an Influencer Admin sees only the staff they created ──
  if (req.method === 'GET') {
    if (!authCtx || !['admin', 'influencer_admin'].includes(authCtx.role)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized' });
    }
    const users = await readUsers();
    let staff = users.filter(u => u.role === 'checkin_staff');
    if (authCtx.role === 'influencer_admin') {
      const me = String((authCtx.user && authCtx.user.id) || '').trim();
      const myEmail = String((authCtx.user && authCtx.user.email) || '').trim().toLowerCase();
      // Never fall back to "see everything": an unscoped list would leak the
      // main admin's gate teams.
      staff = staff.filter(u =>
        String(u.createdById || '').trim() === me ||
        String(u.createdByEmail || '').trim().toLowerCase() === myEmail
      );
    }
    return sendJson(res, 200, { success: true, staff: staff.map(checkinStaffPublic) });
  }

  // ── Create ──
  const rl = rateLimit(req, 'checkin-staff-request', 10, 60000); // 10/min per IP
  if (!rl.allowed) {
    res.writeHead(429, withSecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) }));
    res.end(JSON.stringify({ success: false, error: 'Too many attempts. Please try again later.' }));
    return;
  }
  const body = await readBody(req);
  let data = {}; try { data = JSON.parse(body || '{}'); } catch (e) {}
  const name = String(data.name || '').trim().replace(/\s+/g, ' ');
  const contactEmail = String(data.email || '').trim().toLowerCase();
  const requestedEvent = String(data.eventName || '').trim().slice(0, 120);

  if (name.length < 2 || name.length > 80) {
    return sendJson(res, 400, { success: false, error: 'Please enter the staff member\u2019s full name.' });
  }
  const emailError = validateEmail(contactEmail);
  if (emailError) return sendJson(res, 400, { success: false, error: emailError });

  // Either an Influencer Admin adds someone from their dashboard, or the person
  // signs themselves up from the public check-in signup page. Both paths mint
  // the same <name>@unisocials.com login and email the password to the address
  // given, so nobody has to hand-carry a password.
  const createdByAdmin = !!(authCtx && ['admin', 'influencer_admin'].includes(authCtx.role));
  // isAdminOrInfluencerAdmin returns null both for "no session" and for "a session
  // that is not allowed here". Resolve the session directly so a signed-in buyer
  // or check-in staff member is rejected rather than silently treated as anonymous.
  const callerToken = (req.headers['authorization'] || '').startsWith('Bearer ')
    ? (req.headers['authorization'] || '').slice(7).trim()
    : '';
  const callerUser = callerToken ? await getSessionUser(callerToken) : null;
  if (callerUser && !createdByAdmin) {
    return sendJson(res, 401, { success: false, error: 'Sign in as an Influencer Admin to add check-in staff.' });
  }
  if (!requestedEvent) {
    return sendJson(res, 400, { success: false, error: 'Please choose which event this person will work.' });
  }

  // An Influencer Admin may only staff their OWN events: one they created, or
  // one they were explicitly authorized to. The dropdown is a convenience, not
  // the control — an Influencer Admin must not be able to post someone onto
  // another admin's gate by naming that event.
  let eventName = requestedEvent;
  if (authCtx && authCtx.role === 'influencer_admin') {
    const allEvents = await readEvents();
    const mine = influencerAdminVisibleEvents(authCtx, allEvents);
    const target = mine.find(ev => String(ev.name || '').trim().toLowerCase() === requestedEvent.toLowerCase());
    if (!target) {
      return sendJson(res, 403, {
        success: false,
        error: 'You can only add check-in staff for events you created or were authorised to.'
      });
    }
    // Use the event's own stored name, so case/whitespace variants are recorded
    // exactly as the event spells it.
    eventName = String(target.name || '').trim();
  }

  const users = await readUsers();
  const alreadyRegistered = users.find(u => String(u.contactEmail || '').trim().toLowerCase() === contactEmail);
  if (alreadyRegistered) {
    return sendJson(res, 409, { success: false, error: 'A Unisocials account has already been created for ' + contactEmail + '.' });
  }

  const built = await buildSelfServiceStaffUser({
    name, contactEmail, role: 'checkin_staff', prefix: 'CHK-',
    extra: {
      eventName: eventName,
      // Recorded so the creator can list and later revoke only their own staff.
      // A self-service signup has no creator, so it lands in nobody's list and is
      // only visible to the Main Admin through Staff Accounts.
      createdById: createdByAdmin && authCtx.role !== 'admin' ? String((authCtx.user && authCtx.user.id) || '') : '',
      createdByEmail: createdByAdmin && authCtx.role !== 'admin' ? String((authCtx.user && authCtx.user.email) || '').toLowerCase() : '',
      createdByRole: createdByAdmin ? authCtx.role : 'self',
    }
  });
  if (!built) {
    return sendJson(res, 409, { success: false, error: 'That name is already taken on Unisocials. Please add the staff member using a slightly different full name.' });
  }
  const user = built.user;
  const password = built.password;
  await addUser(user);

  const emailSent = await sendCheckinStaffCredentialsEmail(user, password);
  return sendJson(res, 200, {
    success: true,
    staff: checkinStaffPublic(user),
    loginEmail: user.email,
    emailSent: emailSent,
    // Only echoed back when the email could not be delivered, so nobody who
    // was genuinely added ends up locked out of an account that exists.
    credentials: emailSent ? null : { email: user.email, password: password },
    message: emailSent
      ? 'Check-in staff account created — we emailed the login details to ' + contactEmail + '.'
      : 'Check-in staff account created. We could not send the email, so share these login details with them now.'
  });
}

// ── Events an Influencer Admin may staff ──
// The Check-in Staff dropdown must only offer events this Influencer Admin
// created or was authorised to. The public /api/events list is every event on
// the site, so using it here would invite them to pick somebody else's event.
if (pathname === '/api/checkin-staff/events' && req.method === 'GET') {
  const authCtx = await isAdminOrInfluencerAdmin(req);
  if (!authCtx || !['admin', 'influencer_admin'].includes(authCtx.role)) {
    return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  }
  const allEvents = await readEvents();
  const scoped = authCtx.role === 'influencer_admin'
    ? influencerAdminVisibleEvents(authCtx, allEvents)
    : allEvents.filter(ev => ev.archived !== true);
  return sendJson(res, 200, {
    success: true,
    events: scoped.filter(ev => ev.archived !== true).map(ev => ({ id: ev.id, name: ev.name }))
  });
}

// Check-in staff must never see bank details, hashes or the real contact address.
function checkinStaffPublic(user) {
  return {
    id: user.id,
    name: user.name,
    loginEmail: user.email,
    eventName: user.eventName || '',
    role: 'checkin_staff',
    createdAt: user.createdAt,
    archived: user.archived === true
  };
}

// ── AUTH: Login (rate-limited) ──
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const rl = rateLimit(req, 'login', 10, 60000); // 10/min per IP
      if (!rl.allowed) {
        res.writeHead(429, withSecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) }));
        res.end(JSON.stringify({ success: false, error: 'Too many attempts. Please try again later.' }));
        return;
      }
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      // Trim here too: account creation trims the password, so a password
      // entered/pasted with a leading/trailing space must still match.
      const password = String(data.password || '').trim();
      if (!email || !password) {
        return sendJson(res, 400, { success: false, error: 'Please enter your email and password.' });
      }
      const user = await findUserByEmail(email);
      if (user && user.archived === true) {
        return sendJson(res, 403, { success: false, error: 'This account has been archived and cannot be used. Please contact an administrator.' });
      }
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { success: false, error: 'Invalid email or password.' });
      }
      const token = generateToken();
      await createSession(token, user.id);
      return sendJson(res, 200, { success: true, token: token, user: publicUser(user) });
    }

    // ── Influencer Admin: search existing influencer accounts to request ──
    // This does NOT create a second account. It only lets an Influencer Admin
    // start a relationship with an influencer who already has a login.
    if (pathname === '/api/influencer-admin/influencers/search' && req.method === 'GET') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const search = String(url.searchParams.get('q') || '').trim().toLowerCase();
      if (!search || search.length < 2) return sendJson(res, 400, { success: false, error: 'Enter at least 2 characters to search.' });
      if (search.length > 120) return sendJson(res, 400, { success: false, error: 'Search term is too long.' });
      const users = await readUsers();
      const myId = String(authCtx.user.id || '').trim();
      const matches = users
        .filter(u => u && u.role === 'influencer' && u.archived !== true)
        .filter(u => {
          if (!search) return true;
          return String(u.name || '').toLowerCase().includes(search) || String(u.email || '').toLowerCase().includes(search);
        })
        .slice(0, 25)
        .map(u => {
          const assignment = getInfluencerAssignments(u).find(a => a.influencerAdminId === myId) || null;
          return {
            id: u.id,
            name: u.name || '',
            email: u.email || '',
            assignmentStatus: assignment ? assignment.status : 'none',
            assignmentId: assignment ? assignment.id : null
          };
        });
      return sendJson(res, 200, { success: true, influencers: matches });
    }

    // ── Influencer Admin: request an existing influencer ──
    if (pathname === '/api/influencer-admin/influencer-requests' && req.method === 'POST') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const influencerId = String(data.influencerId || '').trim();
      if (!influencerId || influencerId.length > 120) return sendJson(res, 400, { success: false, error: 'A valid influencer is required.' });
      const users = await readUsers();
      const index = users.findIndex(u => u && u.id === influencerId && u.role === 'influencer');
      if (index < 0) return sendJson(res, 404, { success: false, error: 'Influencer not found.' });
      if (users[index].archived === true) return sendJson(res, 409, { success: false, error: 'This influencer account is archived.' });

      const myId = String(authCtx.user.id || '').trim();
      const influencer = Object.assign({}, users[index]);
      const assignments = getInfluencerAssignments(influencer);
      const existing = assignments.find(a => a.influencerAdminId === myId) || null;
      if (existing && existing.status === 'accepted') return sendJson(res, 409, { success: false, error: 'This influencer already works with your Influencer Admin account.', status: 'accepted' });
      if (existing && existing.status === 'pending') return sendJson(res, 409, { success: false, error: 'A request for this influencer is already pending.', status: 'pending' });

      const now = new Date().toISOString();
      const nextAssignments = assignments.filter(a => a.influencerAdminId !== myId);
      nextAssignments.push({
        id: 'IA-ASSIGN-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
        influencerAdminId: myId,
        status: 'pending',
        requestedAt: now,
        acceptedAt: null,
        rejectedAt: null,
        legacy: false
      });
      influencer.influencerAssignments = nextAssignments;
      await replaceUser(influencer);
      return sendJson(res, 200, { success: true, status: 'pending', influencer: { id: influencer.id, name: influencer.name || '', email: influencer.email || '' } });
    }

    // ── Influencer: relationship requests ──
    // An influencer uses the same existing login to review requests from
    // Influencer Admins. No duplicate account is created and no referral code
    // is generated at this stage; code generation belongs to Step 4.
    if (pathname === '/api/influencer/relationship-requests' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'influencer') return sendJson(res, 403, { success: false, error: 'Influencer access only' });
      const assignments = getInfluencerAssignments(user);
      const users = await readUsers();
      const requests = assignments.map(a => {
        const admin = users.find(u => u && u.id === a.influencerAdminId && ['influencer_admin','influencer-admin','influencerAdmin'].includes(String(u.role)));
        return {
          id: a.id,
          influencerAdminId: a.influencerAdminId,
          status: a.status,
          requestedAt: a.requestedAt || null,
          acceptedAt: a.acceptedAt || null,
          rejectedAt: a.rejectedAt || null,
          influencerAdmin: admin ? { id: admin.id, name: admin.name || '', email: admin.email || '' } : { id: a.influencerAdminId, name: 'Influencer Admin', email: '' }
        };
      }).filter(r => ['pending','accepted','rejected'].includes(r.status));
      return sendJson(res, 200, { success: true, requests });
    }

    if (pathname === '/api/influencer/relationship-requests/respond' && req.method === 'POST') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const sessionUser = await getSessionUser(token);
      if (!sessionUser || sessionUser.role !== 'influencer') return sendJson(res, 403, { success: false, error: 'Influencer access only' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const assignmentId = String(data.assignmentId || '').trim();
      const decision = String(data.decision || '').trim().toLowerCase();
      if (!assignmentId || assignmentId.length > 120) return sendJson(res, 400, { success: false, error: 'A valid relationship request is required.' });
      if (!['accept','reject'].includes(decision)) return sendJson(res, 400, { success: false, error: 'Decision must be accept or reject.' });

      const users = await readUsers();
      const influencerIndex = users.findIndex(u => u && u.id === sessionUser.id && u.role === 'influencer');
      if (influencerIndex < 0) return sendJson(res, 404, { success: false, error: 'Influencer account not found.' });
      const influencer = Object.assign({}, users[influencerIndex]);
      const assignments = getInfluencerAssignments(influencer);
      const idx = assignments.findIndex(a => a.id === assignmentId);
      if (idx < 0) return sendJson(res, 404, { success: false, error: 'Relationship request not found.' });
      if (assignments[idx].status !== 'pending') {
        return sendJson(res, 409, { success: false, error: 'This relationship request has already been decided.', status: assignments[idx].status });
      }

      const admin = users.find(u => u && u.id === assignments[idx].influencerAdminId && ['influencer_admin','influencer-admin','influencerAdmin'].includes(String(u.role)));
      if (!admin || admin.archived === true) {
        return sendJson(res, 409, { success: false, error: 'The Influencer Admin account is no longer available.' });
      }

      const now = new Date().toISOString();
      assignments[idx] = Object.assign({}, assignments[idx], {
        status: decision === 'accept' ? 'accepted' : 'rejected',
        acceptedAt: decision === 'accept' ? now : null,
        rejectedAt: decision === 'reject' ? now : null,
        legacy: false
      });
      influencer.influencerAssignments = assignments;
      await replaceUser(influencer);

      // Acceptance creates the referral portal for this relationship. The
      // influencer keeps the same account/login; only the referral relationship
      // gets its own code.
      let referralLink = null;
      if (decision === 'accept') {
        referralLink = await generateReferralLink(
          influencer.id,
          influencer.name,
          influencer.email,
          'influencer',
          assignments[idx].id,
          assignments[idx].influencerAdminId
        );
      }

      return sendJson(res, 200, {
        success: true,
        status: assignments[idx].status,
        request: {
          id: assignments[idx].id,
          influencerAdminId: assignments[idx].influencerAdminId,
          status: assignments[idx].status,
          requestedAt: assignments[idx].requestedAt,
          acceptedAt: assignments[idx].acceptedAt,
          rejectedAt: assignments[idx].rejectedAt,
          referralCode: referralLink ? referralLink.code : null,
          referralUrl: referralLink ? canonicalReferralUrl(referralLink.code) : null
        }
      });
    }

    // ── Influencer Admin: list assigned influencers with relationship-scoped stats ──
    // This endpoint is deliberately separate from the master/global influencer list.
    // It returns only influencers with an explicit ACCEPTED relationship to the
    // authenticated Influencer Admin and calculates stats from that relationship's
    // referral code plus the admin's authorized/owned events.
    if (pathname === '/api/influencer-admin/influencers' && req.method === 'GET') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 403, { success: false, error: 'Influencer Admin access only' });
      const users = await readUsers();
      const links = await readReferralLinks();
      const [orders, events] = await Promise.all([readOrders(), readEvents()]);
      const adminId = String(authCtx.user.id || '').trim();

      const influencers = await Promise.all(users
        .filter(u => u && u.role === 'influencer' && u.archived !== true)
        .map(async influencer => {
          const assignment = getAcceptedInfluencerAssignments(influencer)
            .find(a => String(a.influencerAdminId || '').trim() === adminId) || null;
          if (!assignment) return null;

          const link = links.find(l => String(l.influencerId || l.ownerId || '').trim() === String(influencer.id)) || null;
          const referredOrders = link ? await getScopedReferralOrders(link, orders, events, adminId) : [];
          const totalRevenue = referredOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
          const totalTickets = referredOrders.reduce((sum, o) => sum + (parseInt(o.qty, 10) || 0), 0);
          return {
            ...publicUser(influencer),
            assignmentId: assignment.id,
            relationshipStatus: assignment.status,
            requestedAt: assignment.requestedAt || null,
            acceptedAt: assignment.acceptedAt || null,
            referralCode: link ? link.code : null,
            referralUrl: link ? canonicalReferralUrl(link.code) : null,
            referralStats: {
              totalOrders: referredOrders.length,
              totalRevenue,
              totalTickets,
              uniquePeople: new Set(referredOrders.map(o => String(o.buyerEmail || '').trim().toLowerCase()).filter(Boolean)).size
            }
          };
        })
      );

      return sendJson(res, 200, { success: true, influencers: influencers.filter(Boolean) });
    }

    // ── Admin (master only): list influencer accounts ──
    if (pathname === '/api/admin/influencers' && req.method === 'GET') {
      // Main Admin, Sub-admin and Influencer Admin can view influencer accounts.
      // Sub-admins get the global list; Influencer Admins remain scoped to accounts they created.
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const users = await readUsers();
      const links = await readReferralLinks();
      const [orders, events] = await Promise.all([readOrders(), readEvents()]);
      const canViewAll = authCtx.role === 'admin' || authCtx.role === 'subadmin';
      const influencerUsers = users.filter(u => u.role === 'influencer' && (canViewAll || influencerAdminOwnsInfluencer(authCtx, u)));
      const influencers = await Promise.all(influencerUsers.map(async u => {
        const acceptedAssignments = getAcceptedInfluencerAssignments(u);
        const scopedAssignment = authCtx.role === 'influencer_admin'
          ? (acceptedAssignments.find(a => String(a.influencerAdminId) === String(authCtx.user.id)) || null)
          : null;
        // An influencer can have more than one referral code when they have
        // accepted multiple Influencer Admin relationships. The old code only
        // inspected the first matching link, which caused the Main Admin
        // dashboard to show zero (or incomplete) referral activity when the
        // used code was a different relationship-scoped code.
        const influencerLinks = scopedAssignment
          ? links.filter(l => String(l.influencerId || l.ownerId || '') === String(u.id) && String(l.assignmentId || '') === String(scopedAssignment.id))
          : links.filter(l => String(l.influencerId || l.ownerId || '') === String(u.id));
        const referralCodes = new Set(influencerLinks.map(l => String(l.code || '').trim()).filter(Boolean));
        const referredOrders = Array.from(new Map(
          orders
            .filter(o => referralCodes.has(String(o.referralCode || '').trim()))
            .filter(o => isReferralOrderCounted(o, String(o.referralCode || '').trim()))
            .map(o => [String(o.orderId || ''), o])
        ).values());
        const scopedOrders = authCtx.role === 'influencer_admin'
          ? (await Promise.all(influencerLinks.map(link => getScopedReferralOrders(link, orders, events))))
              .flat()
          : referredOrders;
        const uniqueOrders = Array.from(new Map(scopedOrders.map(o => [String(o.orderId || ''), o])).values());
        const totalRevenue = uniqueOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
        const totalTickets = uniqueOrders.reduce((sum, o) => sum + (parseInt(o.qty, 10) || 0), 0);
        return {
          ...publicUser(u),
          referralCode: influencerLinks.length === 1 ? influencerLinks[0].code : (influencerLinks[0] ? influencerLinks[0].code : null),
          referralCodes: influencerLinks.map(l => l.code).filter(Boolean),
          referralStats: {
            totalOrders: uniqueOrders.length,
            totalRevenue,
            totalTickets,
            uniquePeople: new Set(uniqueOrders.map(o => String(o.buyerEmail || '').trim().toLowerCase()).filter(Boolean)).size
          }
        };
      }));
      return sendJson(res, 200, { success: true, influencers });
    }

    // ── Admin (master only): create influencer account ──
    if (pathname === '/api/admin/influencers' && req.method === 'POST') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const passwordError = validatePassword(password);
      const emailError = validateEmail(email);
      if (!name || !email || passwordError || emailError) {
        return sendJson(res, 400, { success: false, error: passwordError || emailError || 'Name and email are required.' });
      }
      const existing = await findUserByEmail(email);
      if (existing) return sendJson(res, 409, { success: false, error: 'A user with this email already exists.' });
      const influencer = {
        id: 'INF-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        name, email, phone: '', passwordHash: hashPassword(password), role: 'influencer',
        createdBy: authCtx.role === 'admin' ? null : authCtx.user.id,
        assignedInfluencerAdminId: authCtx.role === 'influencer_admin' ? authCtx.user.id : null,
        influencerAssignments: authCtx.role === 'influencer_admin' ? [{
          id: 'IA-ASSIGN-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
          influencerAdminId: authCtx.user.id,
          status: 'accepted',
          requestedAt: new Date().toISOString(),
          acceptedAt: new Date().toISOString(),
          rejectedAt: null
        }] : [],
        createdAt: new Date().toISOString()
      };
      await addUser(influencer);
      const createdAssignment = influencer.influencerAssignments && influencer.influencerAssignments[0];
      const referralLink = await generateReferralLink(influencer.id, influencer.name, influencer.email, 'influencer', createdAssignment ? createdAssignment.id : null, createdAssignment ? createdAssignment.influencerAdminId : null);
      return sendJson(res, 200, {
        success: true,
        influencer: { ...publicUser(influencer), referralCode: referralLink.code, referralStats: { totalOrders: 0, totalRevenue: 0, totalTickets: 0, uniquePeople: 0 } }
      });
    }

    // ── Admin (master only): remove influencer account ──
    if (pathname === '/api/admin/influencers' && req.method === 'DELETE') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
      if (!email) return sendJson(res, 400, { success: false, error: 'Missing email' });
      const user = await findUserByEmail(email);
      if (!user || user.role !== 'influencer') return sendJson(res, 404, { success: false, error: 'Influencer not found' });
      if (!canManageInfluencer(authCtx, user)) {
        return sendJson(res, 403, { success: false, error: 'You can only manage influencers you created.' });
      }
      await deleteUserById(user.id);
      await deleteUserSessions(user.id);
      return sendJson(res, 200, { success: true });
    }

    // ── Admin (master only): list sub-admin accounts ──
    if (pathname === '/api/admin/subadmins' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const users = await readUsers();
      const links = await readReferralLinks();
      const orders = await readOrders();
      const subs = users.filter(u => u.role === 'subadmin').map(u => {
        const link = links.find(l => l.influencerId === u.id || l.ownerId === u.id || l.subadminId === u.id) || null;
        const referredOrders = link ? orders.filter(o => isReferralOrderCounted(o, link.code)) : [];
        const totalRevenue = referredOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
        const totalTickets = referredOrders.reduce((sum, o) => sum + (o.qty || 0), 0);
        const sub = publicUser(u);
        return {
          ...sub,
          referralCode: link ? link.code : null,
          referralStats: {
            totalOrders: referredOrders.length,
            totalRevenue: totalRevenue,
            totalTickets: totalTickets,
            uniquePeople: new Set(
              referredOrders
                .map(o => String(o.buyerEmail || '').trim().toLowerCase())
                .filter(Boolean)
            ).size
          }
        };
      });
      return sendJson(res, 200, { success: true, subadmins: subs });
    }

    // ── Admin (master only): create a sub-admin account ──
    if (pathname === '/api/admin/subadmins' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const passwordError = validatePassword(password);
      const emailError = validateEmail(email);
      if (!name || !email || passwordError || emailError) {
        return sendJson(res, 400, { success: false, error: passwordError || emailError || 'Name and email are required.' });
      }
      const existing = await findUserByEmail(email);
      if (existing) {
        return sendJson(res, 409, { success: false, error: 'A user with this email already exists.' });
      }
      const sub = {
        id: 'SUB-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        name: name,
        email: email,
        phone: '',
        passwordHash: hashPassword(password),
        role: 'subadmin',
        createdAt: new Date().toISOString()
      };
      await addUser(sub);
      const referralLink = await generateReferralLink(sub.id, sub.name, sub.email);
      return sendJson(res, 200, {
        success: true,
        subadmin: {
          ...publicUser(sub),
          referralCode: referralLink.code,
          referralStats: { totalOrders: 0, totalRevenue: 0, totalTickets: 0, uniquePeople: 0 }
        }
      });
    }

    // ── Admin (master only): remove a sub-admin account ──
    if (pathname === '/api/admin/subadmins' && req.method === 'DELETE') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
      if (!email) return sendJson(res, 400, { success: false, error: 'Missing email' });
      const user = await findUserByEmail(email);
      if (!user || user.role !== 'subadmin') {
        return sendJson(res, 404, { success: false, error: 'Sub-admin not found' });
      }
      await deleteUserById(user.id);
      await deleteUserSessions(user.id);
      return sendJson(res, 200, { success: true });
    }

    // ── Archive/unarchive managed accounts ──
    if (pathname === '/api/admin/accounts/archive' && req.method === 'POST') {
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','subadmin','influencer_admin'].includes(authCtx.role)) {
        return sendJson(res,403,{success:false,error:'Only Admin, Sub-admin, or Influencer Admin can archive accounts'});
      }
      const body = await readBody(req);
      let data = {}; try { data = JSON.parse(body || '{}'); } catch(e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const archived = data.archived !== false;
      if (!email) return sendJson(res,400,{success:false,error:'Missing email'});
      const target = await findUserByEmail(email);
      if (!target) return sendJson(res,404,{success:false,error:'Account not found'});
      if (target.role === 'admin') return sendJson(res,403,{success:false,error:'The Main Admin account cannot be archived'});
      if (authCtx.role === 'influencer_admin' && !canManageInfluencer(authCtx,target)) {
        return sendJson(res,403,{success:false,error:'You can only archive influencers you created.'});
      }
      // Sub-admins can archive/unarchive influencer accounts globally. They cannot
      // archive other admin/staff accounts; the Main Admin retains full account control.
      if (authCtx.role === 'subadmin' && target.role !== 'influencer') {
        return sendJson(res,403,{success:false,error:'Sub-admins can only archive influencer accounts.'});
      }
      const updatedUser = Object.assign({}, target, { archived: archived, archivedAt: archived ? new Date().toISOString() : null, archivedBy: archived ? authCtx.role : null });
      await replaceUser(updatedUser);
      if (archived) await deleteUserSessions(target.id);
      return sendJson(res,200,{success:true,user:publicUser(updatedUser)});
    }

    // ── Admin / Sub-admin: dedicated staff accounts (check-in staff / influencer admin) ──
    // Listing and archiving/restricting is open to sub-admins as well, so gate
    // staff can be switched off without the main admin. Creating and deleting
    // accounts stays master-admin only.
    if (pathname === '/api/admin/staff' && (req.method === 'GET' || req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE')) {
      const manageCtx = await isAdminOrSubadmin(req);
      if (req.method === 'GET' || req.method === 'PATCH') {
        // Listing and archiving is shared with sub-admins.
        if (!manageCtx || !['admin', 'subadmin'].includes(manageCtx.role)) {
          return sendJson(res, 401, { success: false, error: 'Unauthorized' });
        }
      } else if (!isAdminAuthorized(req)) {
        // Creating and deleting accounts stays master-admin only.
        return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      }
      if (req.method === 'GET') {
        const users = await readUsers();
        const staff = users.filter(u => ['checkin_staff','influencer_admin'].includes(u.role)).map(u => publicUser(u));
        return sendJson(res, 200, { success: true, staff });
      }
      if (req.method === 'PATCH') {
        // Archive = restrict access without deleting the account or its history.
        const body = await readBody(req); let data = {};
        try { data = JSON.parse(body || '{}'); } catch (e) {}
        const email = String(data.email || '').trim().toLowerCase();
        const archived = data.archived === true;
        if (!email) return sendJson(res, 400, { success: false, error: 'Missing email' });
        const user = await findUserByEmail(email);
        if (!user || !['checkin_staff','influencer_admin'].includes(user.role)) {
          return sendJson(res, 404, { success: false, error: 'Staff account not found' });
        }
        user.archived = archived;
        user.archivedAt = archived ? new Date().toISOString() : null;
        user.archivedBy = archived ? (manageCtx.role === 'subadmin' ? 'Sub-Admin' : 'Admin') : null;
        await replaceUser(user);
        // Kick any live session so the restriction takes effect immediately.
        if (archived) await deleteUserSessions(user.id);
        return sendJson(res, 200, { success: true, staff: publicUser(user) });
      }
      if (req.method === 'POST') {
        const body = await readBody(req); let data = {};
        try { data = JSON.parse(body || '{}'); } catch (e) {}
        const name = String(data.name || '').trim();
        const email = String(data.email || '').trim().toLowerCase();
        const contactEmail = String(data.contactEmail || '').trim().toLowerCase();
        const password = String(data.password || '');
        const role = String(data.role || '').trim();
        const passwordError = validatePassword(password);
        if (!name || !email || passwordError || !['checkin_staff','influencer_admin'].includes(role)) {
          return sendJson(res, 400, { success: false, error: passwordError || 'Name, email, and a valid role are required.' });
        }
        // Optional real inbox: payout completion emails for an Influencer Admin
        // go here, since the <name>@unisocials.com login cannot receive mail.
        if (contactEmail) {
          const contactError = validateEmail(contactEmail);
          if (contactError) return sendJson(res, 400, { success: false, error: contactError });
        }
        if (await findUserByEmail(email)) return sendJson(res, 409, { success: false, error: 'A user with this email already exists.' });
        const user = { id: (role === 'checkin_staff' ? 'CHK-' : 'IADM-') + crypto.randomBytes(4).toString('hex').toUpperCase(), name, email, contactEmail: isInternalLoginEmail(contactEmail) ? '' : contactEmail, phone:'', passwordHash:hashPassword(password), role, createdAt:new Date().toISOString() };
        await addUser(user);
        return sendJson(res, 200, { success:true, staff: publicUser(user) });
      }
      const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
      if (!email) return sendJson(res, 400, { success:false, error:'Missing email' });
      const user = await findUserByEmail(email);
      if (!user || !['checkin_staff','influencer_admin'].includes(user.role)) return sendJson(res,404,{success:false,error:'Staff account not found'});
      await deleteUserById(user.id); await deleteUserSessions(user.id);
      return sendJson(res,200,{success:true});
    }

    // ── ADMIN: Reset password for an account this admin manages ──
    // Main Admin can reset any non-main-admin account. Influencer Admin can
    // reset only influencers that were created by that Influencer Admin.
    if (pathname === '/api/admin/account-password' && req.method === 'POST') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const newPassword = String(data.password || '');
      const passwordError = validatePassword(newPassword);
      if (!email || passwordError) {
        return sendJson(res, 400, { success: false, error: passwordError || 'Email and a new password are required.' });
      }
      const target = await findUserByEmail(email);
      if (!target) return sendJson(res, 404, { success: false, error: 'Account not found.' });
      if (target.role === 'admin') return sendJson(res, 403, { success: false, error: 'The Main Admin password cannot be changed from this dashboard.' });
      if (authCtx.role === 'influencer_admin' && !canManageInfluencer(authCtx, target)) {
        return sendJson(res, 403, { success: false, error: 'You can only reset passwords for influencers you created.' });
      }
      target.passwordHash = hashPassword(newPassword);
      target.otp = null;
      target.otpExpires = null;
      target.resetToken = null;
      target.resetTokenExpires = null;
      await replaceUser(target);
      await deleteUserSessions(target.id);
      return sendJson(res, 200, { success: true, message: 'Password reset successfully. The account must sign in again.' });
    }

    // ── AUTH: Logout ──
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token) await deleteSession(token);
      return sendJson(res, 200, { success: true });
    }

// ── AUTH: Forgot password (request OTP) (rate-limited) ──
    if (pathname === '/api/auth/forgot' && req.method === 'POST') {
      const rl = rateLimit(req, 'forgot', 3, 60000); // 3/min per IP
      if (!rl.allowed) {
        res.writeHead(429, withSecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) }));
        res.end(JSON.stringify({ success: false, error: 'Too many attempts. Please try again later.' }));
        return;
      }
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      if (!email) return sendJson(res, 400, { success: false, error: 'Please enter your email address.' });

      const user = await findUserByEmail(email);
      // Always return success to avoid leaking which emails are registered.
      if (!user) return sendJson(res, 200, { success: true, message: 'If that email is registered, an OTP has been sent.' });

      const otp = generateOtp();
      const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
      user.otp = hashResetSecret(otp);
      user.otpExpires = otpExpires;
      await replaceUser(user);

      // Send OTP via Brevo (fallback: log to console for local testing)
      const subject = 'Your Unisocials password reset OTP';
      const text = 'Hi ' + (user.name || 'there') + ',\n\nYour password reset OTP is: ' + otp + '\n\nThis code expires in 10 minutes. If you did not request this, please ignore this email.\n\nUnisocials Team';
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
        '<div style="background:#1B5E20;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">Unisocials — Password Reset</div>' +
        '<div style="padding:24px">' +
        '<p style="margin:0 0 16px">Hi <strong>' + escapeHtml(user.name || 'there') + '</strong>,</p>' +
        '<p style="margin:0 0 16px;color:#475569">Use the OTP below to create a new password. It expires in 10 minutes.</p>' +
        '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;font-size:28px;font-weight:800;letter-spacing:0.2em;color:#166534;margin-bottom:16px">' + otp + '</div>' +
        '<p style="font-size:12px;color:#94a3b8;margin:0">If you did not request this, you can safely ignore this email.</p>' +
        '</div></div>';
      const sent = await sendBrevoEmail(email, subject, text, html, user.name || '');
      if (sent) {
        console.log('Password reset OTP sent to', email);
      } else {
        console.log('OTP for ' + email + ' (no Brevo key — dev fallback):', otp);
      }
      return sendJson(res, 200, { success: true, message: 'If that email is registered, an OTP has been sent.' });
    }

// ── AUTH: Verify OTP (returns a one-time reset token) (rate-limited) ──
    if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
      const rl = rateLimit(req, 'verify-otp', 5, 60000); // 5/min per IP
      if (!rl.allowed) {
        res.writeHead(429, withSecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) }));
        res.end(JSON.stringify({ success: false, error: 'Too many attempts. Please try again later.' }));
        return;
      }
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const otp = String(data.otp || '').trim();
      if (!email || !otp) return sendJson(res, 400, { success: false, error: 'Email and OTP are required.' });

      const user = await findUserByEmail(email);
      if (!user || !user.otp || !user.otpExpires) {
        return sendJson(res, 400, { success: false, error: 'No OTP was requested for this email. Please request a new one.' });
      }
      if (Date.now() > user.otpExpires) {
        return sendJson(res, 400, { success: false, error: 'This OTP has expired. Please request a new one.' });
      }
      const otpHash = hashResetSecret(otp);
      const storedOtpHash = String(user.otp || '');
      // Accept a still-valid legacy plaintext OTP once for compatibility with
      // resets started before this security update, then replace it with a hash.
      const otpOk = (storedOtpHash.length === otpHash.length && crypto.timingSafeEqual(Buffer.from(storedOtpHash, 'utf8'), Buffer.from(otpHash, 'utf8'))) ||
        (storedOtpHash.length === 6 && /^\d{6}$/.test(storedOtpHash) && storedOtpHash === otp);
      if (!otpOk) {
        return sendJson(res, 400, { success: false, error: 'Invalid OTP. Please check and try again.' });
      }

      // Issue a one-time reset token (valid 15 minutes)
      const resetToken = generateToken();
      user.resetToken = hashResetSecret(resetToken);
      user.resetTokenExpires = Date.now() + 15 * 60 * 1000;
      user.otp = null;
      user.otpExpires = null;
      await replaceUser(user);

      return sendJson(res, 200, { success: true, resetToken: resetToken });
    }

    // ── AUTH: Reset password (with reset token) ──
    if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
      const rl = rateLimit(req, 'reset-password', 5, 60000);
      if (!rl.allowed) {
        res.writeHead(429, withSecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) }));
        res.end(JSON.stringify({ success: false, error: 'Too many attempts. Please try again later.' }));
        return;
      }
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const resetToken = String(data.resetToken || '').trim();
      const newPassword = String(data.password || '');
      const passwordError = validatePassword(newPassword);
      if (!email || !resetToken || passwordError) {
        return sendJson(res, 400, { success: false, error: passwordError || 'Email and reset token are required.' });
      }

      const user = await findUserByEmail(email);
      if (!user || !user.resetToken || !user.resetTokenExpires) {
        return sendJson(res, 400, { success: false, error: 'No password reset was requested. Please start over.' });
      }
      if (Date.now() > user.resetTokenExpires) {
        return sendJson(res, 400, { success: false, error: 'This reset link has expired. Please request a new OTP.' });
      }
      const resetTokenHash = hashResetSecret(resetToken);
      // Accept a still-valid legacy plaintext reset token once for compatibility.
      const storedResetToken = String(user.resetToken || '');
      const resetTokenOk = storedResetToken === resetTokenHash || (storedResetToken && storedResetToken === resetToken);
      if (!resetTokenOk) {
        return sendJson(res, 400, { success: false, error: 'Invalid reset token. Please start over.' });
      }

      user.passwordHash = hashPassword(newPassword);
      user.resetToken = null;
      user.resetTokenExpires = null;
      user.otp = null;
      user.otpExpires = null;
      await replaceUser(user);
      // Invalidate all existing sessions so the user must log in again
      await deleteUserSessions(user.id);

      return sendJson(res, 200, { success: true, message: 'Password updated. You can now sign in with your new password.' });
    }

    // ── AUTH: Me (current user + their orders) ──
    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user) return sendJson(res, 401, { success: false, error: 'Not logged in' });
      const orders = await readOrders();
      const mine = orders.filter(o => o.userId === user.id || String(o.buyerEmail).toLowerCase() === user.email);
      return sendJson(res, 200, { success: true, user: publicUser(user), orders: mine });
    }

    // ── AUTH: My orders (used by my-tickets page) ──
    if (pathname === '/api/auth/orders' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user) return sendJson(res, 401, { success: false, error: 'Not logged in' });
      const orders = await readOrders();
      const mine = orders.filter(o => o.userId === user.id || String(o.buyerEmail).toLowerCase() === user.email);
      return sendJson(res, 200, { success: true, orders: mine });
    }

    
function getTierInventory(event, tier, orders) {
  const t = String(tier || 'regular').toLowerCase();
  const names = {regular:'Regular', vip:'Vip', vvip:'Vvip', table:'Table'};
  const n = names[t] || 'Regular';
  const total = Math.max(0, Number(event[t+'TicketLimit'] ?? event['ticketLimit'+n] ?? 0));
  const list = Array.isArray(orders) ? orders : [];
  let reserved = 0;
  let sold = 0;
  const eventId = String(event.id || '');
  for (const o of list) {
    if (String(o.eventId || '') !== eventId) continue;
    if (String(o.ticketTier || 'regular').toLowerCase() !== t) continue;
    const status = String(o.status || '').toLowerCase();
    const qty = Math.max(0, parseInt(o.qty) || 0);
    if (status === 'pending' || status === 'verified') reserved += qty;
    if (status === 'verified') sold += qty;
  }
  return {total, sold, reserved, remaining: total > 0 ? Math.max(0,total-reserved) : 0, soldOut: total > 0 && reserved >= total};
}

// Build all event/tier inventory in one pass through the orders. The previous
// public event endpoint scanned the full orders list separately for every
// event/tier pair, which made event loading grow roughly with events * tiers * orders.
// This map keeps the exact same pending/verified rules while reducing that work
// to one order pass plus constant-time lookups while enriching events.
function buildEventInventoryMap(orders) {
  const map = new Map();
  const list = Array.isArray(orders) ? orders : [];
  for (const o of list) {
    const eventId = String(o.eventId || '');
    if (!eventId) continue;
    const tier = String(o.ticketTier || 'regular').toLowerCase();
    if (!['regular','vip','vvip','table'].includes(tier)) continue;
    const status = String(o.status || '').toLowerCase();
    if (status !== 'pending' && status !== 'verified') continue;
    const qty = Math.max(0, parseInt(o.qty) || 0);
    const key = eventId + '|' + tier;
    let entry = map.get(key);
    if (!entry) { entry = {sold: 0, reserved: 0}; map.set(key, entry); }
    entry.reserved += qty;
    if (status === 'verified') entry.sold += qty;
  }
  return map;
}

function getTierInventoryFromMap(event, tier, inventoryMap) {
  const t = String(tier || 'regular').toLowerCase();
  const names = {regular:'Regular', vip:'Vip', vvip:'Vvip', table:'Table'};
  const n = names[t] || 'Regular';
  const total = Math.max(0, Number(event[t+'TicketLimit'] ?? event['ticketLimit'+n] ?? 0));
  const entry = inventoryMap.get(String(event.id || '') + '|' + t) || {sold: 0, reserved: 0};
  return {
    total,
    sold: entry.sold,
    reserved: entry.reserved,
    remaining: total > 0 ? Math.max(0, total - entry.reserved) : 0,
    soldOut: total > 0 && entry.reserved >= total
  };
}

// ── Create order (PENDING until payment is server-verified) ──
    if (pathname === '/api/orders' && req.method === 'POST') {
      const rl = rateLimit(req, 'create-order', 20, 60000); // 20 order attempts/min per IP
      if (!rl.allowed) {
        return sendJson(res, 429, { success: false, error: 'Too many order attempts. Please try again later.', retryAfter: rl.retryAfter });
      }
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}

      const orderId = String(data.orderId || '').trim();
      const eventId = String(data.eventId || '').trim();
      const eventName = String(data.eventName || '').trim();
      const eventDate = String(data.eventDate || '').trim();
      const eventVenue = String(data.eventVenue || '').trim();
      const eventCategory = String(data.eventCategory || '').trim();
      const qty = Number.isInteger(Number(data.qty)) ? Number(data.qty) : 1;
      let amount = Number(data.amount);
      if (!Number.isFinite(amount)) amount = 0;
      const currency = String(data.currency || 'NGN').trim().toUpperCase();
      const buyerName = String(data.buyerName || '').trim();
      const buyerEmail = String(data.buyerEmail || '').trim().toLowerCase();
      const buyerPhone = String(data.buyerPhone || '').trim();
      const buyerFaculty = String(data.buyerFaculty || '').trim();
      const ticketTier = String(data.ticketTier || '') || 'standard';
      const included = String(data.included || '').trim();
      const universityId = String(data.universityId || '').trim();
      const universityName = String(data.universityName || '').trim();
      const universitySlug = String(data.universitySlug || '').trim();
      const referralCode = String(data.referralCode || '').trim().toUpperCase();
      const couponCode = String(data.couponCode || '').trim().toUpperCase();
      const paymentMethod = String(data.paymentMethod || '').trim().toLowerCase();
      if (!['card', 'banktransfer'].includes(paymentMethod)) {
        return sendJson(res, 400, { success: false, error: 'Please select Credit/Debit Card or Bank Transfer.' });
      }
      // Reject malformed/oversized order input before touching storage or payment state.
      if (orderId.length > 100 || eventId.length > 100 || eventName.length > 200 || eventDate.length > 100 || eventVenue.length > 300 || eventCategory.length > 100 || buyerName.length > 160 || buyerEmail.length > 254 || buyerPhone.length > 40 || buyerFaculty.length > 160 || universityId.length > 100 || universityName.length > 200 || universitySlug.length > 160 || referralCode.length > 100 || couponCode.length > 100) {
        return sendJson(res, 400, { success: false, error: 'One or more order fields are too long.' });
      }
      if (qty < 1 || qty > 100) {
        return sendJson(res, 400, { success: false, error: 'Ticket quantity must be between 1 and 100.' });
      }
      if (currency !== 'NGN') {
        return sendJson(res, 400, { success: false, error: 'Only NGN payments are supported.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
        return sendJson(res, 400, { success: false, error: 'Please provide a valid email address.' });
      }
      let couponDiscount = 0;
      let baseAmountBeforeCoupon = amount;
      let referralApplied = false;
      let referralLink = null;
      let eventRecord = null;

      // Resolve the event before applying referral pricing so an Influencer
      // Admin's code cannot be used on an event that admin is not authorized
      // to manage.
      if (eventId) {
        const eventCatalog = await readEvents();
        eventRecord = eventCatalog.find(e => eventIdentifierMatches(e, eventId));
        if (!eventRecord) return sendJson(res, 400, { success: false, error: 'Event not found' });
      }

      if (referralCode) {
        referralLink = await getReferralLinkByCode(referralCode);
        if (!referralLink) {
          return sendJson(res, 400, { success: false, error: 'Invalid referral code. Please check the code and try again.' });
        }
        // A relationship-specific referral code must always be evaluated
        // against a real event. Never allow a caller to omit eventId and
        // bypass event authorization.
        if (referralLink.influencerId && !eventRecord) {
          return sendJson(res, 400, { success: false, error: 'An event is required when using this referral code.' });
        }
        if (eventRecord && !(await influencerReferralAuthorizedForEvent(referralLink, eventRecord))) {
          return sendJson(res, 403, { success: false, error: 'This referral code is not authorized for this event.' });
        }
        referralApplied = true;
      }

      // Server-authoritative pricing: bonus is the default; a valid referral
      // switches the selected tier back to its original price.
      if (eventRecord) {
        const ordersForInventory = await readOrders();
        const inv = getTierInventory(eventRecord, ticketTier, ordersForInventory);
        if (inv.total > 0 && Number(qty) > inv.remaining) {
          return sendJson(res, 409, { success:false, error: inv.remaining > 0 ? ('Only ' + inv.remaining + ' ' + ticketTier + ' ticket(s) remaining.') : (ticketTier.toUpperCase() + ' tickets are sold out.') });
        }
        const tierOriginals = { regular: Number(eventRecord.price || 0), vip: Number(eventRecord.vipPrice || 0), vvip: Number(eventRecord.vvipPrice || 0), table: Number(eventRecord.tablePrice || 0) };
        const tierBonuses = { regular: Number(eventRecord.bonusPrice || 0), vip: Number(eventRecord.bonusVipPrice || 0), vvip: Number(eventRecord.bonusVvipPrice || 0), table: Number(eventRecord.bonusTablePrice || 0) };
        const originalUnit = tierOriginals[ticketTier] > 0 ? tierOriginals[ticketTier] : tierOriginals.regular;
        const bonusUnit = tierBonuses[ticketTier] || 0;
        const payableUnit = referralApplied ? originalUnit : (bonusUnit > 0 ? bonusUnit : originalUnit);
        amount = payableUnit * qty;
        baseAmountBeforeCoupon = amount;
      }

      if (couponCode) {
        const coupon = await getCouponByCode(couponCode);
        if (!coupon) return sendJson(res, 400, { success: false, error: 'Invalid or inactive coupon code.' });
        couponDiscount = Math.max(0, Number(coupon.amount) || 0);
        if (couponDiscount <= 0) return sendJson(res, 400, { success: false, error: 'Coupon discount is invalid.' });
        if (couponDiscount >= baseAmountBeforeCoupon) return sendJson(res, 400, { success: false, error: 'Coupon discount cannot cover the full ticket price.' });
        amount = Math.max(0, baseAmountBeforeCoupon - couponDiscount);
      }

      if (!orderId || !eventName || !buyerName || !buyerEmail || !buyerPhone || amount <= 0) {
        return sendJson(res, 400, { success: false, error: 'Missing required order fields' });
      }

      // The client is never trusted with the money. A request that does not
      // resolve to a real catalogue event leaves `amount` as whatever the caller
      // sent, which let anyone create a ₦1 "order" for any event name and have
      // it flow into revenue reports, commission splits and payout balances.
      // Price must always come from a real event record.
      if (!eventRecord) {
        return sendJson(res, 400, { success: false, error: 'A valid event is required to price this order.' });
      }

      if (amount > MAX_ORDER_AMOUNT) {
        return sendJson(res, 400, { success: false, error: 'This order total is above the maximum allowed. Please reduce the quantity.' });
      }

      const existing = await getOrder(orderId);
      if (existing) {
        return sendJson(res, 409, { success: false, error: 'Order ID already exists' });
      }

      // Attach user if logged in
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);

      const order = {
        orderId: orderId,
        status: 'pending',                 // ALWAYS pending until server verification
        eventId: eventId || null,
        eventName: eventName,
        eventCategory: eventCategory,
        eventDate: eventDate,
        eventVenue: eventVenue,
        qty: qty,
        amount: amount,
        currency: currency,
        paymentMethod: paymentMethod,      // card or banktransfer; actual payment is handled by Flutterwave
buyerName: buyerName,
        buyerEmail: buyerEmail,
        buyerPhone: buyerPhone,
buyerFaculty: buyerFaculty,
        ticketTier: ticketTier,
        included: included,
        universityId: universityId,
        universityName: universityName,
        universitySlug: universitySlug,
        referralCode: referralCode || null,  // Track which subadmin referred this order
        couponCode: couponCode || null,
        couponDiscount: couponDiscount || 0,
        amountBeforeCoupon: baseAmountBeforeCoupon,
        userId: user ? user.id : null,
        createdAt: new Date().toISOString(),
        verifiedAt: null,
        notifyAdmin: true,
        seenByAdmin: false,
        ticketCodes: [],                    // generated only after manual verification
        ticketCode: null
      };
      // Do not create or access a ticket code while the order is pending.
      // Ticket codes are generated only by verifyOrderTicketData() after admin verification.
      await addOrder(order);
      // Notify the admin the moment a new order is placed so they can watch for
      // the payment and verify it (e.g. bank transfer / manual confirmation).
      notifyNewOrder(order);
      return sendJson(res, 200, { success: true, order: order });
    }

    // ── Buyer payment-received acknowledgement (SERVER-VERIFIED) ──
    // The browser may report that Flutterwave completed checkout, but it is NOT
    // trusted. We re-query Flutterwave first, then send only the acknowledgement
    // email. Tickets are still issued only by the verified-order path below.
    if (pathname === '/api/payment-received' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const txRef = String(data.tx_ref || '').trim();
      if (!txRef) return sendJson(res, 400, { success: false, error: 'Missing tx_ref' });
      const order = await getOrder(txRef);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found for tx_ref' });
      if (order.status === 'rejected') return sendJson(res, 409, { success: false, error: 'Order has been rejected.' });

      const result = await verifyFlutterwave(txRef, parseFloat(order.amount), order.currency);
      if (!result.success) {
        return sendJson(res, 400, { success: false, error: 'Payment could not be server-verified', verification: { status: result.status, amountOk: result.amountOk, currencyOk: result.currencyOk, txRefOk: result.txRefOk } });
      }

      // The browser callback is NOT trusted as proof of payment. The server has
      // just independently verified the transaction with Flutterwave above, so
      // this is now safe to fulfill even if the webhook is delayed/unavailable.
      const latest = await getOrder(txRef);
      const wasVerified = latest.status === 'verified';
      let current = latest;
      if (!wasVerified) {
        current = await patchOrder(txRef, Object.assign(verifyOrderTicketData(Object.assign({}, latest)), {
          paymentReceivedAt: latest.paymentReceivedAt || new Date().toISOString(),
          paymentReceived: true,
          flutterwavePaymentVerifiedAt: new Date().toISOString(),
          flutterwaveTransactionId: result.returnedTxRef || data.id || txRef,
          flutterwavePaymentObserved: true,
          flutterwavePaymentObservedAt: new Date().toISOString(),
          flutterwaveVerificationFailed: false
        }));
        if (!wasVerified) {
          notifyOrderVerified(current);
          await refreshReferralStatsForVerifiedOrder(current, latest.status);
        }
      }

      if (!current.paymentReceivedEmailSent) {
        const sent = await sendBuyerPurchaseAcknowledgement(current);
        if (sent) {
          current = await patchOrder(txRef, { paymentReceivedEmailSent: true, paymentReceivedEmailSentAt: new Date().toISOString() });
        }
      }
      return sendJson(res, 200, { success: true, paymentReceived: true, automaticallyVerified: true, acknowledgementSent: !!current.paymentReceivedEmailSent, order: { orderId: current.orderId, status: current.status } });
    }

    // ── Verify payment (server-authoritative, ADMIN ONLY) ──
    if (pathname === '/api/verify-payment' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const txRef = String(data.tx_ref || '').trim();
      if (!txRef) return sendJson(res, 400, { success: false, error: 'Missing tx_ref' });

      const order = await getOrder(txRef);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found for tx_ref' });

      const result = await verifyFlutterwave(txRef, parseFloat(order.amount), order.currency);

  if (result.success) {
  const wasVerified = order.status === 'verified';
  const updated = await patchOrder(txRef, verifyOrderTicketData(Object.assign({}, order)));
  console.log('Verified order:', txRef, 'amount:', result.amount, result.currency);
  
  if (!wasVerified) {
    notifyOrderVerified(updated);
    await refreshReferralStatsForVerifiedOrder(updated, order.status);
  }
  
  return sendJson(res, 200, { success: true, order: updated });
  }

  return sendJson(res, 400, { success: false, error: 'Payment verification failed' });
}

    // ── Flutterwave webhook (server-to-server, automatic verification) ──
    if (pathname === '/api/webhook/flutterwave' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {
        return sendJson(res, 400, { success: false, error: 'Invalid JSON' });
      }

      const webhookHash = process.env.FLUTTERWAVE_WEBHOOK_HASH !== undefined
        ? process.env.FLUTTERWAVE_WEBHOOK_HASH
        : defaults.FLUTTERWAVE_WEBHOOK_HASH;
      if (!webhookHash) {
        console.error('Flutterwave webhook rejected: FLUTTERWAVE_WEBHOOK_HASH is not configured');
        return sendJson(res, 503, { success: false, error: 'Webhook security is not configured' });
      }

      // Current Flutterwave webhook signing: HMAC-SHA256(raw body, secret hash),
      // base64-encoded in the flutterwave-signature header. Keep legacy v3
      // verif-hash support as a compatibility fallback.
      const signature = String(req.headers['flutterwave-signature'] || '').trim();
      const legacySignature = String(req.headers['verif-hash'] || '').trim();
      let validSignature = false;
      if (signature) {
        const expected = crypto.createHmac('sha256', webhookHash).update(body).digest('base64');
        const a = Buffer.from(expected);
        const b = Buffer.from(signature);
        validSignature = a.length === b.length && crypto.timingSafeEqual(a, b);
      } else if (legacySignature) {
        const a = Buffer.from(webhookHash);
        const b = Buffer.from(legacySignature);
        validSignature = a.length === b.length && crypto.timingSafeEqual(a, b);
      }
      if (!validSignature) {
        return sendJson(res, 401, { success: false, error: 'Invalid webhook signature' });
      }

      const payloadData = data.data || {};
      const txRef = String(payloadData.tx_ref || payloadData.reference || data.txRef || data.tx_ref || '').trim();
      const eventType = String(data.event || data.type || data['event.type'] || '').trim().toLowerCase();
      const webhookStatus = String(payloadData.status || '').trim().toLowerCase();
      const webhookId = String(data.id || data.webhook_id || '').trim();

      if (!txRef) return sendJson(res, 200, { success: true, ignored: true, reason: 'Missing tx_ref' });

      const order = await getOrder(txRef);
      if (!order) {
        // Acknowledge unknown events so Flutterwave does not retry forever.
        return sendJson(res, 200, { success: true, ignored: true, reason: 'Order not found', tx_ref: txRef });
      }

      // Idempotency: Flutterwave may retry the same event.
      const seenWebhookIds = Array.isArray(order.flutterwaveWebhookIds) ? order.flutterwaveWebhookIds : [];
      if (webhookId && seenWebhookIds.includes(webhookId)) {
        return sendJson(res, 200, { success: true, duplicate: true, tx_ref: txRef });
      }
      const nextWebhookIds = webhookId ? seenWebhookIds.concat(webhookId).slice(-20) : seenWebhookIds;
      if (webhookId) await patchOrder(txRef, { flutterwaveWebhookIds: nextWebhookIds, flutterwaveLastWebhookAt: new Date().toISOString() });

      const isChargeCompleted = eventType === 'charge.completed' || eventType === 'charge_completed';
      const providerReportedSuccess = ['successful', 'succeeded', 'completed'].includes(webhookStatus);
      if (!isChargeCompleted || !providerReportedSuccess) {
        return sendJson(res, 200, { success: true, ignored: true, tx_ref: txRef, status: webhookStatus });
      }

      // Do not trust webhook amount/status/reference. Re-query Flutterwave and
      // verify against the exact order before issuing any ticket.
      const result = await verifyFlutterwave(txRef, parseFloat(order.amount), order.currency);
      if (!result.success) {
        console.warn('Flutterwave webhook received but verification failed:', txRef, result);
        await patchOrder(txRef, { flutterwavePaymentObserved: true, flutterwavePaymentObservedAt: new Date().toISOString(), flutterwaveVerificationFailed: true });
        return sendJson(res, 200, { success: true, verified: false, tx_ref: txRef });
      }

      if (order.status === 'verified') {
        return sendJson(res, 200, { success: true, verified: true, alreadyVerified: true, tx_ref: txRef });
      }

      if (paymentVerificationLocks.has(txRef)) {
        return sendJson(res, 200, { success: true, verified: true, processing: true, tx_ref: txRef });
      }

      paymentVerificationLocks.add(txRef);
      try {
        const latest = await getOrder(txRef);
        if (!latest) return sendJson(res, 200, { success: true, ignored: true, reason: 'Order disappeared', tx_ref: txRef });
        if (latest.status !== 'verified') {
          const updated = await patchOrder(txRef, Object.assign(verifyOrderTicketData(Object.assign({}, latest)), {
            flutterwavePaymentVerifiedAt: new Date().toISOString(),
            flutterwaveTransactionId: result.returnedTxRef || txRef,
            flutterwavePaymentObserved: true,
            flutterwavePaymentObservedAt: new Date().toISOString(),
            flutterwaveVerificationFailed: false
          }));
          notifyOrderVerified(updated);
          await refreshReferralStatsForVerifiedOrder(updated, latest.status);
          console.log('Automatically verified Flutterwave payment:', txRef, 'amount:', result.amount, result.currency);
          return sendJson(res, 200, { success: true, verified: true, automaticallyVerified: true, tx_ref: txRef, order: { orderId: updated.orderId, status: updated.status } });
        }
        return sendJson(res, 200, { success: true, verified: true, alreadyVerified: true, tx_ref: txRef });
      } finally {
        paymentVerificationLocks.delete(txRef);
      }
    }

// ── Order status lookup (pending page) ──
    // Requires login. The order's ticket codes are only revealed to the
    // buyer who owns the order (matched by userId or buyerEmail).
    if (pathname === '/api/orders/status') {
      const orderId = String(url.searchParams.get('orderId') || '').trim();
      if (!orderId) return sendJson(res, 400, { success: false, error: 'Missing orderId' });
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user) return sendJson(res, 401, { success: false, error: 'Please sign in to track your order.' });
      const order = await getOrder(orderId);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found' });
      const ownsOrder = order.userId === user.id || String(order.buyerEmail).toLowerCase() === user.email;
      if (!ownsOrder) return sendJson(res, 403, { success: false, error: 'You do not have access to this order.' });
      return sendJson(res, 200, {
        success: true,
        order: {
          orderId: order.orderId,
          status: order.status,
          eventName: order.eventName,
          eventDate: order.eventDate,
          eventVenue: order.eventVenue,
          qty: order.qty,
          amount: order.amount,
          currency: order.currency,
          paymentMethod: order.paymentMethod,
          verifiedAt: order.verifiedAt,
          ticketCodes: order.status === 'verified' ? (order.ticketCodes || []) : [],
          ticketCode: order.status === 'verified' ? (order.ticketCode || null) : null
        }
      });
    }

// ── Buyer order lookup (Order ID + phone) ──
    // Allows lookup WITHOUT signing in. Knowing the Order ID AND the phone
    // number used at checkout is the same proof the emailed ticket link relies
    // on, so it is enough to see the tickets: a guest who never created an
    // account can still open everything they paid for. The tickets themselves
    // are also delivered to the buyer's email, so there is no account to make.
    // Gate check-in stays separately protected by /api/ticket/scan.
    if (pathname === '/api/orders/lookup' && req.method === 'POST') {
      // This is the only endpoint that returns another person's order to a
      // caller who is not logged in, and the Order ID carries a short random
      // suffix. Without a limit it can be used to enumerate somebody else's
      // orders (and their ticket codes) by guessing IDs. Keep it tight.
      const rl = rateLimit(req, 'order-lookup', 10, 60000); // 10 attempts/min per IP
      if (!rl.allowed) {
        return sendJson(res, 429, { success: false, error: 'Too many lookup attempts. Please wait a minute and try again.', retryAfter: rl.retryAfter });
      }
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const orderId = String(data.orderId || '').trim();
      const phone = String(data.phone || '').trim();
      if (!orderId || !phone) return sendJson(res, 400, { success: false, error: 'Missing orderId or phone' });
      // Bound the inputs so a lookup cannot be used to scan the whole table.
      if (orderId.length > 100 || phone.length > 40) {
        return sendJson(res, 400, { success: false, error: 'Invalid order details.' });
      }

      const orders = await readOrders();
      const order = orders.find(o => o.orderId === orderId && o.buyerPhone === phone);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found. Check your Order ID and phone number.' });

      // The lookup already proved ownership by matching the Order ID to the
      // phone number used at checkout, which is the same secret the emailed
      // ticket link carries. So a guest sees their tickets, and signing in is
      // never required to view what they paid for.
      const ownsOrder = true;

      const payload = {
        orderId: order.orderId,
        status: order.status,
        eventName: order.eventName,
        eventDate: order.eventDate,
        eventVenue: order.eventVenue,
        qty: order.qty,
        amount: order.amount,
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        verifiedAt: order.verifiedAt,
        // Only include ticket codes when the requester is signed in AND owns the order.
        ticketCodes: (ownsOrder && order.status === 'verified') ? (order.ticketCodes || []) : [],
        ticketCode: (ownsOrder && order.status === 'verified') ? (order.ticketCode || null) : null,
        requiresSignIn: !ownsOrder
      };
      return sendJson(res, 200, { success: true, order: payload });
    }

    // ── Get ticket by orderId + code ──
    // A QR ticket is a bearer credential: the orderId + unique ticket code
    // embedded in the QR are sufficient to display that specific verified ticket.
    // Gate check-in remains separately protected by /api/ticket/scan.
    if (pathname === '/api/ticket' && req.method === 'GET') {
      const orderId = String(url.searchParams.get('orderId') || '').trim();
      const code = String(url.searchParams.get('code') || '').trim();
      if (!orderId || !code) return sendJson(res, 400, { success: false, error: 'Missing orderId or code' });

      const order = await getOrder(orderId);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found' });
      if (order.status !== 'verified') {
        return sendJson(res, 403, { success: false, error: 'Order not yet verified', status: order.status });
      }

      const codes = order.ticketCodes || [];
      const idx = codes.findIndex(t => t.code === code);
      if (idx === -1) {
        return sendJson(res, 403, { success: false, error: 'Invalid ticket code' });
      }

      const entry = codes[idx];
      return sendJson(res, 200, {
        success: true,
        ticket: {
          orderId: order.orderId,
          ticketCode: entry.code,
          ticketIndex: idx + 1,
          totalTickets: codes.length,
          used: !!entry.used,
          usedAt: entry.usedAt || null,
eventName: order.eventName,
          eventDate: order.eventDate,
          eventVenue: order.eventVenue,
          universityName: order.universityName || '',
          ticketTier: order.ticketTier || 'regular',
          included: order.included || '',
          qty: order.qty,
          amount: order.amount,
          currency: order.currency,
          buyerName: order.buyerName,
          verifiedAt: order.verifiedAt
        }
      });
    }

// ── Admin/Sub-admin: scan ticket at gate (check-in) ──
    if (pathname === '/api/ticket/scan' && req.method === 'POST') {
      const authCtx = await isAdminOrCheckinStaff(req);
      if (!authCtx || !['admin','subadmin','checkin_staff'].includes(authCtx.role)) return sendJson(res, 401, { success: false, error: 'Check-in staff access only' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const orderId = String(data.orderId || '').trim();
      const code = String(data.code || '').trim();
      if (!orderId || !code) return sendJson(res, 400, { success: false, error: 'Missing orderId or code' });

      const order = await getOrder(orderId);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found' });
      if (order.status !== 'verified') return sendJson(res, 403, { success: false, error: 'Order not verified' });

      const codes = order.ticketCodes || [];
      const idx = codes.findIndex(t => t.code === code);
      if (idx === -1) return sendJson(res, 403, { success: false, error: 'Invalid ticket code' });

const entry = codes[idx];
      if (entry.used) {
        return sendJson(res, 200, {
          success: true,
          alreadyUsed: true,
          message: 'This ticket was already scanned on ' + (entry.usedAt || 'earlier') + '.',
          ticket: scanTicketDetails(order, entry, idx, codes, true)
        });
      }
      entry.used = true;
      entry.usedAt = new Date().toISOString();
      // Record which staff member performed the check-in (for sub-admin audit).
      if (authCtx.user && ['subadmin','checkin_staff'].includes(authCtx.role)) {
        entry.checkedInBy = authCtx.user.name || authCtx.user.email;
      } else {
        entry.checkedInBy = 'Admin';
      }
codes[idx] = entry;
      const updated = await patchOrder(orderId, { ticketCodes: codes });
      return sendJson(res, 200, {
        success: true,
        message: '✅ Check-in successful for ' + order.buyerName,
        ticket: scanTicketDetails(order, entry, idx, codes, false)
      });
    }

    // ── Influencer: relationship-scoped referral portals ──
    if (pathname === '/api/influencer/referral-portals' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'influencer') return sendJson(res, 403, { success: false, error: 'Influencer access only' });
      const freshUser = await findUserById(user.id);
      const assignments = getAcceptedInfluencerAssignments(freshUser || user);
      const admins = await readUsers();
      let links = await getReferralLinksByInfluencerId(user.id);
      const portals = [];
      for (const assignment of assignments) {
        let link = links.find(l => String(l.influencerId || l.ownerId || '') === String(user.id) && String(l.assignmentId || '') === String(assignment.id)) || null;
        if (!link) {
          link = await generateReferralLink(user.id, user.name, user.email, 'influencer', assignment.id, assignment.influencerAdminId);
          links.push(link);
        }
        const admin = admins.find(a => String(a.id || '') === String(assignment.influencerAdminId) && ['influencer_admin','influencer-admin','influencerAdmin'].includes(String(a.role)));
        await updateReferralStats(link.code);
        const refreshed = await getReferralLinkByCode(link.code);
        portals.push({
          assignmentId: assignment.id,
          influencerAdminId: assignment.influencerAdminId,
          influencerAdmin: admin ? { id: admin.id, name: admin.name || '', email: admin.email || '' } : { id: assignment.influencerAdminId, name: 'Influencer Admin', email: '' },
          link: referralLinkResponse(refreshed || link)
        });
      }
      // Preserve a legacy/global influencer referral link if this account has
      // one and no accepted relationship can own it.
      const legacy = links.find(l => !l.assignmentId && (l.influencerId === user.id || l.ownerId === user.id)) || null;
      if (legacy && !portals.length) {
        await updateReferralStats(legacy.code);
        const refreshed = await getReferralLinkByCode(legacy.code);
        portals.push({ assignmentId: null, influencerAdminId: null, influencerAdmin: { id: null, name: 'General referral', email: '' }, link: referralLinkResponse(refreshed || legacy) });
      }
      return sendJson(res, 200, { success: true, portals });
    }

    // Backward-compatible single-link endpoint. It returns the first portal,
    // while new dashboard code uses /api/influencer/referral-portals.
    if (pathname === '/api/influencer/referral-link' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'influencer') return sendJson(res, 403, { success: false, error: 'Influencer access only' });
      const freshUser = await findUserById(user.id);
      const assignment = getAcceptedInfluencerAssignments(freshUser || user)[0] || null;
      let link = assignment
        ? await getReferralLinkForAssignment(user.id, assignment.id)
        : await getReferralLinkByInfluencerId(user.id);
      if (!link) link = await generateReferralLink(user.id, user.name, user.email, 'influencer', assignment ? assignment.id : null, assignment ? assignment.influencerAdminId : null);
      await updateReferralStats(link.code);
      link = await getReferralLinkByCode(link.code);
      return sendJson(res, 200, { success: true, link: referralLinkResponse(link) });
    }

    // ── Influencer: referral stats ──
    if (pathname === '/api/influencer/referral-stats' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'influencer') return sendJson(res, 403, { success: false, error: 'Influencer access only' });
      const assignmentId = String(url.searchParams.get('assignmentId') || '').trim();
      const freshUser = await findUserById(user.id);
      const acceptedAssignments = getAcceptedInfluencerAssignments(freshUser || user);
      const orders = await getOrdersForCurrentSiteEvents();
      const events = await readEvents();
      const admins = await readUsers();

      // "all" is an overview across every accepted Influencer Admin relationship.
      // It intentionally returns no single referral link because each relationship
      // has its own independent code/link.
      function commissionForOrder(order) {
        // Respect an explicitly stored commission amount/rate when the order has one.
        // Orders without one fall back to the site-wide 20% influencer commission,
        // so the referral portal never reports a flat zero for real sales.
        const explicit = Number(order && (order.commissionAmount ?? order.influencerCommission ?? order.referralCommission));
        if (Number.isFinite(explicit)) return explicit;
        const rate = Number(order && (order.commissionRate ?? order.influencerCommissionRate));
        if (Number.isFinite(rate) && rate >= 0) return (Number(order.amount) || 0) * rate;
        return (Number(order && order.amount) || 0) * INFLUENCER_COMMISSION_RATE;
      }
      function buildEventBreakdown(referredOrders, assignmentAdminId) {
        const allowed = events.filter(ev => {
          const ids = getAuthorizedInfluencerAdminIds(ev);
          return ids.includes(String(assignmentAdminId || '')) || influencerAdminOwnsEvent({ role:'influencer_admin', user:{ id:String(assignmentAdminId || '') } }, ev);
        });
        return allowed.map(ev => {
          const rows = referredOrders.filter(o => eventMatchesOrder(o, ev));
          return {
            id: ev.id, name: ev.name || ev.eventName || 'Event', date: ev.date || ev.eventDate || null, venue: ev.venue || ev.eventVenue || '',
            orders: rows.length, tickets: rows.reduce((n,o)=>n+(parseInt(o.qty,10)||0),0),
            revenue: rows.reduce((n,o)=>n+(Number(o.amount)||0),0),
            commission: rows.reduce((n,o)=>n+commissionForOrder(o),0)
          };
        });
      }
      if (assignmentId.toLowerCase() === 'all') {
        // Build the overview from the same per-relationship scopes used by the
        // individual portals. This guarantees that All = the sum of each
        // accepted relationship for orders/tickets/revenue/commission.
        const allReferredOrders = [];
        const allPeople = new Set();
        const eventMap = new Map();
        const adminBreakdown = [];
        for (const assignment of acceptedAssignments) {
          const link = await getReferralLinkForAssignment(user.id, assignment.id);
          if (!link) continue;
          const scoped = await getScopedReferralOrders(link, orders, events, assignment.influencerAdminId);
          const admin = admins.find(a => String(a.id || '') === String(assignment.influencerAdminId || '') && ['influencer_admin','influencer-admin','influencerAdmin'].includes(String(a.role)));
          const eventRows = buildEventBreakdown(scoped, assignment.influencerAdminId);
          const adminStats = {
            assignmentId: assignment.id,
            influencerAdminId: assignment.influencerAdminId,
            influencerAdmin: { id: assignment.influencerAdminId, name: admin ? (admin.name || '') : 'Influencer Admin', email: admin ? (admin.email || '') : '' },
            totalOrders: scoped.length,
            totalRevenue: scoped.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
            totalTickets: scoped.reduce((sum, o) => sum + (parseInt(o.qty, 10) || 0), 0),
            totalCommission: scoped.reduce((sum, o) => sum + commissionForOrder(o), 0),
            uniquePeople: new Set(scoped.map(o => String(o.buyerEmail || '').trim().toLowerCase()).filter(Boolean)).size
          };
          adminBreakdown.push(adminStats);
          allReferredOrders.push(...scoped);
          scoped.forEach(o => { const email = String(o.buyerEmail || '').trim().toLowerCase(); if (email) allPeople.add(email); });
          for (const ev of eventRows) {
            const key = String(ev.id || ev.name);
            const existing = eventMap.get(key);
            if (!existing) eventMap.set(key, ev);
            else { existing.orders += ev.orders; existing.tickets += ev.tickets; existing.revenue += ev.revenue; existing.commission += ev.commission; }
          }
        }
        const sumOrders = adminBreakdown.reduce((n, a) => n + a.totalOrders, 0);
        const sumTickets = adminBreakdown.reduce((n, a) => n + a.totalTickets, 0);
        const sumRevenue = adminBreakdown.reduce((n, a) => n + a.totalRevenue, 0);
        const sumCommission = adminBreakdown.reduce((n, a) => n + a.totalCommission, 0);
        return sendJson(res, 200, { success: true, stats: {
          totalOrders: sumOrders,
          totalRevenue: sumRevenue,
          totalTickets: sumTickets,
          totalCommission: sumCommission,
          uniquePeople: allPeople.size,
          link: null, overview: true,
          adminBreakdown, events: Array.from(eventMap.values())
        }});
      }

      const assignment = assignmentId ? acceptedAssignments.find(a => a.id === assignmentId) : null;
      if (assignmentId && !assignment) return sendJson(res, 403, { success: false, error: 'You are not assigned to this referral portal.' });
      let link = assignment ? await getReferralLinkForAssignment(user.id, assignment.id) : await getReferralLinkByInfluencerId(user.id);
      if (!link) return sendJson(res, 200, { success: true, stats: { totalOrders: 0, totalRevenue: 0, totalTickets: 0, uniquePeople: 0, link: null } });
      const referredOrders = await getScopedReferralOrders(link, orders, events, assignment ? assignment.influencerAdminId : null);
      const uniquePeople = new Set(referredOrders.map(o => String(o.buyerEmail || '').trim().toLowerCase()).filter(Boolean)).size;
      const totalRevenue = referredOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
      const totalCommission = referredOrders.reduce((sum, o) => sum + commissionForOrder(o), 0);
      const eventBreakdown = buildEventBreakdown(referredOrders, assignment.influencerAdminId);
      return sendJson(res, 200, { success: true, stats: {
        totalOrders: referredOrders.length,
        totalRevenue,
        totalTickets: referredOrders.reduce((sum, o) => sum + (parseInt(o.qty, 10) || 0), 0),
        totalCommission,
        uniquePeople, link: referralLinkResponse(link), events: eventBreakdown
      }});
    }

    // ── Sub-admin: list the check-ins performed by this sub-admin account ──
    // Returns a summary of every ticket this sub-admin has scanned (checked-in),
    // so they can see their own activity. Requires a logged-in sub-admin session
    // (master admin is NOT allowed here — the admin dashboard has its own view).
    if (pathname === '/api/subadmin/checkins' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || !['subadmin','checkin_staff'].includes(user.role)) {
        return sendJson(res, 403, { success: false, error: 'Check-in staff access only' });
      }
      const staffName = user.name || user.email;
      const orders = await readOrders();
      const checkins = [];
      orders.forEach(function(o) {
        (o.ticketCodes || []).forEach(function(t) {
          if (t.used && (t.checkedInBy === staffName || t.checkedInBy === user.email)) {
            checkins.push({
              orderId: o.orderId,
              ticketCode: t.code,
              usedAt: t.usedAt,
              checkedInBy: t.checkedInBy,
              eventName: o.eventName,
              buyerName: o.buyerName,
              qty: o.qty
            });
          }
        });
      });
      // Sort newest first
      checkins.sort(function(a, b) {
        return new Date(b.usedAt || 0) - new Date(a.usedAt || 0);
      });
      return sendJson(res, 200, { success: true, checkins: checkins, total: checkins.length });
    }

    // ── Sub-admin: generate/get referral link ──
    if (pathname === '/api/subadmin/referral-link' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'subadmin') {
        return sendJson(res, 403, { success: false, error: 'Sub-admin access only' });
      }
      
      let link = await getReferralLinkBySubadminId(user.id);
      if (!link) {
        link = await generateReferralLink(user.id, user.name, user.email);
      } else {
        // Refresh stats
        await updateReferralStats(link.code);
        link = await getReferralLinkBySubadminId(user.id);
      }
      
      return sendJson(res, 200, { success: true, link: referralLinkResponse(link) });
    }

    // ── Sub-admin: global sales overview (all verified sales, not referral-limited) ──
    if (pathname === '/api/subadmin/sales-overview' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'subadmin') {
        return sendJson(res, 403, { success: false, error: 'Sub-admin access only' });
      }
      const orders = await getOrdersForCurrentSiteEvents();
      const statusOf = o => String(o.status || 'pending').trim().toLowerCase();
      const pending = orders.filter(o => statusOf(o) === 'pending');
      const verified = orders.filter(o => statusOf(o) === 'verified');
      const rejected = orders.filter(o => statusOf(o) === 'rejected');
      const ticketsSold = verified.reduce((sum, o) => sum + (parseInt(o.qty, 10) || 0), 0);
      const revenue = verified.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
      const uniquePeople = new Set(verified.map(o => String(o.buyerEmail || '').trim().toLowerCase()).filter(Boolean)).size;
      const eventMap = {};
      verified.forEach(o => {
        const key = String(o.eventId || o.eventName || 'unknown');
        if (!eventMap[key]) eventMap[key] = { eventId: o.eventId || null, eventName: o.eventName || 'Unknown Event', tickets: 0, orders: 0, revenue: 0 };
        eventMap[key].tickets += parseInt(o.qty, 10) || 0;
        eventMap[key].orders += 1;
        eventMap[key].revenue += Number(o.amount) || 0;
      });
      return sendJson(res, 200, {
        success: true,
        sales: {
          totalOrders: orders.length,
          pendingOrders: pending.length,
          verifiedOrders: verified.length,
          rejectedOrders: rejected.length,
          totalTickets: ticketsSold,
          totalRevenue: revenue,
          uniquePeople,
          events: Object.values(eventMap).sort((a,b) => b.tickets - a.tickets)
        }
      });
    }

    // ── Sub-admin: list sales/orders (READ-ONLY) ──
    // Mirrors the main admin's Orders Overview so a sub-admin can see every sale
    // made on the site. It deliberately exposes NO status-changing capability:
    // verifying/rejecting a payment stays on /api/admin/orders/status, which
    // requires the master admin password and is unreachable with a sub-admin
    // session token.
    if (pathname === '/api/subadmin/orders' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'subadmin') {
        return sendJson(res, 403, { success: false, error: 'Sub-admin access only' });
      }
      const orders = await getOrdersForCurrentSiteEvents();
      return sendJson(res, 200, { success: true, orders: orders });
    }

    // ── Sub-admin: list payout requests (READ-ONLY) ──
    // Mirrors the main admin's Payout Requests panel so a sub-admin can see every
    // payout is released — amounts, the rates, bank details and status.
    // It deliberately exposes NO payout capability: approving, marking paid and
    // rejecting all live on /api/admin/payouts (POST), which requires the master
    // admin password and is unreachable with a sub-admin session token.
    if (pathname === '/api/subadmin/payouts' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'subadmin') {
        return sendJson(res, 403, { success: false, error: 'Sub-admin access only' });
      }
      const payouts = await readPayouts();
      // The sub-admin sees the same totals the main admin does — the
      // split included — so nothing about a payout is hidden from oversight.
      const all = payouts.map(payoutPublic);
      const sum = (rows, key) => Math.round(rows.reduce((n, p) => n + (Number(p[key]) || 0), 0) * 100) / 100;
      const open = all.filter(p => ['pending','approved'].includes(String(p.status || '').toLowerCase()));
      return sendJson(res, 200, {
        success: true,
        payouts: all,
        feeRate: PAYOUT_FEE_RATE,
        commissionRates: COMMISSION_SPLIT,
        totals: {
          count: all.length,
          requested: sum(all, 'amount'),
          netToInfluencers: sum(all, 'netAmount'),
          platformFee: sum(all, 'feeAmount'),
          openCount: open.length,
          openAmount: sum(open, 'amount'),
          paidCount: all.filter(p => String(p.status || '').toLowerCase() === 'paid').length
        },
        readOnly: true
      });
    }

    // ── Sub-admin: get referral stats ──
    if (pathname === '/api/subadmin/referral-stats' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'subadmin') {
        return sendJson(res, 403, { success: false, error: 'Sub-admin access only' });
      }
      
      const link = await getReferralLinkBySubadminId(user.id);
      if (!link) {
        return sendJson(res, 200, { success: true, stats: { totalOrders: 0, totalRevenue: 0, totalTickets: 0, uniquePeople: 0, link: null } });
      }
      
      const orders = await getOrdersForCurrentSiteEvents();
      const referredOrders = orders.filter(o => isReferralOrderCounted(o, link.code));
      const totalTickets = referredOrders.reduce((sum, o) => sum + (o.qty || 0), 0);
      const totalRevenue = referredOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
      
      return sendJson(res, 200, { 
        success: true, 
        stats: { 
          totalOrders: referredOrders.length,
          totalRevenue: totalRevenue,
          totalTickets: totalTickets,
          link: link
        } 
      });
    }

    // ── Admin: mark orders seen ──
    if (pathname === '/api/admin/orders/seen' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const orderIds = Array.isArray(data.orderIds) ? data.orderIds.map(String) : [];
      const orders = await readOrders();
      let changed = false;
      orders.forEach(o => {
        if (orderIds.includes(o.orderId) && !o.seenByAdmin) {
          o.seenByAdmin = true;
          changed = true;
        }
      });
      if (changed) await writeOrders(orders);
      return sendJson(res, 200, { success: true });
    }

    // ── Admin: list orders ──
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      await removeDemoDataAndKeepSiteCreatedEvents();
      const orders = await readOrders();
      return sendJson(res, 200, { success: true, unseenCount: unseenOrderCount(orders), orders: orders });
    }

    // ── Admin: unseen count ──
    if (pathname === '/api/admin/unseen-count' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      await removeDemoDataAndKeepSiteCreatedEvents();
      const orders = await readOrders();
      return sendJson(res, 200, { success: true, unseenCount: unseenOrderCount(orders) });
    }

    // ── Admin: resend buyer confirmation email for an order ──
    if (pathname === '/api/admin/orders/resend-email' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const orderId = String(data.orderId || '').trim();
      if (!orderId) return sendJson(res, 400, { success: false, error: 'Missing orderId' });
      const order = await getOrder(orderId);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found' });
      if (order.status === 'verified') {
        await sendBuyerConfirmation(order);
      } else if (order.status === 'pending') {
        await sendNewOrderAlert(order);
      } else {
        return sendJson(res, 400, { success: false, error: 'Order is not eligible for email resend (status: ' + order.status + ')' });
      }
      return sendJson(res, 200, { success: true, message: 'Email queued' });
    }

    // ── Admin: update order status (verify/reject/reopen) ──
    if (pathname === '/api/admin/orders/status' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const orderId = String(data.orderId || '').trim();
      const newStatus = String(data.status || '').trim();
      if (!orderId || !['verified', 'rejected', 'pending'].includes(newStatus)) {
        return sendJson(res, 400, { success: false, error: 'Invalid orderId or status' });
      }
      const order = await getOrder(orderId);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found' });

      if (newStatus === 'verified') {
        const wasVerified = order.status === 'verified';
        const updated = await patchOrder(orderId, verifyOrderTicketData(Object.assign({}, order)));
        if (!wasVerified) {
          notifyOrderVerified(updated);
          await refreshReferralStatsForVerifiedOrder(updated, order.status);
        }
        return sendJson(res, 200, { success: true, order: updated });
      }
      const updated = await patchOrder(orderId, { status: newStatus });
      return sendJson(res, 200, { success: true, order: updated });
    }

    // ── Coupons: Main Admin + Sub-admin only ──
    if (pathname === '/api/admin/coupons' && req.method === 'GET') {
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','subadmin'].includes(authCtx.role)) return sendJson(res, 403, { success: false, error: 'Admin/Sub-admin access only' });
      const coupons = await readCoupons();
      return sendJson(res, 200, { success: true, coupons });
    }
    if (pathname === '/api/admin/coupons' && req.method === 'POST') {
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','subadmin'].includes(authCtx.role)) return sendJson(res, 403, { success: false, error: 'Admin/Sub-admin access only' });
      const body = await readBody(req); let data = {}; try { data = JSON.parse(body || '{}'); } catch(e) {}
      const id = String(data.id || '').trim() || 'cpn-' + Date.now().toString(36);
      const code = String(data.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      const amount = Math.max(0, Number(data.amount) || 0);
      if (!code || code.length < 3) return sendJson(res, 400, { success: false, error: 'Coupon code must be at least 3 characters.' });
      if (amount <= 0) return sendJson(res, 400, { success: false, error: 'Discount amount must be greater than 0.' });
      const coupons = await readCoupons();
      const duplicate = coupons.find(c => String(c.code || '').toUpperCase() === code && String(c.id) !== id);
      if (duplicate) return sendJson(res, 409, { success: false, error: 'That coupon code already exists.' });
      const existing = coupons.find(c => String(c.id) === id);
      const coupon = Object.assign({}, existing || {}, { id, code, amount, active: data.active !== false, updatedAt: new Date().toISOString(), createdBy: existing && existing.createdBy ? existing.createdBy : (authCtx.user ? authCtx.user.id : 'admin') });
      if (!coupon.createdAt) coupon.createdAt = new Date().toISOString();
      const next = existing ? coupons.map(c => String(c.id) === id ? coupon : c) : [coupon].concat(coupons);
      await writeCoupons(next);
      return sendJson(res, 200, { success: true, coupon });
    }
    if (pathname === '/api/admin/coupons' && req.method === 'DELETE') {
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','subadmin'].includes(authCtx.role)) return sendJson(res, 403, { success: false, error: 'Admin/Sub-admin access only' });
      const id = String(url.searchParams.get('id') || '').trim();
      if (!id) return sendJson(res, 400, { success: false, error: 'Missing coupon id' });
      const coupons = await readCoupons();
      const next = coupons.filter(c => String(c.id) !== id);
      await writeCoupons(next);
      return sendJson(res, 200, { success: true });
    }
    if (pathname === '/api/referrals/validate' && req.method === 'POST') {
      const body = await readBody(req); let data = {}; try { data = JSON.parse(body || '{}'); } catch(e) {}
      const code = String(data.code || '').trim().toUpperCase();
      if (!code) return sendJson(res, 400, { success:false, error:'Enter a referral code.' });
      const link = await getReferralLinkByCode(code);
      if (!link) return sendJson(res, 400, { success:false, error:'Invalid referral code.' });
      return sendJson(res, 200, { success:true, referral:{code:link.code, name:link.subadminName || link.name || ''} });
    }

    if (pathname === '/api/coupons/validate' && req.method === 'POST') {
      const body = await readBody(req); let data = {}; try { data = JSON.parse(body || '{}'); } catch(e) {}
      const code = String(data.code || '').trim().toUpperCase();
      const eventId = String(data.eventId || '').trim();
      const tier = String(data.ticketTier || 'regular').toLowerCase();
      const qty = Math.max(1, parseInt(data.qty) || 1);
      const coupon = await getCouponByCode(code);
      if (!coupon) return sendJson(res, 400, { success: false, error: 'Invalid or inactive coupon code.' });
      const events = await readEvents(); const ev = events.find(e => String(e.id) === eventId);
      if (!ev) return sendJson(res, 400, { success: false, error: 'Event not found.' });
      const originals = {regular:Number(ev.price||0),vip:Number(ev.vipPrice||0),vvip:Number(ev.vvipPrice||0),table:Number(ev.tablePrice||0)};
      const bonuses = {regular:Number(ev.bonusPrice||0),vip:Number(ev.bonusVipPrice||0),vvip:Number(ev.bonusVvipPrice||0),table:Number(ev.bonusTablePrice||0)};
      const originalUnit = originals[tier] > 0 ? originals[tier] : originals.regular;
      const bonusUnit = bonuses[tier] || 0;
      const referralCode = String(data.referralCode || '').trim().toUpperCase();
      let referralApplied = false;
      if (referralCode) {
        const referralLink = await getReferralLinkByCode(referralCode);
        if (!referralLink) return sendJson(res, 400, { success:false, error:'Invalid referral code.' });
        referralApplied = true;
      }
      const unit = referralApplied ? originalUnit : (bonusUnit > 0 ? bonusUnit : originalUnit);
      const baseTotal = unit * qty; const discount = Number(coupon.amount) || 0;
      if (discount >= baseTotal) return sendJson(res, 400, { success:false, error:'Coupon discount cannot cover the full ticket price.' });
      return sendJson(res, 200, { success:true, coupon:{code:coupon.code, amount:discount}, baseTotal, discount, total:baseTotal-discount });
    }

    // ── Public selected-event lookup (used by Buy Now -> tickets.html) ──
    // Returns only the requested event and its inventory so the checkout UI can
    // render the clicked event without waiting for the full university catalog.
    if (pathname === '/api/event' && req.method === 'GET') {
      const eventId = String(url.searchParams.get('id') || '').trim();
      if (!eventId) return sendJson(res, 400, { success: false, error: 'Event ID is required.' });
      const allEvents = await readEvents();
      const event = allEvents.find(function(e) { return String(e && e.id || '') === eventId; });
      if (!event || event.archived === true) {
        return sendJson(res, 404, { success: false, error: 'Event not found.' });
      }
      const orders = await readOrders();
      const inventoryMap = buildEventInventoryMap(orders);
      const enriched = Object.assign({}, event, { inventory: {
        regular: getTierInventoryFromMap(event, 'regular', inventoryMap),
        vip: getTierInventoryFromMap(event, 'vip', inventoryMap),
        vvip: getTierInventoryFromMap(event, 'vvip', inventoryMap),
        table: getTierInventoryFromMap(event, 'table', inventoryMap)
      }});
      return sendJson(res, 200, { success: true, event: enriched });
    }

    // ── Public events list (used by events.html, tickets.html, index.html) ──
    if (pathname === '/api/events' && req.method === 'GET') {
      const allEvents = await readEvents();
      const includeArchived = url.searchParams.get('includeArchived') === '1';
      let events = allEvents;
      if (!includeArchived) {
        events = allEvents.filter(e => e.archived !== true);
      } else {
        const authCtx = await isAdminOrSubadmin(req);
        if (!authCtx || !['admin','subadmin','influencer_admin'].includes(authCtx.role)) {
          // Archived records are never exposed to unauthenticated/public callers.
          events = allEvents.filter(e => e.archived !== true);
        } else if (authCtx.role === 'influencer_admin') {
          // Influencer Admins may see archived events only when they own them.
          // Explicitly authorized events remain view-only and are not treated as
          // owned management records.
          events = allEvents.filter(e => e.archived !== true || influencerAdminOwnsEvent(authCtx, e));
        }
      }
      const uniSlug = String(url.searchParams.get('university') || '').trim();
      const orders = await readOrders();
      const inventoryMap = buildEventInventoryMap(orders);
      function enrich(ev) {
        return Object.assign({}, ev, { inventory: {
          regular: getTierInventoryFromMap(ev,'regular',inventoryMap),
          vip: getTierInventoryFromMap(ev,'vip',inventoryMap),
          vvip: getTierInventoryFromMap(ev,'vvip',inventoryMap),
          table: getTierInventoryFromMap(ev,'table',inventoryMap)
        }});
      }
      if (uniSlug) {
        const universities = await readUniversities();
        const queryKey = uniSlug.toLowerCase();
        const selectedMatches = universities.filter(function(university) {
          return [university.id, university.slug, university.name].some(function(value) {
            return String(value || '').trim().toLowerCase() === queryKey;
          });
        });
        // A university name is the user-facing identity. If duplicate catalogue
        // records share the same name, treat them as one university instead of
        // arbitrarily selecting one ID. This keeps events consistent for every
        // university, including older records created with an alternate ID.
        const selectedUniversity = selectedMatches[0] || null;
        const universityKeys = new Set();
        selectedMatches.forEach(function(university) {
          [university.id, university.slug, university.name].forEach(function(value) {
            const key = String(value || '').trim().toLowerCase();
            if (key) universityKeys.add(key);
          });
        });
        if (!selectedMatches.length) universityKeys.add(queryKey);
        const filtered = events.filter(function(e) {
          // Treat the university metadata as one identity. If multiple fields
          // are present, all of them must agree with the selected university.
          // This prevents stale/conflicting metadata from leaking an event
          // from another campus into the selected campus view.
          const fields = [e.universityId, e.universitySlug, e.universityName]
            .map(function(value) { return String(value || '').trim().toLowerCase(); })
            .filter(Boolean);
          return fields.length > 0 && fields.every(function(value) {
            return universityKeys.has(value);
          });
        }).map(enrich);
        return sendJson(res, 200, { success: true, events: filtered });
      }
      return sendJson(res, 200, { success: true, events: events.map(enrich) });
    }

    // ── Public site stats (events, tickets sold, faculties) ──
    // Computed live from the events catalog + verified orders so the home page
    // counters are always accurate (no hardcoded numbers).
    if (pathname === '/api/stats' && req.method === 'GET') {
      const events = await readEvents();
      const orders = await readOrders();
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      // Normalize admin-entered dates such as "SEP. 25TH 2026" before counting.
      function parseEventDate(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const native = new Date(raw);
        if (!isNaN(native)) return native;
        const normalized = raw
          .replace(/\b(\d{1,2})(?:ST|ND|RD|TH)\b/ig, '$1')
          .replace(/\./g, '')
          .replace(/\s+/g, ' ');
        const parsed = new Date(normalized);
        return isNaN(parsed) ? null : parsed;
      }

      // Events happening this month (including admin-entered ordinal dates)
      let eventsThisMonth = 0;
      events.forEach(function(ev) {
        const d = parseEventDate(ev.date);
        if (!d) return;
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) eventsThisMonth++;
      });

      // Upcoming events (date >= today)
      const upcomingEvents = events.filter(function(ev) {
        const d = parseEventDate(ev.date);
        if (!d) return false;
        return d >= now;
      }).length;

      // Tickets sold = sum of qty for verified orders
      let ticketsSold = 0;
      orders.forEach(function(o) {
        if (o.status === 'verified') ticketsSold += (parseInt(o.qty) || 0);
      });

      // Faculties = unique event categories
      const facultySet = {};
      events.forEach(function(ev) {
        if (ev.category) facultySet[String(ev.category).trim()] = true;
      });
      const faculties = Object.keys(facultySet).length;

      return sendJson(res, 200, {
        success: true,
        stats: {
          totalEvents: events.length,
          eventsThisMonth: eventsThisMonth,
          upcomingEvents: upcomingEvents,
          ticketsSold: ticketsSold,
          faculties: faculties
        }
      });
    }

// ── Main Admin: list ALL existing events for management/authorization ──
    if (pathname === '/api/admin/events' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      return sendJson(res, 200, { success: true, events: await readEvents() });
    }

    // ── Sub-admin: list events for management/editing ──
    // The public /api/events endpoint calculates inventory for every event.
    // Private event management does not need that calculation.
    if (pathname === '/api/subadmin/events' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'subadmin') return sendJson(res, 401, { success: false, error: 'Sub-admin access only' });
      return sendJson(res, 200, { success: true, events: await readEvents() });
    }

    // ── Main Admin: explicitly authorize an existing event to an Influencer Admin ──
    if (pathname === '/api/admin/events/authorize-influencer' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 403, { success: false, error: 'Only the Main Admin can authorize events.' });
      const body = await readBody(req);
      let data = {}; try { data = JSON.parse(body || '{}'); } catch(e) {}
      const eventId = String(data.eventId || '').trim();
      const influencerAdminId = String(data.influencerAdminId || '').trim();
      const action = String(data.action || 'add').toLowerCase();
      if (!eventId || !influencerAdminId) return sendJson(res, 400, { success:false, error:'Event and Influencer Admin are required.' });
      const users = await readUsers();
      const staff = users.find(u => String(u.id) === influencerAdminId && u.role === 'influencer_admin' && u.archived !== true);
      if (!staff) return sendJson(res, 404, { success:false, error:'Influencer Admin not found.' });
      const events = await readEvents();
      const idx = events.findIndex(e => String(e.id) === eventId);
      if (idx < 0) return sendJson(res, 404, { success:false, error:'Event not found.' });
      const ids = getAuthorizedInfluencerAdminIds(events[idx]);
      if (action === 'remove') {
        events[idx].authorizedInfluencerAdminIds = ids.filter(id => id !== influencerAdminId);
      } else {
        if (!ids.includes(influencerAdminId)) ids.push(influencerAdminId);
        events[idx].authorizedInfluencerAdminIds = ids;
      }
      await writeEvents(events);
      return sendJson(res, 200, { success:true, event:events[idx] });
    }

    // ── Influencer Admin: event-specific sales overview ──
    if (pathname === '/api/influencer-admin/event-overview' && req.method === 'GET') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 403, { success:false, error:'Influencer Admin access only' });
      const events = await readEvents();
      const users = await readUsers();
      const links = await readReferralLinks();
      const orders = await readOrders();
      const authorizedEvents = influencerAdminVisibleEvents(authCtx, events);
      const ownInfluencers = users.filter(u => {
        if (u.role !== 'influencer' || u.archived === true) return false;
        return influencerAdminOwnsInfluencer(authCtx, u);
      });
      const result = authorizedEvents.map(ev => {
        const eventOrders = orders.filter(o => eventMatchesOrder(o, ev));
        const influencerRows = ownInfluencers.map(inf => {
          const acceptedAssignments = getAcceptedInfluencerAssignments(inf);
          const assignment = acceptedAssignments.find(a => a.influencerAdminId === String(authCtx.user.id)) || null;
          const link = assignment
            ? links.find(l => String(l.influencerId || l.ownerId || '') === String(inf.id) && String(l.assignmentId || '') === String(assignment.id))
            : links.find(l => l.influencerId === inf.id || l.ownerId === inf.id || l.subadminId === inf.id);
          const code = link && link.code;
          const rows = code ? eventOrders.filter(o => {
            const status = String(o.status || '').toLowerCase();
            return o.referralCode === code && status !== 'rejected';
          }) : [];
          const verified = rows.filter(o => String(o.status || '').toLowerCase() === 'verified');
          const pending = rows.filter(o => String(o.status || '').toLowerCase() === 'pending');
          // Influencer Admins need sales visibility, not customers' private contact data.
          // Never pass buyer email/phone or other unnecessary PII through this dashboard API.
          const safeRows = rows.map(o => ({
            orderId: o.orderId,
            status: o.status,
            eventId: o.eventId,
            eventName: o.eventName,
            eventDate: o.eventDate,
            eventVenue: o.eventVenue,
            qty: o.qty,
            amount: o.amount,
            currency: o.currency,
            paymentMethod: o.paymentMethod,
            ticketTier: o.ticketTier,
            verifiedAt: o.verifiedAt,
            createdAt: o.createdAt,
            referralCode: o.referralCode
          }));
          return { influencer: publicUser(inf), referralCode: code || null, orders: safeRows, totalOrders: rows.length, verifiedOrders: verified.length, pendingOrders: pending.length, ticketsSold: verified.reduce((n,o)=>n+(parseInt(o.qty,10)||0),0), pendingTickets: pending.reduce((n,o)=>n+(parseInt(o.qty,10)||0),0), revenue: verified.reduce((n,o)=>n+(Number(o.amount)||0),0) };
        });
        const visibleOrders = eventOrders.filter(o => String(o.status || '').toLowerCase() !== 'rejected');
        const verified = visibleOrders.filter(o => String(o.status || '').toLowerCase() === 'verified');
        const pending = visibleOrders.filter(o => String(o.status || '').toLowerCase() === 'pending');
        // rejectedOrders is deliberately NOT returned: rejected payments are the
        // Main Admin's decision and must not be surfaced in the Influencer Admin
        // dashboard.
        const revenue = verified.reduce((n,o)=>n+(Number(o.amount)||0),0);
        // Per-event breakdown, splitting referred sales (20% to the influencer,
        // 2.5% to Unisocials) from direct ones (20% to Unisocials).
        const referred = verified.filter(o => !!String(o.referralCode || '').trim()).reduce((n,o)=>n+(Number(o.amount)||0),0);
        const split = commissionTotals(referred, revenue - referred);
        return { event: ev, totalOrders:visibleOrders.length, pendingOrders:pending.length, verifiedOrders:verified.length, ticketsSold:verified.reduce((n,o)=>n+(parseInt(o.qty,10)||0),0), revenue, referredAmount:split.referredAmount, directAmount:split.directAmount, ownerCredit:split.ownerCreditAmount, influencerCommission:split.influencerAmount, eventOwnerShare:split.ownerNetAmount, platformShare:split.platformAmount, influencers:influencerRows };
      });
      // commissionRates lets the dashboard show how each sale was split.
      return sendJson(res, 200, { success:true, feeRate: PAYOUT_FEE_RATE, commissionRates: COMMISSION_SPLIT, events:result });
    }

    // ── Influencer Admin: their 80% share, minus what is owed to referrers ──
    // The event owner is credited 97.5% of a referred sale and 80% of a direct
    // one, but the influencer's 20% is allocated out of that credit — so the
    // owner always withdraws 80% of the ticket. Sales are classified per order
    // by whether they carried a referral code.
    async function influencerAdminPayoutSummary(authCtx) {
      const [events, orders, payouts] = await Promise.all([readEvents(), readOrders(), readPayouts()]);
      const authorizedEvents = influencerAdminVisibleEvents(authCtx, events);
      const nowMs = Date.now();
      const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
      let referredAmount = 0;
      let directAmount = 0;
      let heldReferred = 0;
      let heldDirect = 0;
      const heldPayments = [];
      authorizedEvents.forEach(ev => {
        orders.forEach(o => {
          if (!eventMatchesOrder(o, ev) || String(o.status || '').toLowerCase() !== 'verified') return;
          const amount = Number(o.amount) || 0;
          const referred = !!String(o.referralCode || '').trim();
          if (referred) referredAmount += amount; else directAmount += amount;
          // Every payment made through the site stays on hold for 7 days
          // from the moment it was paid before it becomes withdrawable.
          const paidMs = Date.parse(o.paymentReceivedAt || o.verifiedAt || o.createdAt || '');
          const unlocksMs = paidMs + PAYOUT_HOLD_MS;
          if (Number.isFinite(paidMs) && nowMs < unlocksMs) {
            if (referred) heldReferred += amount; else heldDirect += amount;
            // What this payment actually earned the owner, so the countdown is
            // read in withdrawable share rather than gross ticket revenue.
            heldPayments.push({
              orderId: o.orderId || '',
              eventName: o.eventName || '',
              amount,
              referred,
              commissionAmount: commissionSplit(amount, referred).ownerNetAmount,
              paidAt: new Date(paidMs).toISOString(),
              unlocksAt: new Date(unlocksMs).toISOString()
            });
          }
        });
      });
      const totals = commissionTotals(referredAmount, directAmount);
      const heldTotals = commissionTotals(heldReferred, heldDirect);
      const mine = payouts.filter(p => String(p.requestedBy) === String(authCtx.user.id));
      const balance = payoutBalance(totals.ownerNetAmount, heldTotals.ownerNetAmount, mine);
      heldPayments.sort((a, b) => new Date(a.unlocksAt) - new Date(b.unlocksAt));
      return {
        payouts: mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        // Gross ticket money, and how it was split.
        totalVerifiedRevenue: totals.grossAmount,
        referredAmount: totals.referredAmount,
        directAmount: totals.directAmount,
        // 97.5% of referred sales + 80% of direct sales: what the owner is owed
        // before the referrers' commission is allocated out of it.
        ownerCreditAmount: totals.ownerCreditAmount,
        // 20% of every referred ticket, owed to the influencers.
        influencerOwed: totals.influencerAmount,
        // What the owner actually walks away with: 80% of every ticket.
        ownerNetAmount: totals.ownerNetAmount,
        platformFee: totals.platformAmount,
        heldAmount: round2(heldTotals.grossAmount),
        heldPayments,
        earned: balance.earned,
        matured: balance.matured,
        held: balance.held,
        totalRequested: balance.committed,
        availableBalance: balance.availableBalance,
        commissionRates: COMMISSION_SPLIT,
        feeRate: PAYOUT_FEE_RATE,
        holdDays: PAYOUT_HOLD_DAYS,
        hasOpenRequest: mine.some(p => ['pending', 'approved'].includes(String(p.status || '').toLowerCase()))
      };
    }

    // Payouts requested by the INFLUENCERS working on this account's events.
    // Scoped to influencers holding an accepted relationship with this admin, so
    // an owner only ever sees commission owed on their own events.
    async function referrerPayoutsForInfluencerAdmin(authCtx) {
      const users = await readUsers();
      const links = await readReferralLinks();
      const myId = String(authCtx.user.id || '');
      const myReferrerIds = new Set();
      links.forEach(l => {
        if (String(l.influencerAdminId || '') !== myId) return;
        const infId = String(l.influencerId || l.ownerId || '').trim();
        if (infId) myReferrerIds.add(infId);
      });
      users.forEach(u => {
        if (u.role !== 'influencer') return;
        if (getAcceptedInfluencerAssignments(u).some(a => String(a.influencerAdminId || '') === myId)) {
          myReferrerIds.add(String(u.id));
        }
      });
      if (!myReferrerIds.size) return [];
      const payouts = await readPayouts();
      return payouts
        .filter(p => myReferrerIds.has(String(p.requestedBy)))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    if (pathname === '/api/influencer-admin/payouts' && req.method === 'GET') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 403, { success:false, error:'Influencer Admin access only' });
      const summary = await influencerAdminPayoutSummary(authCtx);
      const referrerPayouts = await referrerPayoutsForInfluencerAdmin(authCtx);
      const openReferrerPayouts = referrerPayouts.filter(p => ['pending','approved'].includes(String(p.status || '').toLowerCase()));
      const roundOut = v => Math.round((Number(v) || 0) * 100) / 100;
      // Commission the owner has already released to their referrers no longer
      // counts as owed, otherwise the dashboard kept demanding money that had
      // already left and the owner could be left chasing a settled balance.
      const influencerPaidOut = roundOut(referrerPayouts
        .filter(p => String(p.status || '').toLowerCase() === 'paid')
        .reduce((s, p) => s + (Number(p.amount) || 0), 0));
      const influencerCommitted = roundOut(referrerPayouts
        .filter(p => ['pending','approved','paid'].includes(String(p.status || '').toLowerCase()))
        .reduce((s, p) => s + (Number(p.amount) || 0), 0));
      const contactEmail = isInternalLoginEmail(authCtx.user && authCtx.user.contactEmail) ? '' : String((authCtx.user && authCtx.user.contactEmail) || '').trim().toLowerCase();
      return sendJson(res, 200, {
        success: true,
        payouts: summary.payouts.map(payoutPublic),
        // Gross ticket money on this account's events, split by whether a
        // referral link was used.
        totalVerifiedRevenue: summary.totalVerifiedRevenue,
        referredAmount: summary.referredAmount,
        directAmount: summary.directAmount,
        // Credited, allocated out, and what is actually withdrawable.
        ownerCreditAmount: summary.ownerCreditAmount,
        influencerOwed: roundOut(Math.max(0, summary.influencerOwed - influencerPaidOut)),
        influencerEarned: summary.influencerOwed,
        influencerPaidOut: influencerPaidOut,
        influencerCommitted: influencerCommitted,
        ownerNetAmount: summary.ownerNetAmount,
        platformFee: summary.platformFee,
        heldAmount: summary.heldAmount,
        heldPayments: summary.heldPayments,
        totalRequested: summary.totalRequested,
        availableBalance: summary.availableBalance,
        commissionRates: summary.commissionRates,
        feeRate: summary.feeRate,
        holdDays: summary.holdDays,
        hasOpenRequest: summary.hasOpenRequest,
        payoutMethods: Object.entries(PAYOUT_METHODS).map(([value, m]) => ({ value, label: m.label, description: m.description })),
        savedBankAccount: (authCtx.user && authCtx.user.payoutBankAccount) || null,
        // Where the "payout complete" notice goes. The @unisocials.com login
        // cannot receive mail, so this is the only usable address.
        notificationEmail: contactEmail,
        notificationEmailOnFile: !!contactEmail,
        // Read-only visibility of what this account's referrers have asked for.
        referrerPayouts: referrerPayouts.map(payoutPublic),
        openReferrerPayoutCount: openReferrerPayouts.length,
        openReferrerPayoutAmount: roundOut(openReferrerPayouts.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
        openReferrerPayoutAmount: Math.round(openReferrerPayouts.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100
      });
    }

    // The event owner withdraws their 80%: 97.5% of a referred sale less the
    // influencer's 20% allocated out of it, and 80% of a direct sale. The same
    // request/approve/pay flow and completion email the referrer uses.
    if (pathname === '/api/influencer-admin/payouts' && req.method === 'POST') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 403, { success:false, error:'Influencer Admin access only' });
      const parsed = parsePayoutRequestBody(await readBody(req));
      if (parsed.error) return sendJson(res, 400, { success:false, error: parsed.error });

      const summary = await influencerAdminPayoutSummary(authCtx);
      if (summary.hasOpenRequest) return sendJson(res, 409, { success:false, error:'You already have a payout request awaiting payment. Please wait for it to be completed.' });
      if (parsed.amount > summary.availableBalance) {
        let error = 'payout amount not valid: the amount you requested exceeds your available ' +
          rateLabel(EVENT_OWNER_RATE) + ' share of ₦' + summary.availableBalance.toLocaleString() + '.';
        error += ' That is ' + rateLabel(EVENT_OWNER_RATE) + ' of the ₦' + Math.round(summary.matured / EVENT_OWNER_RATE).toLocaleString() +
          ' in matured verified payments, less ₦' + summary.totalRequested.toLocaleString() + ' already requested.';
        if (summary.held > 0) {
          error += ' You also have ₦' + summary.held.toLocaleString() + ' inside the ' + PAYOUT_HOLD_DAYS + '-day countdown that unlocks automatically.';
        }
        return sendJson(res, 400, { success:false, error });
      }

      const freshUser = (await findUserById(authCtx.user.id)) || authCtx.user;
      const payout = await storePayoutRequest(freshUser, parsed);
      const fee = payoutFeeSplit(payout);
      // Notify the Main Admin by email so they can verify and pay within 24 hours.
      const emailSent = await sendPayoutRequestEmailToAdmin(payout);
      return sendJson(res, 200, {
        success: true,
        payout: payoutPublic(payout),
        availableBalance: Math.max(0, summary.availableBalance - parsed.amount),
        adminEmailSent: !!emailSent,
        message: 'Payout request submitted: ₦' + fee.netAmount.toLocaleString() + ' will be sent to you, and the Main Admin will pay it within 24 hours of approval. Your referrers\' 20% commission is separate — they request it themselves.'
      });
    }

    // Save the real inbox payout notifications go to. An Influencer Admin
    // created by the Main Admin has no contactEmail, so without this the
    // "payout complete" notice would have nowhere to go. Saving it here also
    // re-sends the completion notice for any already-paid payout that never
    // reached them.
    if (pathname === '/api/influencer-admin/payouts' && req.method === 'PATCH') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 403, { success:false, error:'Influencer Admin access only' });
      const body = await readBody(req);
      let data = {}; try { data = JSON.parse(body || '{}'); } catch (e) {}
      const notificationEmail = String(data.notificationEmail || '').trim().toLowerCase();
      const emailError = validateEmail(notificationEmail);
      if (emailError) return sendJson(res, 400, { success:false, error: emailError });
      // The site mints <name>@unisocials.com logins that cannot receive mail.
      if (isInternalLoginEmail(notificationEmail)) {
        return sendJson(res, 400, { success:false, error:'Use a real email address you check (Gmail, Yahoo, Outlook). Your @unisocials.com login cannot receive mail.' });
      }
      const users = await readUsers();
      const taken = users.find(u => String(u.id) !== String(authCtx.user.id) && String(u.contactEmail || '').trim().toLowerCase() === notificationEmail);
      if (taken) return sendJson(res, 409, { success:false, error:'That email is already used by another Unisocials account.' });
      const saved = await savePayoutNotificationEmail(authCtx.user.id, notificationEmail);
      if (saved.error) return sendJson(res, saved.status, { success:false, error: saved.error });
      return sendJson(res, 200, {
        success: true,
        notificationEmail: notificationEmail,
        resentPayoutNotifications: saved.resent,
        message: 'Payout notifications will be sent to ' + notificationEmail + '.'
      });
    }

    // ── Influencer (referrer): withdraw the 20% commission ──
    // The 20% is earned only on sales that came through this influencer's own
    // referral link. They ask for it here; the Influencer Admin of the event
    // approves and pays it. Same records, emails and oversight as every other
    // payout — only the role allowed to release it differs.
    // The Influencer Admins who run the events this referrer's links point at.
    // They are the ones who owe, approve and pay the commission.
    async function eventOwnerIdsForInfluencer(user) {
      const ids = new Set();
      const fresh = (await findUserById(user.id)) || user;
      getAcceptedInfluencerAssignments(fresh).forEach(a => {
        const id = String(a.influencerAdminId || '').trim();
        if (id) ids.add(id);
      });
      const links = await getReferralLinksByInfluencerId(user.id);
      links.forEach(l => {
        const id = String(l.influencerAdminId || '').trim();
        if (id) ids.add(id);
      });
      return [...ids];
    }

    async function influencerPayoutSummary(user) {
      const links = await getReferralLinksByInfluencerId(user.id);
      const codes = new Set(links.map(l => String(l.code || '').trim()).filter(Boolean));
      const orders = await getOrdersForCurrentSiteEvents();
      const payouts = await readPayouts();
      const nowMs = Date.now();
      const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
      let referredRevenue = 0;
      let heldRevenue = 0;
      const heldPayments = [];
      orders.forEach(o => {
        // Only a sale that actually carried this influencer's code counts.
        if (!codes.has(String(o.referralCode || '').trim())) return;
        if (String(o.status || '').toLowerCase() !== 'verified') return;
        const amount = Number(o.amount) || 0;
        referredRevenue += amount;
        // The commission is 20% of the FULL ticket, not of the owner's 97.5%.
        const commission = commissionSplit(amount, true).influencerAmount;
        const paidMs = Date.parse(o.paymentReceivedAt || o.verifiedAt || o.createdAt || '');
        const unlocksMs = paidMs + PAYOUT_HOLD_MS;
        if (Number.isFinite(paidMs) && nowMs < unlocksMs) {
          heldRevenue += amount;
          heldPayments.push({
            orderId: o.orderId || '',
            eventName: o.eventName || '',
            amount,
            commissionAmount: commission,
            paidAt: new Date(paidMs).toISOString(),
            unlocksAt: new Date(unlocksMs).toISOString()
          });
        }
      });
      referredRevenue = round2(referredRevenue);
      heldRevenue = round2(heldRevenue);
      const mine = payouts.filter(p => String(p.requestedBy) === String(user.id));
      const earned = round2(referredRevenue * INFLUENCER_COMMISSION_RATE);
      const held = round2(heldRevenue * INFLUENCER_COMMISSION_RATE);
      const balance = payoutBalance(earned, held, mine);
      // For context: of the money their link brought in, 97.5% was credited to
      // the event owner (who passes on 80% to themselves) and 2.5% to Unisocials.
      const totals = commissionTotals(referredRevenue, 0);
      heldPayments.sort((a, b) => new Date(a.unlocksAt) - new Date(b.unlocksAt));
      return {
        payouts: mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        referredRevenue,
        heldRevenue,
        heldPayments,
        // 20% of the FULL ticket, withdrawn with no further deduction.
        totalCommission: earned,
        availableBalance: balance.availableBalance,
        totalRequested: balance.committed,
        maturedCommission: balance.matured,
        commissionRates: COMMISSION_SPLIT,
        feeRate: PAYOUT_FEE_RATE,
        holdDays: PAYOUT_HOLD_DAYS,
        referralCodes: [...codes],
        hasOpenRequest: mine.some(p => ['pending', 'approved'].includes(String(p.status || '').toLowerCase())),
        eventOwnerShare: totals.ownerCreditAmount,
        platformShare: totals.platformAmount
      };
    }

    if (pathname === '/api/influencer/payouts' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'influencer') return sendJson(res, 403, { success:false, error:'Influencer access only' });
      const summary = await influencerPayoutSummary(user);
      const contactEmail = isInternalLoginEmail(user.contactEmail) ? '' : String(user.contactEmail || '').trim().toLowerCase();
      return sendJson(res, 200, {
        success: true,
        payouts: summary.payouts.map(payoutPublic),
        referredRevenue: summary.referredRevenue,
        heldRevenue: summary.heldRevenue,
        heldPayments: summary.heldPayments,
        totalCommission: summary.totalCommission,
        maturedCommission: summary.maturedCommission,
        heldCommission: summary.heldRevenue * INFLUENCER_COMMISSION_RATE,
        availableBalance: summary.availableBalance,
        totalRequested: summary.totalRequested,
        eventOwnerShare: summary.eventOwnerShare,
        platformShare: summary.platformShare,
        commissionRates: summary.commissionRates,
        feeRate: summary.feeRate,
        holdDays: summary.holdDays,
        hasOpenRequest: summary.hasOpenRequest,
        payoutMethods: Object.entries(PAYOUT_METHODS).map(([value, m]) => ({ value, label: m.label, description: m.description })),
        savedBankAccount: user.payoutBankAccount || null,
        // Where the "payout complete" notice goes. Influencers sign in with
        // their own email, so this is usually already on file.
        notificationEmail: contactEmail,
        notificationEmailOnFile: !!contactEmail
      });
    }

    if (pathname === '/api/influencer/payouts' && req.method === 'POST') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const sessionUser = await getSessionUser(token);
      if (!sessionUser || sessionUser.role !== 'influencer') return sendJson(res, 403, { success:false, error:'Influencer access only' });
      const parsed = parsePayoutRequestBody(await readBody(req));
      if (parsed.error) return sendJson(res, 400, { success:false, error: parsed.error });

      const summary = await influencerPayoutSummary(sessionUser);
      if (summary.hasOpenRequest) return sendJson(res, 409, { success:false, error:'You already have a payout request awaiting payment. Please wait for it to be completed.' });
      if (parsed.amount > summary.availableBalance) {
        let error = 'payout amount not valid: the amount you requested exceeds your available commission of ₦' +
          summary.availableBalance.toLocaleString() + ' (' + rateLabel(INFLUENCER_COMMISSION_RATE) +
          ' of the ₦' + summary.referredRevenue.toLocaleString() + ' your referral link brought in).';
        const heldCommission = Math.round(summary.heldRevenue * INFLUENCER_COMMISSION_RATE * 100) / 100;
        if (heldCommission > 0) {
          error += ' You also have ₦' + heldCommission.toLocaleString() + ' of commission inside the ' + PAYOUT_HOLD_DAYS + '-day countdown that unlocks automatically.';
        }
        return sendJson(res, 400, { success:false, error });
      }

      const freshUser = (await findUserById(sessionUser.id)) || sessionUser;
      const payout = await storePayoutRequest(freshUser, parsed, {
        eventOwnerIds: await eventOwnerIdsForInfluencer(freshUser)
      });
      const fee = payoutFeeSplit(payout);
      // Notify the Main Admin by email so they can verify and pay within 24 hours.
      const emailSent = await sendPayoutRequestEmailToAdmin(payout);
      return sendJson(res, 200, {
        success: true,
        payout: payoutPublic(payout),
        availableBalance: Math.max(0, summary.availableBalance - parsed.amount),
        adminEmailSent: !!emailSent,
        message: 'Payout request submitted: ₦' + fee.netAmount.toLocaleString() + ' of commission will be sent to you — ' + rateLabel(INFLUENCER_COMMISSION_RATE) + ' of every sale made through your link, with nothing further deducted. The Influencer Admin of the event has been notified and will pay within 24 hours of approval.'
      });
    }

    if (pathname === '/api/influencer/payouts' && req.method === 'PATCH') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const sessionUser = await getSessionUser(token);
      if (!sessionUser || sessionUser.role !== 'influencer') return sendJson(res, 403, { success:false, error:'Influencer access only' });
      const body = await readBody(req);
      let data = {}; try { data = JSON.parse(body || '{}'); } catch (e) {}
      const notificationEmail = String(data.notificationEmail || '').trim().toLowerCase();
      const emailError = validateEmail(notificationEmail);
      if (emailError) return sendJson(res, 400, { success:false, error: emailError });
      const users = await readUsers();
      const taken = users.find(u => String(u.id) !== String(sessionUser.id) && String(u.contactEmail || '').trim().toLowerCase() === notificationEmail);
      if (taken) return sendJson(res, 409, { success:false, error:'That email is already used by another Unisocials account.' });
      const saved = await savePayoutNotificationEmail(sessionUser.id, notificationEmail);
      if (saved.error) return sendJson(res, saved.status, { success:false, error: saved.error });
      sessionUser.contactEmail = notificationEmail;
      return sendJson(res, 200, {
        success: true,
        notificationEmail: notificationEmail,
        resentPayoutNotifications: saved.resent,
        message: 'Payout notifications will be sent to ' + notificationEmail + '.'
      });
    }


    // ── Admin: manage payout requests (verify, pay, reject) ──
    if (pathname === '/api/admin/payouts' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success:false, error:'Admin access only' });
      const [payouts, orders] = await Promise.all([readPayouts(), readOrders()]);
      // The site-wide view of what is still counting down before it can be
      // withdrawn, so the Main Admin sees the hold the owners and referrers see.
      const heldPayments = collectHeldPayments(orders, null, function (amount, referred) {
        return commissionSplit(amount, referred).ownerNetAmount;
      });
      return sendJson(res, 200, {
        success: true,
        payouts: payouts.map(payoutPublic),
        commissionRates: COMMISSION_SPLIT,
        feeRate: PAYOUT_FEE_RATE,
        holdDays: PAYOUT_HOLD_DAYS,
        heldPayments
      });
    }

    if (pathname === '/api/admin/payouts' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {}; try { data = JSON.parse(body || '{}'); } catch (e) {}
      const payoutId = String(data.payoutId || '').trim();
      const action = String(data.action || '').trim().toLowerCase();
      const adminNote = String(data.adminNote || '').trim().slice(0, 500);
      if (!payoutId) return sendJson(res, 400, { success:false, error:'Missing payoutId.' });
      if (!['approve','mark_paid','reject'].includes(action)) return sendJson(res, 400, { success:false, error:'Action must be approve, mark_paid, or reject.' });
      if (action === 'reject' && !adminNote) return sendJson(res, 400, { success:false, error:'Add a short reason when rejecting a payout request.' });

      const payouts = await readPayouts();
      const existing = payouts.find(p => p.id === payoutId);
      if (!existing) return sendJson(res, 404, { success:false, error:'Payout request not found.' });

      // Who may release this payout:
      //   • the master admin, for everything;
      //   • the Influencer Admin of the event, for a referrer's commission on
      //     their own events — that is who owes the money and pays it out.
      // A sub-admin can see payouts but never release one.
      let reviewerLabel = 'Admin';
      if (!isAdminAuthorized(req)) {
        const ownerCtx = await isAdminOrInfluencerAdmin(req);
        const ownerId = ownerCtx && ownerCtx.role === 'influencer_admin' ? String(ownerCtx.user.id) : '';
        const allowedOwners = Array.isArray(existing.eventOwnerIds) ? existing.eventOwnerIds.map(String) : [];
        if (!ownerId || !allowedOwners.includes(ownerId)) {
          return sendJson(res, 401, { success:false, error:'Only the Main Admin, or the Influencer Admin of the event this commission belongs to, can pay it.' });
        }
        reviewerLabel = (ownerCtx.user.name || 'Event Owner');
      }

      const currentStatus = String(existing.status || '').toLowerCase();
      if (currentStatus === 'paid') return sendJson(res, 409, { success:false, error:'This payout has already been paid.' });

      const nowIso = new Date().toISOString();
      const patch = { reviewedAt: nowIso, reviewedBy: reviewerLabel, adminNote: adminNote || existing.adminNote || '' };
      if (action === 'approve') {
        if (currentStatus === 'approved') return sendJson(res, 409, { success:false, error:'This payout is already approved.' });
        patch.status = 'approved';
        // The payment promise: approved payouts are paid within 24 hours.
        patch.paymentDueBy = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      } else if (action === 'mark_paid') {
        patch.status = 'paid';
        patch.paidAt = nowIso;
        if (!patch.paymentDueBy && currentStatus !== 'approved') patch.paymentDueBy = nowIso;
      } else {
        patch.status = 'rejected';
      }

      const updated = await updatePayoutRequest(payoutId, patch);
      // Email the Influencer Admin the outcome (best-effort, never blocks).
      // "paid" is the completion notice: the requester hears the money is out.
      const notifyEmail = await payoutRecipientEmail(Object.assign({}, existing, patch));
      const emailSent = updated ? await sendPayoutStatusEmailToRequester(Object.assign({}, existing, patch)) : false;
      if (emailSent) await updatePayoutRequest(payoutId, { notifiedEmail: notifyEmail, notifiedAt: nowIso });
      const payout = Object.assign({}, existing, patch, emailSent ? { notifiedEmail: notifyEmail } : {});
      // When nothing receivable is on file, say so instead of silently claiming
      // the influencer was notified — they can be asked for their real inbox.
      const emailWarning = notifyEmail ? '' : 'This requester has no real email address on file, so the payout email could not be sent. Ask them to add one in their dashboard → Payouts.';
      return sendJson(res, 200, { success: true, payout: payoutPublic(payout), emailSent: !!emailSent, emailAddress: notifyEmail, emailSentTo: emailSent ? notifyEmail : '', emailWarning });
    }

    // ── Influencer Admin: Add Events list ──
    // Keep the site's original Add Events flow: the Influencer Admin can see
    // events they created AND existing events explicitly authorized to them.
    // Authorized events are visible here for context, but are not treated as
    // newly-created/owned events.
    if (pathname === '/api/influencer-admin/events' && req.method === 'GET') {
      const authCtx = await isAdminOrInfluencerAdmin(req);
      if (!authCtx || authCtx.role !== 'influencer_admin') return sendJson(res, 401, { success:false, error:'Influencer Admin access only' });
      const myId = String(authCtx.user.id || '').trim();
      const myEmail = String(authCtx.user.email || '').trim().toLowerCase();
      const allEvents = await readEvents();
      const isMine = (ev) => {
        const c = ev && ev.createdBy;
        const direct = String(ev?.influencerAdminId || ev?.ownerInfluencerAdminId || ev?.createdByInfluencerAdminId || '').trim();
        if (direct && direct === myId) return true;
        if (typeof c === 'string') return c.trim() === myId || c.trim().toLowerCase() === myEmail;
        if (c && typeof c === 'object') {
          const oid = String(c.id || c.userId || c.ownerId || c.influencerAdminId || c.assignedInfluencerAdminId || '').trim();
          const oemail = String(c.email || '').trim().toLowerCase();
          return oid === myId || (!!myEmail && oemail === myEmail);
        }
        return false;
      };
      const events = allEvents.filter(ev => isMine(ev) || getAuthorizedInfluencerAdminIds(ev).includes(myId)).map(ev =>
        Object.assign({}, ev, { visibleToInfluencerAdmin: true, createdByCurrentInfluencerAdmin: isMine(ev), authorizedToCurrentInfluencerAdmin: getAuthorizedInfluencerAdminIds(ev).includes(myId) })
      );
      return sendJson(res, 200, { success:true, events });
    }

    // ── Admin/Sub-admin/Influencer Admin: create/update an event ──
    if (pathname === '/api/admin/events' && req.method === 'POST') {
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','subadmin','influencer_admin'].includes(authCtx.role)) return sendJson(res, 401, { success: false, error: 'Event management access only' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const id = String(data.id || '').trim() || 'evt-' + Date.now().toString(36);
      const name = String(data.name || '').trim();
      if (!name) return sendJson(res, 400, { success: false, error: 'Event name is required' });
      // Attach university info to new events
      const universityId = String(data.universityId || '').trim();
      const universityName = String(data.universityName || '').trim();
      let uniSlug = String(data.universitySlug || '').trim();
      if (!uniSlug && universityId) {
        const uni = await findUniversityById(universityId);
        if (uni) uniSlug = uni.slug || uni.id;
      }
      const existingEvents = await readEvents();
      const existingEvent = existingEvents.find(e => String(e.id) === id);
      if (authCtx.role === 'influencer_admin' && existingEvent) {
        if (!influencerAdminOwnsEvent(authCtx, existingEvent)) return sendJson(res, 403, { success:false, error:'You can only edit events you created.' });
      }
      const isInfluencerAdminEdit = authCtx.role === 'influencer_admin' && !!existingEvent;
      // Auto-authorize the Influencer Admin who created/updates the event to that
      // event, so it is no longer an un-authorized event they cannot manage.
      let authorizedAdminIds = getAuthorizedInfluencerAdminIds(existingEvent);
      if (isInfluencerAdminEdit) {
        // Editing: keep the admin already authorized, but ensure the current
        // admin is authorized (idempotent re-authorize).
        const myId = String(authCtx.user?.id || authCtx.userId || '').trim();
        if (myId && !authorizedAdminIds.includes(myId)) authorizedAdminIds.push(myId);
      } else if (authCtx.role === 'influencer_admin') {
        // Creating: the creator becomes the event's admin automatically.
        const myId = String(authCtx.user?.id || authCtx.userId || '').trim();
        const myEmail = String(authCtx.user?.email || '').trim().toLowerCase();
        if (myId) authorizedAdminIds.push(myId);
        if (myEmail && !authorizedAdminIds.includes(myEmail)) authorizedAdminIds.push(myEmail);
      }
      const imageUrl = String(data.image || '').trim();
      const isInlineImage = /^data:image\/(?:png|jpe?g|gif|webp);base64,/.test(imageUrl);
      if ((!isInlineImage && imageUrl.length > 2000) || !isSafeImageUrl(imageUrl)) {
        return sendJson(res, 400, { success: false, error: 'Please provide a valid event image URL.' });
      }
      const rawTags = Array.isArray(data.tags) ? data.tags : [];
      if (rawTags.length > 20 || rawTags.some(t => String(t == null ? '' : t).length > 80)) {
        return sendJson(res, 400, { success: false, error: 'Event tags are too long or too many.' });
      }
      const ev = {
        id: id,
        name: name,
        category: String(data.category || '').trim() || 'General',
        price: parseFloat(data.price) || 0,
        bonusPrice: parseFloat(data.bonusPrice) || 0,
        vipPrice: parseFloat(data.vipPrice) || 0,
        bonusVipPrice: parseFloat(data.bonusVipPrice) || 0,
        vvipPrice: parseFloat(data.vvipPrice) || 0,
        bonusVvipPrice: parseFloat(data.bonusVvipPrice) || 0,
        tablePrice: parseFloat(data.tablePrice) || 0,
        bonusTablePrice: parseFloat(data.bonusTablePrice) || 0,
        regularTicketLimit: Math.max(0, parseInt(data.regularTicketLimit) || 0),
        vipTicketLimit: Math.max(0, parseInt(data.vipTicketLimit) || 0),
        vvipTicketLimit: Math.max(0, parseInt(data.vvipTicketLimit) || 0),
        tableTicketLimit: Math.max(0, parseInt(data.tableTicketLimit) || 0),
        includedRegular: String(data.includedRegular || '').trim(),
        includedVip: String(data.includedVip || '').trim(),
        includedVVIP: String(data.includedVVIP || '').trim(),
        includedTable: String(data.includedTable || '').trim(),
        date: String(data.date || '').trim(),
        time: String(data.time || '').trim(),
        venue: String(data.venue || '').trim(),
        description: String(data.description || '').trim(),
        tags: data.tags || [],
        image: imageUrl,
        icon: data.icon || '🎟️',
        featured: !!data.featured,
        archived: isInfluencerAdminEdit ? !!existingEvent.archived : !!data.archived,
        authorizedInfluencerAdminIds: authorizedAdminIds,
        seats: data.seats || '—',
        universityId: universityId,
        universityName: universityName,
        universitySlug: uniSlug,
        createdAt: isInfluencerAdminEdit ? (existingEvent.createdAt || new Date().toISOString()) : new Date().toISOString(),
        createdBy: isInfluencerAdminEdit ? existingEvent.createdBy : { role: authCtx.role, id: authCtx.user?.id || authCtx.id || null, name: authCtx.user?.name || authCtx.name || null, email: authCtx.user?.email || authCtx.email || null }
      };
            try {
        await addEvent(ev);
        console.log('✓ Event created:', ev.id, '—', ev.name, '(', ev.universityName, ')');
        return sendJson(res, 200, { success: true, event: ev });
      } catch (e) {
        console.error('✗ Error creating/updating event:', e);
        // Never expose database/filesystem/provider error details to clients.
        return sendJson(res, 500, { success: false, error: 'Failed to save event. Please try again.' });
      }
    }

    // ── Archive/unarchive event: admin, sub-admin, or influencer admin ──
    if (pathname === '/api/admin/events/archive' && req.method === 'POST') {
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','subadmin','influencer_admin'].includes(authCtx.role)) {
        return sendJson(res, 403, { success:false, error:'Only Admin, Sub-admin, or Influencer Admin can archive events' });
      }
      const body = await readBody(req);
      let data = {}; try { data = JSON.parse(body || '{}'); } catch(e) {}
      const eventId = String(data.eventId || '').trim();
      const archived = data.archived !== false;
      if (!eventId) return sendJson(res,400,{success:false,error:'Missing eventId'});
      const events = await readEvents();
      const idx = events.findIndex(e => String(e.id) === eventId);
      if (idx < 0) return sendJson(res,404,{success:false,error:'Event not found'});
      if (authCtx.role === 'influencer_admin') {
        if (!influencerAdminOwnsEvent(authCtx, events[idx])) return sendJson(res,403,{success:false,error:'You can only archive events you created.'});
      }
      events[idx] = Object.assign({}, events[idx], { archived: archived, archivedAt: archived ? new Date().toISOString() : null, archivedBy: archived ? authCtx.role : null });
      await writeEvents(events);
      return sendJson(res,200,{success:true,event:events[idx]});
    }

    // ── Main Admin only: delete an event ──
    // Sub-admins, Influencer Admins, Check-in Staff and Influencers may never delete events.
    if (pathname === '/api/admin/events' && req.method === 'DELETE') {
      if (!isAdminAuthorized(req)) return sendJson(res, 403, { success: false, error: 'Only the Main Admin can delete events' });
      const eventId = String(url.searchParams.get('eventId') || '').trim();
      if (!eventId) return sendJson(res, 400, { success: false, error: 'Missing eventId' });
      
      const events = await readEvents();
      const ev = events.find(e => e.id === eventId);
      const deleted = await deleteEvent(eventId);
      
      let ordersDeleted = 0;
      if (deleted && ev && ev.name) {
        const orders = await readOrders();
        const remaining = orders.filter(o => o.eventName !== ev.name);
        ordersDeleted = orders.length - remaining.length;
        if (ordersDeleted > 0) {
          await writeOrders(remaining);
          console.log('Deleted event "' + ev.name + '" — removed ' + ordersDeleted + ' related order(s).');
        }
      }
      return sendJson(res, 200, { success: deleted, ordersDeleted: ordersDeleted });
    }

    // ── Public universities list ──
    if (pathname === '/api/universities' && req.method === 'GET') {
      const list = await readUniversities();
      return sendJson(res, 200, { success: true, universities: list });
    }

    // ── Admin: create/update a university ──
    if (pathname === '/api/admin/universities' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const id = String(data.id || '').trim() || 'uni-' + Date.now().toString(36);
      const name = String(data.name || '').trim();
      if (!name) return sendJson(res, 400, { success: false, error: 'University name is required' });
      const slug = String(data.slug || '').trim() || id;
      const u = {
        id: id,
        name: name,
        slug: slug,
        location: String(data.location || '').trim(),
        state: String(data.state || '').trim(),
        categories: Array.isArray(data.categories) ? data.categories : ['General'],
        contactEmail: String(data.contactEmail || '').trim(),
        createdAt: new Date().toISOString()
      };
      await addUniversity(u);
      return sendJson(res, 200, { success: true, university: u });
    }

    // ── Admin: delete a university ──
if (pathname === '/api/admin/universities' && req.method === 'DELETE') {
      if (!isAdminAuthorized(req)) return sendJson(res, 403, { success: false, error: 'Only the Main Admin can delete universities' });
      const uniId = String(url.searchParams.get('uniId') || url.searchParams.get('universityId') || '').trim();
      if (!uniId) return sendJson(res, 400, { success: false, error: 'Missing uniId' });
      // Capture the university to derive its id/slug so we can remove its events too.
      const unis = await readUniversities();
      const uni = unis.find(function(u) { return u.id === uniId || u.slug === uniId; });
      let eventsDeleted = 0;
      if (uni) {
        const events = await readEvents();
        const before = events.length;
        const remaining = events.filter(function(e) { return e.universityId !== uni.id && e.universityId !== uni.slug; });
        eventsDeleted = before - remaining.length;
        if (eventsDeleted > 0) await writeEvents(remaining);
      }
      const deleted = await deleteUniversity(uniId);
      return sendJson(res, 200, { success: deleted, eventsDeleted: eventsDeleted });
    }

    // ── Subscribe to event notifications ──
    if (pathname === '/api/subscribe' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const universityId = String(data.universityId || '').trim();
      const name = String(data.name || '').trim() || email.split('@')[0];
      if (!email || !universityId) {
        return sendJson(res, 400, { success: false, error: 'Email and university are required' });
      }
      const existing = await findSubscriber(email, universityId);
      if (existing) {
        return sendJson(res, 200, { success: true, message: 'Already subscribed' });
      }
      const sub = {
        id: 'SUB-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        email: email,
        name: name,
        universityId: universityId,
        universityName: String(data.universityName || '').trim(),
        source: data.source || 'button',
        createdAt: new Date().toISOString()
      };
      await addSubscriber(sub);
      return sendJson(res, 200, { success: true, subscriber: sub });
    }

    // ── Unsubscribe from event notifications ──
    if (pathname === '/api/unsubscribe' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const universityId = String(data.universityId || '').trim();
      if (!email) return sendJson(res, 400, { success: false, error: 'Email is required' });
      const removed = await removeSubscriber(email, universityId || undefined);
      return sendJson(res, 200, { success: true, removed: removed });
    }

// ── Admin: list subscribers ──
    if (pathname === '/api/admin/subscribers' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const subs = await readSubscribers();
      const uniFilter = String(url.searchParams.get('universityId') || '').trim();
      const filtered = uniFilter ? subs.filter(s => s.universityId === uniFilter) : subs;
      return sendJson(res, 200, { success: true, subscribers: filtered });
    }

    // ── Admin: remove a subscriber (by email, optionally scoped to a university) ──
    if (pathname === '/api/admin/subscribers' && req.method === 'DELETE') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const universityId = String(data.universityId || '').trim();
      if (!email) return sendJson(res, 400, { success: false, error: 'Email is required' });
      const removed = await removeSubscriber(email, universityId || undefined);
      return sendJson(res, 200, { success: true, removed: removed });
    }

    // ── Admin: notify subscribers about a specific event ──
    if (pathname === '/api/admin/events/notify' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const eventId = String(data.eventId || '').trim();
      if (!eventId) return sendJson(res, 400, { success: false, error: 'Missing eventId' });
const events = await readEvents();
      const ev = events.find(e => e.id === eventId);
      if (!ev) return sendJson(res, 404, { success: false, error: 'Event not found' });
      const notified = await notifySubscribersAboutEvent(ev);
      return sendJson(res, 200, { success: true, message: 'Subscribers notified', notified: notified });
    }

    // ── Static files ──
    let urlPath = decodeURIComponent(pathname);
    if (urlPath === '/') urlPath = '/index.html';

    // Canonical referral landing page. Older links may still contain
    // /referral-events.html; redirect them server-side so existing links,
    // browser bookmarks, and cached dashboard links all converge on Events.
    if (urlPath.toLowerCase() === '/referral-events.html') {
      const ref = String(url.searchParams.get('ref') || '').trim().toUpperCase();
      const target = '/events.html' + (ref ? '?ref=' + encodeURIComponent(ref) : '');
      res.writeHead(301, {
        'Location': target,
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'text/plain; charset=utf-8'
      });
      res.end('Moved permanently to ' + target);
      return;
    }

    const filePath = path.resolve(PUBLIC_DIR, '.' + urlPath);
    // Shortlink referral handler: /r/REF-XXXX  (optionally ?to=/path)
    if (urlPath && urlPath.toLowerCase().startsWith('/r/')) {
      let rawCode = '';
      try { rawCode = decodeURIComponent(urlPath.slice(3) || '').trim(); } catch (e) { rawCode = ''; }
      const code = String(rawCode || '').toUpperCase().slice(0, 100);
      const requestedTo = String(url.searchParams.get('to') || '/');
      const safeTo = requestedTo.startsWith('/') && !requestedTo.startsWith('//') && !/[\x00-\x1F\x7F]/.test(requestedTo)
        ? requestedTo.slice(0, 500) : '/';
      const codeJs = JSON.stringify(code);
      const toJs = JSON.stringify(safeTo);
      const safeToHtml = safeTo.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redirecting…</title></head><body><script>try{sessionStorage.setItem("referralCode", ' + codeJs + ');localStorage.setItem("unn_referral_code", ' + codeJs + ');}catch(e){}window.location.replace(' + toJs + ');</script><noscript><meta http-equiv="refresh" content="0;url=' + safeToHtml + '"></noscript></body></html>';
      res.writeHead(200, withSecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }));
      res.end(html);
      return;
    }
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // PUBLIC_DIR is the project root, so without an explicit deny-list the
    // static handler happily served server.js, package.json and — when it was
    // present — .env, handing every secret in the deployment to the browser.
    // Anything that is not part of the built site is refused here.
    if (isBlockedStaticPath(urlPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        const indexPath = path.join(PUBLIC_DIR, urlPath, 'index.html');
        fs.stat(indexPath, (err2, stats2) => {
          if (err2 || !stats2.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="refresh" content="3"><title>Unisocials — Waking up...</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a1a0a;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#e0e0e0;text-align:center;padding:24px}.card{background:linear-gradient(145deg,#0f2a0f,#1a3a1a);border:1px solid #2a5a2a;border-radius:24px;padding:48px 40px;max-width:480px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.6)}.logo{font-size:28px;font-weight:700;margin-bottom:24px}.logo span{color:#ffd700}.icon{font-size:56px;margin-bottom:16px}h1{font-size:22px;font-weight:600;margin-bottom:12px;color:#fff}p{font-size:15px;line-height:1.6;color:#a0c0a0;margin-bottom:24px}.spinner{display:inline-block;width:36px;height:36px;border:3px solid #2a5a2a;border-top-color:#ffd700;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:20px}@keyframes spin{to{transform:rotate(360deg)}}.btn{display:inline-block;background:#ffd700;color:#0a1a0a;font-weight:600;font-size:15px;padding:12px 32px;border-radius:40px;text-decoration:none;transition:background .2s}.btn:hover{background:#ffe44d}.hint{font-size:13px;color:#608060;margin-top:16px}</style>
</head><body><div class="card"><div class="logo">Uni<span>socials</span></div><div class="icon">⚡</div><div class="spinner"></div><h1>Waking up the server…</h1><p>This page is hosted on a free service that sleeps after inactivity.<br>It should be ready in a moment.</p><a href="/" class="btn" onclick="location.reload()">⟳ Refresh Now</a><p class="hint">Auto-refreshing every 3 seconds &mdash; or tap the button above.</p></div></body></html>`);
            return;
          }
          const ext = path.extname(indexPath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const cacheControl = ext === '.html' ? 'no-cache, max-age=0, must-revalidate' : 'public, max-age=3600';
          const headers = withSecurityHeaders({ 'Content-Type': contentType, 'Cache-Control': cacheControl }, req);
          const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
          if (acceptsGzip && ['.html', '.css', '.js', '.json', '.svg', '.txt'].includes(ext)) {
            headers['Content-Encoding'] = 'gzip';
            headers['Vary'] = 'Accept-Encoding';
            res.writeHead(200, headers);
            fs.createReadStream(indexPath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
          } else {
            res.writeHead(200, headers);
            fs.createReadStream(indexPath).pipe(res);
          }
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const cacheControl = ext === '.html' ? 'no-cache, max-age=0, must-revalidate' : 'public, max-age=3600';
      const headers = withSecurityHeaders({ 'Content-Type': contentType, 'Cache-Control': cacheControl }, req);
      const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
      if (acceptsGzip && ['.html', '.css', '.js', '.json', '.svg', '.txt'].includes(ext)) {
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      } else {
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
      }
    });
  } catch (err) {
    console.error('Request handler error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { success: false, error: 'Internal server error' });
    } else {
      try { res.end(); } catch (e) {}
    }
  }
});

// Global error handler for uncaught exceptions in async request handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    // The real inbox on file, when there is one. Staff dashboards show it so an
    // account can be given its payout notification address.
    contactEmail: user.contactEmail || '',
    phone: user.phone,
    role: ['influencer_admin','influencer-admin','influencerAdmin'].includes(String(user.role)) ? 'influencer_admin' : (user.role || 'buyer'),
    createdAt: user.createdAt,
    archived: user.archived === true
  };
}

async function removeDemoDataAndKeepSiteCreatedEvents() {
  // Keep all existing real events. Only remove the known demo Music Festival
  // event and its demo order. Do NOT classify events as seed/demo merely because
  // they lack createdBy: existing events such as TikTok Fest must remain visible.
  const normalize = v => String(v ?? '').trim().toLowerCase();
  const DEMO_EVENT_IDS = new Set(['campus-music-festival', 'music-festival', 'unn-music-festival']);
  const DEMO_EVENT_NAMES = new Set(['campus music festival', 'music festival', 'unn music festival']);
  const DEMO_ORDER_IDS = new Set(['unn-msc60k06-ewot']);
  try {
    if (usePg) {
      await db.query(`
        DELETE FROM orders
        WHERE lower(trim(COALESCE(data->>'id',''))) IN (${Array.from(DEMO_ORDER_IDS).map(x => `'${x}'`).join(',')})
           OR lower(trim(COALESCE(data->>'orderId',''))) IN (${Array.from(DEMO_ORDER_IDS).map(x => `'${x}'`).join(',')})
           OR lower(trim(COALESCE(data->>'eventId',''))) IN (${Array.from(DEMO_EVENT_IDS).map(x => `'${x}'`).join(',')})
           OR lower(trim(COALESCE(data->>'eventName',''))) IN (${Array.from(DEMO_EVENT_NAMES).map(x => `'${x}'`).join(',')})
      `);
      await db.query(`
        DELETE FROM events
        WHERE lower(trim(COALESCE(data->>'id',''))) IN (${Array.from(DEMO_EVENT_IDS).map(x => `'${x}'`).join(',')})
           OR lower(trim(COALESCE(data->>'name',''))) IN (${Array.from(DEMO_EVENT_NAMES).map(x => `'${x}'`).join(',')})
      `);
      return;
    }

    const events = await readEvents();
    const keepEvents = events.filter(ev => {
      const id = normalize(ev && ev.id);
      const name = normalize(ev && ev.name);
      return !DEMO_EVENT_IDS.has(id) && !DEMO_EVENT_NAMES.has(name);
    });
    if (keepEvents.length !== events.length) await writeEvents(keepEvents);

    const orders = await readOrders();
    const cleanOrders = orders.filter(o => {
      const id = normalize(o && (o.orderId || o.id));
      const eventId = normalize(o && o.eventId);
      const eventName = normalize(o && o.eventName);
      return !DEMO_ORDER_IDS.has(id) && !DEMO_EVENT_IDS.has(eventId) && !DEMO_EVENT_NAMES.has(eventName);
    });
    if (cleanOrders.length !== orders.length) await writeOrders(cleanOrders);
  } catch (e) {
    console.warn('Demo Music Festival cleanup failed:', e.message);
  }
}

server.listen(PORT, () => {
  console.log('Unisocials server running at http://localhost:' + PORT);
  initStorage().then(async () => {
    await migrateInfluencerAssignments();
    await migrateInfluencerReferralLinks();
    await removeDemoDataAndKeepSiteCreatedEvents();
    console.log('Unisocials storage initialization complete.');
  }).catch((err) => {
    console.error('Storage initialization failed:', err.message);
  });
});

