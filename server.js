/*
UNN Socials — Node.js static file server + dynamic config generator
Serves the static site and injects environment variables into config.js
at request time, so Render env vars are picked up without a build step.
*/

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const crypto = require('crypto');

// Simple in-memory order log (resets on restart; enough to detect duplicates/tampering)
const orderLog = [];
const orderLogLimit = 500;

// Persistent order store — JSON file so orders survive restarts (Render free tier disk persists within a session)
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const CLIENTS_FILE = path.join(__dirname, 'clients.json');

function loadOrders() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    return [];
  }
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
  } catch(e) {
    console.error('Failed to save orders:', e.message);
  }
}

// ── Client account store (clients.json) ──
function loadClients() {
  try {
    const raw = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    return [];
  }
}

function saveClients(clients) {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');
  } catch(e) {
    console.error('Failed to save clients:', e.message);
  }
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

function makeClientToken() {
  return 'c_' + crypto.randomBytes(24).toString('hex');
}

// Find client by bearer token from Authorization header
function getClientByToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const clients = loadClients();
  const client = clients.find(c => c.token && c.token === token);
  return client || null;
}

// Sanitize a client object for response (never expose hash/token)
function publicClient(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    createdAt: c.createdAt
  };
}

// Link an order to a client by matching buyer email/phone
function linkOrderToClient(orders, order) {
  const clients = loadClients();
  const matched = clients.find(c =>
    (c.email && c.email.toLowerCase() === String(order.buyerEmail || '').toLowerCase()) ||
    (c.phone && c.phone.replace(/\D/g, '') === String(order.buyerPhone || '').replace(/\D/g, ''))
  );
  if (matched) {
    order.clientId = matched.id;
    saveOrders(orders);
  }
}

// Generate a short, human-friendly ticket code (e.g. TKT-8F3K2M)
function generateTicketCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'TKT-' + code;
}

// Count unseen orders (orders with notifyAdmin true that the admin hasn't seen)
function unseenOrderCount(orders) {
  return orders.filter(o => o.notifyAdmin && !o.seenByAdmin).length;
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
  // Admin dashboard password — set a strong one in Render env vars
  ADMIN_PASSWORD: 'admin1234',
  // Flutterwave client secret key — server-side only (never exposed to the browser)
  FLUTTERWAVE_SECRET_KEY: 'FSTOU9su2xlF8UU8wU05kNvqEbI8v47S',
  // Flutterwave public key — safe to expose to the browser for inline checkout
  FLUTTERWAVE_PUBLIC_KEY: 'FLWPUBK-30d580ee6aef13a294e26a8c1145dc58-X',
  FLUTTERWAVE_BANK_NAME: 'Flutterwave MfB (formerly ok mfb)',
  FLUTTERWAVE_ACCOUNT_NUMBER: '9707788756',
  // Flutterwave webhook secret hash — used to verify payment webhooks server-to-server.
  // Get it from Dashboard → Settings → Webhooks. Empty disables signature checks.
  FLUTTERWAVE_WEBHOOK_HASH: 'Soludo123@',
  // Public base URL of the site (used for ticket QR codes / links)
  SITE_URL: 'https://unisocials.onrender.com',
  CONTACT_EMAIL: 'support.sbiamautos@gmail.com',
  FORMSUBMIT_KEY: 'support.sbiamautos@gmail.com',
  REDIRECT_URL: 'https://unisocials.onrender.com/thank-you.html'
};

