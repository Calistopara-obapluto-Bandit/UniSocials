/*
UNN Socials — Node.js server
----------------------------------
- Serves the static site + dynamic config.js
- Persistent data storage:
    • PostgreSQL if DATABASE_URL is set (recommended for Render — survives restarts/redeploys)
    • JSON files in ./data otherwise (persists on local disk)
- Flutterwave-only checkout with server-authoritative verification:
    order is created PENDING → Flutterwave confirms → /api/verify-payment or webhook
    checks amount+currency against the order BEFORE issuing tickets.
- One unique ticket code per ticket purchased (qty = N → N QR tickets).
- Buyer accounts (register/login) so tickets are stored and don't require refresh.
- Admin gate scan endpoint for check-in.
*/

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');

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
      db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await db.query(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      usePg = true;
      console.log('Storage: PostgreSQL connected.');
      return;
    } catch (e) {
      console.warn('PostgreSQL unavailable, falling back to JSON files:', e.message);
      db = null;
      usePg = false;
    }
  }
  console.log('Storage: JSON files in ./data (set DATABASE_URL to use PostgreSQL).');
}

/* ── Orders ── */
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
    await db.query('DELETE FROM orders');
    for (const o of orders) {
      await db.query('INSERT INTO orders (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [o.orderId, JSON.stringify(o)]);
    }
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
  const orders = await readOrders();
  orders.unshift(order);
  await writeOrders(orders);
}
async function patchOrder(orderId, patch) {
  const orders = await readOrders();
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx === -1) return null;
  orders[idx] = Object.assign({}, orders[idx], patch);
  await writeOrders(orders);
  return orders[idx];
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
    await db.query('DELETE FROM users');
    for (const u of users) {
      await db.query('INSERT INTO users (id, email, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = $3', [u.id, u.email, JSON.stringify(u)]);
    }
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
  const users = await readUsers();
  users.push(user);
  await writeUsers(users);
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
    await db.query('DELETE FROM sessions');
    for (const [token, userId] of Object.entries(sessions)) {
      await db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
    }
    return;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'sessions.json'), JSON.stringify(sessions, null, 2), 'utf8');
}
async function createSession(token, userId) {
  const sessions = await readSessions();
  sessions[token] = userId;
  await writeSessions(sessions);
}
async function getSessionUser(token) {
  if (!token) return null;
  const sessions = await readSessions();
  const userId = sessions[token];
  if (!userId) return null;
  return await findUserById(userId);
}
async function deleteSession(token) {
  const sessions = await readSessions();
  delete sessions[token];
  await writeSessions(sessions);
}
async function deleteUserSessions(userId) {
  const sessions = await readSessions();
  for (const [t, uid] of Object.entries(sessions)) {
    if (uid === userId) delete sessions[t];
  }
  await writeSessions(sessions);
}

// ────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────
const orderLog = [];
const orderLogLimit = 1000;

function randCode6() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
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
function isAdminAuthorized(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASSWORD !== undefined ? process.env.ADMIN_PASSWORD : defaults.ADMIN_PASSWORD;
  return !!token && token === expected;
}

// Default configuration values (overridden by environment variables on Render)
const defaults = {
  WHATSAPP_FLOAT_NUMBER: '2348122104576',
  WHATSAPP_ORDER_NUMBER: '2348122104576',
  ADMIN_PASSWORD: 'admin1234',
  FLUTTERWAVE_SECRET_KEY: 'FSTOU9su2xlF8UU8wU05kNvqEbI8v47S',
  FLUTTERWAVE_PUBLIC_KEY: 'FLWPUBK-30d580ee6aef13a294e26a8c1145dc58-X',
  FLUTTERWAVE_BANK_NAME: 'Flutterwave MfB (formerly ok mfb)',
  FLUTTERWAVE_ACCOUNT_NUMBER: '9707788756',
  FLUTTERWAVE_WEBHOOK_HASH: 'Soludo123@',
  SITE_URL: 'https://unisocials.onrender.com',
  CONTACT_EMAIL: 'support.sbiamautos@gmail.com',
  FORMSUBMIT_KEY: 'support.sbiamautos@gmail.com',
  REDIRECT_URL: 'https://unisocials.onrender.com/thank-you.html'
};