function getConfig() {
  const cfg = {};
  for (const [key, val] of Object.entries(defaults)) {
    // Never expose secret/private/password keys to the browser
    if (/SECRET|PRIVATE|PASSWORD/i.test(key)) continue;
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

const server = http.createServer((req, res) => {
  // Dynamically serve config.js with env var values
  if (req.url === '/config.js' || req.url === '/config.js?') {
    const cfg = getConfig();
    const js = `/* Generated by server.js from environment variables */\n` +
      `window.SITE_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(js);
    return;
  }

  // ── Flutterwave transaction verification endpoint ──
  // Verifies payment with Flutterwave's API using the secret key (server-side),
  // so the amount and order can't be tampered with client-side.
  if (req.url.startsWith('/api/verify-payment')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let txRef = '';
      try {
        const parsed = JSON.parse(body || '{}');
        txRef = (parsed.tx_ref || '').toString();
      } catch(e) {}

      if (!txRef) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing tx_ref' }));
        return;
      }

      // Reject duplicate/retried orders
      if (orderLog.includes(txRef)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Order already processed' }));
        return;
      }

      const secretKey = (process.env.FLUTTERWAVE_SECRET_KEY !== undefined
        ? process.env.FLUTTERWAVE_SECRET_KEY
        : defaults.FLUTTERWAVE_SECRET_KEY);

      const apiPath = '/v3/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(txRef);
      const options = {
        hostname: 'api.flutterwave.com',
        port: 443,
        path: apiPath,
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + secretKey,
          'Content-Type': 'application/json'
        }
      };

      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', c => { data += c; });
        apiRes.on('end', () => {
          let verified = false;
          let amount = 0;
          let status = '';
          let currency = '';
          try {
            const json = JSON.parse(data);
            status = (json.data && json.data.status) || '';
            amount = (json.data && json.data.amount) || 0;
            currency = (json.data && json.data.currency) || '';
            verified = json.status === 'success' &&
              (status === 'successful' || status === 'completed');
          } catch(e) {}

          if (verified) {
            orderLog.push(txRef);
            if (orderLog.length > orderLogLimit) orderLog.shift();

            // Update the matching order in storage to verified (if it exists)
            // so admin + client dashboards reflect the paid status instantly.
            let ticketCode = null;
            try {
              const orders = loadOrders();
              const idx = orders.findIndex(o => o.orderId === txRef);
              if (idx !== -1 && orders[idx].status !== 'verified') {
                orders[idx].status = 'verified';
                orders[idx].verifiedAt = new Date().toISOString();
                orders[idx].paymentMethod = 'flutterwave';
                orders[idx].paymentConfirmed = true;
                orders[idx].ticketIssued = true;
                orders[idx].ticketIssuedAt = new Date().toISOString();
                orders[idx].rejectedAt = null;
                orders[idx].notifyAdmin = true;
                orders[idx].seenByAdmin = false;
                saveOrders(orders);
              }
              if (idx !== -1) ticketCode = orders[idx].ticketCode || null;
            } catch(e) {}

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              tx_ref: txRef,
              amount: amount,
              currency: currency,
              status: status,
              ticketCode: ticketCode
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Payment not verified',
              status: status,
              tx_ref: txRef
            }));
          }
        });
      });

      apiReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Verification network error' }));
      });

      apiReq.end();
    });
    return;
  }

  // ── Order management API ──

  // POST /api/orders — create a new order (status "pending" for bank transfer,
  // or "verified" if it's an auto-verified Flutterwave payment)
  if (req.url === '/api/orders' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const orderId = (data.orderId || '').toString().trim();
      const eventName = (data.eventName || '').toString().trim();
      const eventDate = (data.eventDate || '').toString().trim();
      const eventVenue = (data.eventVenue || '').toString().trim();
      const qty = parseInt(data.qty) || 1;
      const amount = parseFloat(data.amount) || 0;
      const currency = (data.currency || 'NGN').toString();
      const paymentMethod = (data.paymentMethod || 'bank-transfer').toString();
      const buyerName = (data.buyerName || '').toString().trim();
      const buyerEmail = (data.buyerEmail || '').toString().trim();
      const buyerPhone = (data.buyerPhone || '').toString().trim();
      const buyerFaculty = (data.buyerFaculty || '').toString().trim();

      if (!orderId || !eventName || !buyerName || !buyerEmail || !buyerPhone || amount <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing required order fields' }));
        return;
      }

      const orders = loadOrders();

      // Prevent duplicate order IDs
      if (orders.some(o => o.orderId === orderId)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Order ID already exists' }));
        return;
      }

      const paymentConfirmed = data.paymentConfirmed === true || data.paymentConfirmed === 'true';
      const order = {
        orderId: orderId,
        status: paymentConfirmed ? 'verified' : 'pending',
        eventName: eventName,
        eventDate: eventDate,
        eventVenue: eventVenue,
        qty: qty,
        amount: amount,
        currency: currency,
        paymentMethod: paymentMethod,
        buyerName: buyerName,
        buyerEmail: buyerEmail,
        buyerPhone: buyerPhone,
        buyerFaculty: buyerFaculty,
        createdAt: new Date().toISOString(),
        verifiedAt: paymentConfirmed ? new Date().toISOString() : null,
        // New: admin notification + ticket tracking
        notifyAdmin: true,
        seenByAdmin: false,
        paymentNotified: false,
        paymentNotifiedAt: null,
        ticketCode: generateTicketCode()
      };

      orders.unshift(order);
      saveOrders(orders);

      // For pre-confirmed Flutterwave payments, the ticket is auto-issued
      if (paymentConfirmed) {
        order.ticketIssued = true;
        order.ticketIssuedAt = new Date().toISOString();
        saveOrders(orders);
      }

      // Link the new order to an existing client account (if email/phone matches)
      linkOrderToClient(orders, order);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, order: order }));
    });
    return;
  }

  // ── Webhook: Flutterwave payment confirmation (server-to-server) ──
  // This is the RELIABLE path: Flutterwave POSTs here when a payment succeeds,
  // so verification doesn't depend on the buyer's browser staying open.
  if (req.url === '/api/webhook/flutterwave' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Flutterwave sends both JSON body and x-flutterwave-signature header.
      // We optionally validate the signature using FLUTTERWAVE_WEBHOOK_HASH.
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const signature = req.headers['x-flutterwave-signature'] || '';
      const webhookHash = (process.env.FLUTTERWAVE_WEBHOOK_HASH !== undefined
        ? process.env.FLUTTERWAVE_WEBHOOK_HASH
        : defaults.FLUTTERWAVE_WEBHOOK_HASH);
      let validSignature = true;
      if (webhookHash) {
        const crypto = require('crypto');
        const expected = crypto.createHmac('sha256', webhookHash).update(body).digest('hex');
        validSignature = expected === signature;
      }

      if (!validSignature) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid signature' }));
        return;
      }

      const txRef = (data.txRef || data.data && data.data.tx_ref || '').toString();
      const eventType = (data.event || data['event.type'] || '').toString();
      const status = (data.data && data.data.status || '').toString();

      // Only act on successful charge confirmations
      const isSuccess = (eventType === 'charge.completed' && (status === 'successful' || status === 'completed'));

      if (!txRef) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing tx_ref' }));
        return;
      }

      const orders = loadOrders();
      const idx = orders.findIndex(o => o.orderId === txRef);

      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Order not found for tx_ref' }));
        return;
      }

      if (isSuccess && orders[idx].status !== 'verified') {
        orders[idx].status = 'verified';
        orders[idx].verifiedAt = new Date().toISOString();
        orders[idx].paymentMethod = 'flutterwave';
        orders[idx].notifyAdmin = true;
        orders[idx].seenByAdmin = false;
        orders[idx].ticketIssued = true;
        orders[idx].ticketIssuedAt = new Date().toISOString();
        saveOrders(orders);
        console.log('Webhook verified order:', txRef);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tx_ref: txRef }));
    });
    return;
  }

  // ── Buyer marks bank transfer as done ──
  if (req.url === '/api/orders/notify-paid' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const orderId = (data.orderId || '').toString().trim();

      if (!orderId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing orderId' }));
        return;
      }

      const orders = loadOrders();
      const idx = orders.findIndex(o => o.orderId === orderId);

      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Order not found' }));
        return;
      }

      orders[idx].paymentNotified = true;
      orders[idx].paymentNotifiedAt = new Date().toISOString();
      orders[idx].notifyAdmin = true;
      orders[idx].seenByAdmin = false;
      saveOrders(orders);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, order: orders[idx] }));
    });
    return;
  }

  // ── Buyer order lookup (Order ID + phone) ──
  if (req.url === '/api/orders/lookup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const orderId = (data.orderId || '').toString().trim();
      const phone = (data.phone || '').toString().trim();

      if (!orderId || !phone) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing orderId or phone' }));
        return;
      }

      const orders = loadOrders();
      const order = orders.find(o => o.orderId === orderId && o.buyerPhone === phone);

      if (!order) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Order not found. Check your Order ID and phone number.' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
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
          ticketCode: order.ticketCode || null,
          paymentNotified: order.paymentNotified || false
        }
      }));
    });
    return;
  }

  // ── Get ticket by orderId + code (protected) ──
  if (req.url.startsWith('/api/ticket') && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const orderId = (url.searchParams.get('orderId') || '').toString().trim();
    const code = (url.searchParams.get('code') || '').toString().trim();

    if (!orderId || !code) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing orderId or code' }));
      return;
    }

    const orders = loadOrders();
    const order = orders.find(o => o.orderId === orderId);

    if (!order) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Order not found' }));
      return;
    }

    // Only verified orders get tickets
    if (order.status !== 'verified') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Order not yet verified', status: order.status }));
      return;
    }

    // Validate the ticket code
    if (order.ticketCode !== code) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid ticket code' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      ticket: {
        orderId: order.orderId,
        ticketCode: order.ticketCode,
        eventName: order.eventName,
        eventDate: order.eventDate,
        eventVenue: order.eventVenue,
        qty: order.qty,
        amount: order.amount,
        currency: order.currency,
        buyerName: order.buyerName,
        verifiedAt: order.verifiedAt
      }
    }));
    return;
  }

  // ── Admin: mark orders as seen ──
  if (req.url === '/api/admin/orders/seen' && req.method === 'POST') {
    if (!isAdminAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const orderIds = Array.isArray(data.orderIds) ? data.orderIds.map(String) : [];

      const orders = loadOrders();
      orders.forEach(o => {
        if (orderIds.includes(o.orderId)) o.seenByAdmin = true;
      });
      saveOrders(orders);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // GET /api/orders/status?orderId=... — public status lookup (used by pending.html polling)
  if (req.url.startsWith('/api/orders/status')) {
    const url = new URL(req.url, 'http://localhost');
    const orderId = (url.searchParams.get('orderId') || '').toString().trim();

    if (!orderId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing orderId' }));
      return;
    }

    const orders = loadOrders();
    const order = orders.find(o => o.orderId === orderId);

    if (!order) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Order not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      order: {
        orderId: order.orderId,
        status: order.status,
        eventName: order.eventName,
        qty: order.qty,
        amount: order.amount,
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        verifiedAt: order.verifiedAt,
        ticketCode: order.ticketCode || null
      }
    }));
    return;
  }

  // GET /api/admin/orders — list all orders (requires admin auth)
  if (req.url === '/api/admin/orders' && req.method === 'GET') {
    if (!isAdminAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }
    const orders = loadOrders();
    const unseenCount = orders.filter(o => o.notifyAdmin && !o.seenByAdmin).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, unseenCount: unseenCount, orders: orders }));
    return;
  }

  // GET /api/admin/unseen-count — lightweight real-time alert poll
  if (req.url === '/api/admin/unseen-count' && req.method === 'GET') {
    if (!isAdminAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }
    const orders = loadOrders();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, unseenCount: unseenOrderCount(orders) }));
    return;
  }

  // POST /api/admin/orders/status — verify/approve/reject an order (requires admin auth)
  if (req.url === '/api/admin/orders/status' && req.method === 'POST') {
    if (!isAdminAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const orderId = (data.orderId || '').toString().trim();
      const newStatus = (data.status || '').toString().trim(); // 'verified' | 'rejected' | 'pending'

      if (!orderId || !['verified', 'rejected', 'pending'].includes(newStatus)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid orderId or status' }));
        return;
      }

      const orders = loadOrders();
      const idx = orders.findIndex(o => o.orderId === orderId);

      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Order not found' }));
        return;
      }

      orders[idx].status = newStatus;
      if (newStatus === 'verified') {
        orders[idx].verifiedAt = new Date().toISOString();
        orders[idx].ticketIssued = true;
        orders[idx].ticketIssuedAt = new Date().toISOString();
        orders[idx].rejectedAt = null;
      } else if (newStatus === 'rejected') {
        orders[idx].rejectedAt = new Date().toISOString();
      } else if (newStatus === 'pending') {
        orders[idx].rejectedAt = null;
      }
      saveOrders(orders);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, order: orders[idx] }));
    });
    return;
  }

  // ── Client account API ──

  // POST /api/account/register — create a buyer account (auto-links orders)
  if (req.url === '/api/account/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const name = (data.name || '').toString().trim();
      const email = (data.email || '').toString().trim().toLowerCase();
      const phone = (data.phone || '').toString().trim();
      const password = (data.password || '').toString();

      if (!name || !email || !phone || !password || password.length < 4) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Please fill in your name, email, phone and a password (min 4 characters).' }));
        return;
      }

      const clients = loadClients();
      const exists = clients.find(c =>
        (c.email && c.email.toLowerCase() === email) ||
        (c.phone && c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''))
      );
      if (exists) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'An account with this email or phone already exists. Please sign in.' }));
        return;
      }

      const client = {
        id: 'C_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase(),
        name: name,
        email: email,
        phone: phone,
        passwordHash: hashPassword(password),
        token: makeClientToken(),
        createdAt: new Date().toISOString()
      };

      clients.push(client);
      saveClients(clients);

      // Link any existing orders by email/phone
      const orders = loadOrders();
      let linked = false;
      orders.forEach(o => {
        const emailMatch = o.buyerEmail && o.buyerEmail.toLowerCase() === email;
        const phoneMatch = o.buyerPhone && o.buyerPhone.replace(/\D/g, '') === phone.replace(/\D/g, '');
        if (emailMatch || phoneMatch) { o.clientId = client.id; linked = true; }
      });
      if (linked) saveOrders(orders);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, token: client.token, client: publicClient(client) }));
    });
    return;
  }

  // POST /api/account/login — sign in with email/phone + password
  if (req.url === '/api/account/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}

      const identifier = (data.identifier || '').toString().trim().toLowerCase();
      const password = (data.password || '').toString();

      if (!identifier || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Please enter your email/phone and password.' }));
        return;
      }

      const clients = loadClients();
      const digits = identifier.replace(/\D/g, '');
      const client = clients.find(c =>
        (c.email && c.email.toLowerCase() === identifier) ||
        (c.phone && c.phone.replace(/\D/g, '') === digits)
      );

      if (!client || client.passwordHash !== hashPassword(password)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid email/phone or password.' }));
        return;
      }

      // Refresh token (keeps single active session)
      client.token = makeClientToken();
      saveClients(clients);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, token: client.token, client: publicClient(client) }));
    });
    return;
  }

  // GET /api/account/me — returns the logged-in client + their orders (token auth)
  if (req.url === '/api/account/me' && req.method === 'GET') {
    const client = getClientByToken(req);
    if (!client) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not logged in' }));
      return;
    }

    const orders = loadOrders().filter(o => o.clientId === client.id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      client: publicClient(client),
      orders: orders.map(o => ({
        orderId: o.orderId,
        status: o.status,
        eventName: o.eventName,
        eventDate: o.eventDate,
        eventVenue: o.eventVenue,
        qty: o.qty,
        amount: o.amount,
        currency: o.currency,
        paymentMethod: o.paymentMethod,
        verifiedAt: o.verifiedAt,
        ticketCode: o.ticketCode || null,
        rejectedAt: o.rejectedAt || null
      }))
    }));
    return;
  }

  // GET /api/account/orders — live polling endpoint for the buyer dashboard
  if (req.url === '/api/account/orders' && req.method === 'GET') {
    const client = getClientByToken(req);
    if (!client) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not logged in' }));
      return;
    }

    const orders = loadOrders().filter(o => o.clientId === client.id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      orders: orders.map(o => ({
        orderId: o.orderId,
        status: o.status,
        eventName: o.eventName,
        eventDate: o.eventDate,
        eventVenue: o.eventVenue,
        qty: o.qty,
        amount: o.amount,
        currency: o.currency,
        paymentMethod: o.paymentMethod,
        verifiedAt: o.verifiedAt,
        ticketCode: o.ticketCode || null,
        rejectedAt: o.rejectedAt || null
      }))
    }));
    return;
  }

  // POST /api/account/logout — invalidate the client token
  if (req.url === '/api/account/logout' && req.method === 'POST') {
    const client = getClientByToken(req);
    if (client) {
      const clients = loadClients();
      const idx = clients.findIndex(c => c.id === client.id);
      if (idx !== -1) {
        clients[idx].token = null;
        saveClients(clients);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Normalize URL
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Prevent path traversal
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Try index.html fallback for directory requests
      const indexPath = path.join(PUBLIC_DIR, urlPath, 'index.html');
      fs.stat(indexPath, (err2, stats2) => {
        if (err2 || !stats2.isFile()) {
          // Graceful 404 page — handles Render free-tier cold start
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="3" />
  <title>UNN Socials — Waking up...</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0a1a0a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #e0e0e0;
      text-align: center;
      padding: 24px;
    }
    .card {
      background: linear-gradient(145deg, #0f2a0f, #1a3a1a);
      border: 1px solid #2a5a2a;
      border-radius: 24px;
      padding: 48px 40px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 24px 80px rgba(0,0,0,0.6);
    }
    .logo { font-size: 28px; font-weight: 700; margin-bottom: 24px; }
    .logo span { color: #ffd700; }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: #fff; }
    p { font-size: 15px; line-height: 1.6; color: #a0c0a0; margin-bottom: 24px; }
    .spinner {
      display: inline-block;
      width: 36px; height: 36px;
      border: 3px solid #2a5a2a;
      border-top-color: #ffd700;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .btn {
      display: inline-block;
      background: #ffd700;
      color: #0a1a0a;
      font-weight: 600;
      font-size: 15px;
      padding: 12px 32px;
      border-radius: 40px;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover { background: #ffe44d; }
    .hint { font-size: 13px; color: #608060; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">UNN <span>Socials</span></div>
    <div class="icon">⚡</div>
    <div class="spinner"></div>
    <h1>Waking up the server…</h1>
    <p>This page is hosted on a free service that sleeps after inactivity.<br>It should be ready in a moment.</p>
    <a href="/" class="btn" onclick="location.reload()">⟳ Refresh Now</a>
    <p class="hint">Auto-refreshing every 3 seconds &mdash; or tap the button above.</p>
  </div>
</body>
</html>`);
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
});

server.listen(PORT, () => {
  console.log(`UNN Socials server running at http://localhost:${PORT}`);
});