function getConfig() {
  const cfg = {};
  for (const [key, val] of Object.entries(defaults)) {
    // Never expose secret keys, passwords, or the webhook HMAC hash to the browser
    if (/SECRET|PRIVATE|PASSWORD|WEBHOOK/i.test(key)) continue;
    cfg[key] = process.env[key] !== undefined ? process.env[key] : val;
  }
  return cfg;
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

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { resolve(body); });
    req.on('error', () => { resolve(''); });
  });
}

// Verify a transaction reference against Flutterwave (server-side)
function verifyFlutterwave(txRef, expectedAmount, expectedCurrency) {
  return new Promise((resolve) => {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY !== undefined
      ? process.env.FLUTTERWAVE_SECRET_KEY
      : defaults.FLUTTERWAVE_SECRET_KEY;
    const apiPath = '/v3/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(txRef);
    const options = {
      hostname: 'api.flutterwave.com',
      port: 443,
      path: apiPath,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + secretKey, 'Content-Type': 'application/json' }
    };
    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', c => { data += c; });
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const t = json.data || {};
          const status = String(t.status || '');
          const amount = parseFloat(t.amount) || 0;
          const currency = String(t.currency || '');
          const verified = json.status === 'success' && (status === 'successful' || status === 'completed');

          // Strong verification: match amount & currency against the order
          const amountOk = !expectedAmount || Math.abs(amount - expectedAmount) < 1;
          const currencyOk = !expectedCurrency || currency === expectedCurrency;

          resolve({
            success: verified && amountOk && currencyOk,
            apiSuccess: verified,
            amount: amount,
            currency: currency,
            status: status,
            amountOk: amountOk,
            currencyOk: currencyOk
          });
        } catch (e) {
          resolve({ success: false, apiSuccess: false, error: 'Bad response' });
        }
      });
    });
    apiReq.on('error', () => {
      resolve({ success: false, apiSuccess: false, error: 'Network error' });
    });
    apiReq.end();
  });
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
// HTTP SERVER
// ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    // ── Dynamic config.js ──
    if (pathname === '/config.js') {
      const cfg = getConfig();
      const js = '/* Generated by server.js from environment variables */\nwindow.SITE_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n';
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(js);
      return;
    }

    // ── AUTH: Register ──
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim().toLowerCase();
      const phone = String(data.phone || '').trim();
      const password = String(data.password || '');

      if (!name || !email || !phone || password.length < 6) {
        return sendJson(res, 400, { success: false, error: 'Please provide name, email, phone and a password of at least 6 characters.' });
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
        createdAt: new Date().toISOString()
      };
      await addUser(user);
      const token = generateToken();
      await createSession(token, user.id);
      return sendJson(res, 200, { success: true, token: token, user: publicUser(user) });
    }

    // ── AUTH: Login ──
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      if (!email || !password) {
        return sendJson(res, 400, { success: false, error: 'Please enter your email and password.' });
      }
      const user = await findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { success: false, error: 'Invalid email or password.' });
      }
      const token = generateToken();
      await createSession(token, user.id);
      return sendJson(res, 200, { success: true, token: token, user: publicUser(user) });
    }

    // ── AUTH: Logout ──
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token) await deleteSession(token);
      return sendJson(res, 200, { success: true });
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

    // ── Create order (PENDING until payment is server-verified) ──
    if (pathname === '/api/orders' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}

      const orderId = String(data.orderId || '').trim();
      const eventName = String(data.eventName || '').trim();
      const eventDate = String(data.eventDate || '').trim();
      const eventVenue = String(data.eventVenue || '').trim();
      const qty = parseInt(data.qty) || 1;
      const amount = parseFloat(data.amount) || 0;
      const currency = String(data.currency || 'NGN');
      const buyerName = String(data.buyerName || '').trim();
      const buyerEmail = String(data.buyerEmail || '').trim().toLowerCase();
      const buyerPhone = String(data.buyerPhone || '').trim();
      const buyerFaculty = String(data.buyerFaculty || '').trim();

      if (!orderId || !eventName || !buyerName || !buyerEmail || !buyerPhone || amount <= 0) {
        return sendJson(res, 400, { success: false, error: 'Missing required order fields' });
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
        eventName: eventName,
        eventDate: eventDate,
        eventVenue: eventVenue,
        qty: qty,
        amount: amount,
        currency: currency,
        paymentMethod: 'flutterwave',      // Flutterwave is the only method
        buyerName: buyerName,
        buyerEmail: buyerEmail,
        buyerPhone: buyerPhone,
        buyerFaculty: buyerFaculty,
        userId: user ? user.id : null,
        createdAt: new Date().toISOString(),
        verifiedAt: null,
        notifyAdmin: true,
        seenByAdmin: false,
        ticketCodes: generateTicketCodes(qty),  // one code per ticket
        ticketCode: null
      };
      order.ticketCode = order.ticketCodes[0].code;
      await addOrder(order);
      return sendJson(res, 200, { success: true, order: order });
    }

    // ── Verify payment (server-authoritative) ──
    if (pathname === '/api/verify-payment' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const txRef = String(data.tx_ref || '').trim();
      if (!txRef) return sendJson(res, 400, { success: false, error: 'Missing tx_ref' });

      const order = await getOrder(txRef);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found for tx_ref' });

      const result = await verifyFlutterwave(txRef, parseFloat(order.amount), order.currency);

      if (result.success) {
        const updated = await patchOrder(txRef, verifyOrderTicketData(Object.assign({}, order)));
        console.log('Verified order:', txRef, 'amount:', result.amount, result.currency);
        return sendJson(res, 200, { success: true, order: updated });
      }

      return sendJson(res, 200, {
        success: false,
        error: result.amountOk && result.currencyOk ? 'Payment not verified yet' : 'Payment amount/currency mismatch',
        status: result.status,
        amountOk: result.amountOk,
        currencyOk: result.currencyOk,
        tx_ref: txRef
      });
    }

    // ── Flutterwave webhook (server-to-server) ──
    if (pathname === '/api/webhook/flutterwave' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}

      const signature = req.headers['x-flutterwave-signature'] || '';
      const webhookHash = process.env.FLUTTERWAVE_WEBHOOK_HASH !== undefined
        ? process.env.FLUTTERWAVE_WEBHOOK_HASH
        : defaults.FLUTTERWAVE_WEBHOOK_HASH;
      let validSignature = true;
      if (webhookHash) {
        const expected = crypto.createHmac('sha256', webhookHash).update(body).digest('hex');
        validSignature = expected === signature;
      }
      if (!validSignature) {
        return sendJson(res, 401, { success: false, error: 'Invalid signature' });
      }

      const txRef = String((data.txRef || (data.data && data.data.tx_ref) || ''));
      const eventType = String((data.event || data['event.type'] || ''));
      const status = String((data.data && data.data.status) || '');
      const webhookAmount = parseFloat((data.data && data.data.amount) || 0);
      const webhookCurrency = String((data.data && data.data.currency) || '');
      const isSuccess = eventType === 'charge.completed' && (status === 'successful' || status === 'completed');

      if (!txRef) return sendJson(res, 200, { success: false, error: 'Missing tx_ref' });

      const order = await getOrder(txRef);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found for tx_ref' });

      if (isSuccess && order.status !== 'verified') {
        // Verify amount/currency from webhook payload too
        const amountOk = !webhookAmount || Math.abs(webhookAmount - parseFloat(order.amount)) < 1;
        const currencyOk = !webhookCurrency || webhookCurrency === order.currency;
        if (amountOk && currencyOk) {
          await patchOrder(txRef, verifyOrderTicketData(Object.assign({}, order)));
          console.log('Webhook verified order:', txRef);
        } else {
          return sendJson(res, 200, { success: false, error: 'Amount/currency mismatch in webhook' });
        }
      }
      return sendJson(res, 200, { success: true, tx_ref: txRef });
    }

    // ── Public status lookup (pending page) ──
    if (pathname === '/api/orders/status') {
      const orderId = String(url.searchParams.get('orderId') || '').trim();
      if (!orderId) return sendJson(res, 400, { success: false, error: 'Missing orderId' });
      const order = await getOrder(orderId);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found' });
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
          ticketCodes: order.ticketCodes || [],
          ticketCode: order.ticketCode || null
        }
      });
    }

    // ── Buyer order lookup (Order ID + phone) ──
    if (pathname === '/api/orders/lookup' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const orderId = String(data.orderId || '').trim();
      const phone = String(data.phone || '').trim();
      if (!orderId || !phone) return sendJson(res, 400, { success: false, error: 'Missing orderId or phone' });

      const orders = await readOrders();
      const order = orders.find(o => o.orderId === orderId && o.buyerPhone === phone);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found. Check your Order ID and phone number.' });

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
          ticketCodes: order.ticketCodes || [],
          ticketCode: order.ticketCode || null
        }
      });
    }

    // ── Get ticket by orderId + code (protected, per-ticket) ──
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
          qty: order.qty,
          amount: order.amount,
          currency: order.currency,
          buyerName: order.buyerName,
          verifiedAt: order.verifiedAt
        }
      });
    }

    // ── Admin: scan ticket at gate (check-in) ──
    if (pathname === '/api/ticket/scan' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
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
          ticket: { eventName: order.eventName, ticketCode: entry.code, buyerName: order.buyerName, ticketIndex: idx + 1, totalTickets: codes.length }
        });
      }
      entry.used = true;
      entry.usedAt = new Date().toISOString();
      codes[idx] = entry;
      const updated = await patchOrder(orderId, { ticketCodes: codes });
      return sendJson(res, 200, {
        success: true,
        message: '✅ Check-in successful for ' + order.buyerName,
        ticket: { eventName: order.eventName, ticketCode: entry.code, buyerName: order.buyerName, ticketIndex: idx + 1, totalTickets: codes.length }
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
      const orders = await readOrders();
      return sendJson(res, 200, { success: true, unseenCount: unseenOrderCount(orders), orders: orders });
    }

    // ── Admin: unseen count ──
    if (pathname === '/api/admin/unseen-count' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      const orders = await readOrders();
      return sendJson(res, 200, { success: true, unseenCount: unseenOrderCount(orders) });
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
        const updated = await patchOrder(orderId, verifyOrderTicketData(Object.assign({}, order)));
        return sendJson(res, 200, { success: true, order: updated });
      }
      const updated = await patchOrder(orderId, { status: newStatus });
      return sendJson(res, 200, { success: true, order: updated });
    }

    // ── Static files ──
    let urlPath = decodeURIComponent(pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(PUBLIC_DIR, urlPath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        const indexPath = path.join(PUBLIC_DIR, urlPath, 'index.html');
        fs.stat(indexPath, (err2, stats2) => {
          if (err2 || !stats2.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="refresh" content="3"><title>UNN Socials — Waking up...</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a1a0a;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#e0e0e0;text-align:center;padding:24px}.card{background:linear-gradient(145deg,#0f2a0f,#1a3a1a);border:1px solid #2a5a2a;border-radius:24px;padding:48px 40px;max-width:480px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.6)}.logo{font-size:28px;font-weight:700;margin-bottom:24px}.logo span{color:#ffd700}.icon{font-size:56px;margin-bottom:16px}h1{font-size:22px;font-weight:600;margin-bottom:12px;color:#fff}p{font-size:15px;line-height:1.6;color:#a0c0a0;margin-bottom:24px}.spinner{display:inline-block;width:36px;height:36px;border:3px solid #2a5a2a;border-top-color:#ffd700;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:20px}@keyframes spin{to{transform:rotate(360deg)}}.btn{display:inline-block;background:#ffd700;color:#0a1a0a;font-weight:600;font-size:15px;padding:12px 32px;border-radius:40px;text-decoration:none;transition:background .2s}.btn:hover{background:#ffe44d}.hint{font-size:13px;color:#608060;margin-top:16px}</style>
</head><body><div class="card"><div class="logo">UNN <span>Socials</span></div><div class="icon">⚡</div><div class="spinner"></div><h1>Waking up the server…</h1><p>This page is hosted on a free service that sleeps after inactivity.<br>It should be ready in a moment.</p><a href="/" class="btn" onclick="location.reload()">⟳ Refresh Now</a><p class="hint">Auto-refreshing every 3 seconds &mdash; or tap the button above.</p></div></body></html>`);
            return;
          }
          const ext = path.extname(indexPath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(indexPath).pipe(res);
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (err) {
    console.error('Request error:', err.message);
    if (!res.headersSent) sendJson(res, 500, { success: false, error: 'Server error' });
    else res.end();
  }
});

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt
  };
}

initStorage().then(() => {
  server.listen(PORT, () => {
    console.log('UNN Socials server running at http://localhost:' + PORT);
  });
});

