/*
Unisocials — Node.js server
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
      await db.query(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS universities (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS subscribers (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS visitor_daily (visit_day DATE NOT NULL, visitor_hash TEXT NOT NULL, first_path TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (visit_day, visitor_hash))`);
      await db.query(`CREATE TABLE IF NOT EXISTS referral_links (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
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

/* ── Coupons ── */
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
    for (const c of coupons) {
      await db.query('INSERT INTO coupons (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [c.id, JSON.stringify(c)]);
    }
    const ids = coupons.map(c => c.id);
    if (ids.length) await db.query('DELETE FROM coupons WHERE NOT (id = ANY($1::text[]))', [ids]);
    else await db.query('DELETE FROM coupons');
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
  if (usePg) {
    // Do not rewrite the entire sessions table. A full DELETE + INSERT cycle
    // can race with another login/logout and accidentally remove a live session.
    await db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id', [token, userId]);
    return;
  }
  const sessions = await readSessions();
  sessions[token] = userId;
  await writeSessions(sessions);
}
async function getSessionUser(token) {
  if (!token) return null;
  if (usePg) {
    const r = await db.query('SELECT user_id FROM sessions WHERE token = $1 LIMIT 1', [token]);
    if (!r.rows.length) return null;
    const user = await findUserById(r.rows[0].user_id);
    return user && user.archived === true ? null : user;
  }
  const sessions = await readSessions();
  const userId = sessions[token];
  if (!userId) return null;
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
}
async function deleteUserSessions(userId) {
  if (usePg) {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return;
  }
  const sessions = await readSessions();
  for (const [t, uid] of Object.entries(sessions)) {
    if (uid === userId) delete sessions[t];
  }
  await writeSessions(sessions);
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
async function getReferralLinkBySubadminId(subadminId) {
  const links = await readReferralLinks();
  return links.find(l => l.subadminId === subadminId) || null;
}
async function generateReferralLink(subadminId, subadminName, subadminEmail) {
  const links = await readReferralLinks();
  // Check if this subadmin already has a referral link
  const existing = links.find(l => l.subadminId === subadminId);
  if (existing) return existing;
  
  // Generate unique code
  let code = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  while (links.find(l => l.code === code)) {
    code = 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }
  
  const link = {
    code: code,
    subadminId: subadminId,
    subadminName: subadminName,
    subadminEmail: subadminEmail,
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

async function updateReferralStats(referralCode) {
  if (!referralCode) return;
  const links = await readReferralLinks();
  const link = links.find(l => l.code === referralCode);
  if (!link) return;
  
  const orders = await readOrders();
  const referredOrders = orders.filter(o => isReferralOrderCounted(o, referralCode));
  
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
const DEFAULT_EVENTS = [
  {
id: 'arts-cultural-night',
    name: 'Faculty of Arts Cultural Night',
    category: 'Arts & Culture',
    price: 2500,
    vipPrice: 5000,
    vvipPrice: 5000,
    tablePrice: 10000,
    date: 'March 10, 2025',
    time: '4:00 PM',
    venue: 'Arts Theatre',
    description: 'An evening of drama, poetry, music, and dance performances showcasing the best of the Arts department.',
    tags: ['💃 Performance', '🎤 Live Music', '🎭 Drama'],
    image: 'images/tm-622-screen-01.jpg',
    icon: '🎭',
    featured: true,
    seats: '150 seats left',
    universityId: 'uni-unn',
    universityName: 'University of Nigeria, Nsukka',
    universitySlug: 'unn'
  },
  {
id: 'engineering-dinner',
    name: 'Engineering Annual Dinner',
category: 'Engineering',
    price: 5000,
    vipPrice: 10000,
    vvipPrice: 10000,
    tablePrice: 25000,
    date: 'March 15, 2025',
    time: '5:00 PM',
    venue: 'Engineering Auditorium',
    description: 'The flagship engineering social event — awards ceremony, networking with alumni, dinner service, and live entertainment.',
    tags: ['🏆 Awards', '🍽️ Dinner', '🤝 Networking'],
    image: 'images/tm-622-screen-02.jpg',
    icon: '⚙️',
    featured: true,
    seats: '80 seats left',
    universityId: 'uni-unn',
    universityName: 'University of Nigeria, Nsukka',
    universitySlug: 'unn'
  },
  {
    id: 'entrepreneurship-summit',
    name: 'Entrepreneurship Summit',
category: 'Business',
    price: 3000,
    vipPrice: 0,
    date: 'March 22, 2025',
    time: '10:00 AM',
    venue: 'Business School Hall',
    description: 'Connect with startup founders, investors, and industry leaders. Pitch your business ideas and compete for funding.',
    tags: ['💡 Pitching', '💰 Funding', '📈 Workshops'],
    image: 'images/tm-622-screen-03.jpg',
    icon: '💼',
    featured: true,
    seats: '200 seats left',
    universityId: 'uni-unn',
    universityName: 'University of Nigeria, Nsukka',
    universitySlug: 'unn'
  },
  {
id: 'music-festival',
    name: 'Campus Music Festival',
category: 'Music',
    price: 4000,
    vipPrice: 8000,
    vvipPrice: 8000,
    tablePrice: 20000,
    date: 'March 29, 2025',
    time: '6:00 PM',
    venue: 'Sports Complex',
    description: 'Live performances from the best campus bands, guest artists, and DJs. A night of unforgettable music and dancing.',
    tags: ['🎸 Live Bands', '🎧 DJ Sets', '🍹 Refreshments'],
    image: 'images/tm-622-screen-04.jpg',
    icon: '🎵',
    featured: true,
    seats: '300 seats left',
    universityId: 'uni-unn',
    universityName: 'University of Nigeria, Nsukka',
    universitySlug: 'unn'
  },
  {
    id: 'law-moot-court',
    name: 'Faculty of Law Moot Court',
    category: 'Academic',
    price: 1500,
    vipPrice: 0,
    date: 'April 5, 2025',
    time: '9:00 AM',
    venue: 'Faculty of Law',
    description: 'The annual inter-faculty mock trial competition. Watch future lawyers battle it out in a simulated courtroom.',
    tags: ['⚖️ Mock Trial', '📜 Legal Debate', '🏅 Competition'],
    image: 'images/tm-622-screen-05.jpg',
    icon: '📚',
    featured: false,
    seats: '100 seats left',
    universityId: 'uni-unn',
    universityName: 'University of Nigeria, Nsukka',
    universitySlug: 'unn'
  },
  {
    id: 'sports-day',
    name: 'Inter-Faculty Sports Day',
    category: 'Sports',
    price: 1000,
    vipPrice: 0,
    date: 'April 12, 2025',
    time: '8:00 AM',
venue: 'Main Stadium',
    description: 'A day of friendly competition across football, basketball, athletics, and relay races. Cheer your faculty to victory!',
    tags: ['⚽ Football', '🏀 Basketball', '🏃 Athletics'],
    image: 'images/tm-622-screen-01.jpg',
    icon: '⚽',
    featured: false,
    seats: 'Unlimited',
    universityId: 'uni-unn',
    universityName: 'University of Nigeria, Nsukka',
    universitySlug: 'unn'
  }
];

async function readEvents() {
  if (usePg) {
    const r = await db.query('SELECT data FROM events ORDER BY data->>\'date\' ASC');
    const list = r.rows.map(row => row.data);
    // Auto-seed the default UNN events catalog when the events table is empty
    // (e.g. first run or an empty PostgreSQL table) so events are never missing.
    if (list.length === 0) {
      for (const ev of DEFAULT_EVENTS) {
        await db.query('INSERT INTO events (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
          [ev.id, JSON.stringify(ev)]);
      }
      console.log('Seeded ' + DEFAULT_EVENTS.length + ' default events into PostgreSQL.');
      return DEFAULT_EVENTS.slice();
    }
    return list;
  }
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'events.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_EVENTS;
  } catch (e) {
    return DEFAULT_EVENTS;
  }
}
async function writeEvents(events) {
  if (usePg) {
    await db.query('DELETE FROM events');
    for (const ev of events) {
      await db.query('INSERT INTO events (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [ev.id, JSON.stringify(ev)]);
    }
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
    await db.query('DELETE FROM subscribers');
    for (const s of list) {
      await db.query('INSERT INTO subscribers (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [s.id, JSON.stringify(s)]);
    }
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
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}
function isAdminAuthorized(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASSWORD !== undefined ? process.env.ADMIN_PASSWORD : defaults.ADMIN_PASSWORD;
  return !!token && token === expected;
}
// Authorize either the master admin password OR a logged-in sub-admin account.
// Sub-admins have limited privileges (check-in + add events).
async function isAdminOrInfluencerAdmin(req) {
  if (isAdminAuthorized(req)) return { role: 'admin' };
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await getSessionUser(token);
  if (user && user.role === 'influencer_admin') return { role: user.role, user };
  return null;
}

// Influencer ownership is enforced server-side. Master admin can manage any
// influencer; an influencer admin can manage only accounts whose createdBy
// matches the authenticated influencer admin's user id.
function canManageInfluencer(authCtx, influencer) {
  if (!authCtx || !influencer || influencer.role !== 'influencer') return false;
  if (authCtx.role === 'admin') return true;
  return authCtx.role === 'influencer_admin' && influencer.createdBy === authCtx.user.id;
}
async function isAdminOrSubadmin(req) {
  if (isAdminAuthorized(req)) return { role: 'admin' };
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await getSessionUser(token);
  if (user && ['subadmin','influencer','checkin_staff','influencer_admin'].includes(user.role)) return { role: user.role, user: user };
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
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}

// Very small in-memory rate limiter for sensitive endpoints (auth).
// Keyed by IP + route. Returns true if the request is allowed.
const rateBuckets = new Map();
function rateLimit(req, route, limit, windowMs) {
  const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : (req.socket && req.socket.remoteAddress) || 'unknown';
  const key = ip + '|' + route;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count++;
  rateBuckets.set(key, bucket);
  // Guard against unbounded growth
  if (rateBuckets.size > 10000) {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [k, b] of rateBuckets) {
      if (b.resetAt < cutoff) rateBuckets.delete(k);
    }
  }
  return { allowed: bucket.count <= limit, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
}

// Apply security headers to a plain header object.
function withSecurityHeaders(headers) {
  return Object.assign({}, headers, securityHeaders());
}

function sendJson(res, status, obj) {
  res.writeHead(status, withSecurityHeaders({ 'Content-Type': 'application/json' }));
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
      '\nPlease keep this email safe — it contains your tickets.\n' +
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
    '<p style="font-size:12px;color:#94a3b8;margin:20px 0 0">Please keep this email safe — it contains your tickets.</p>' +
    '</div></div>';
}

// Send buyer confirmation email. Prefers Brevo (works WITHOUT a domain — you just
// verify a sender email address in Brevo), falls back to Resend if BREVO_API_KEY
// isn't set. Best-effort: never throws / never blocks.
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

// Fire buyer + admin emails after an order becomes verified (best-effort, non-blocking).
async function notifyOrderVerified(order) {
  try {
    sendBuyerConfirmation(order);
    sendAdminAlert(order);
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

// Fire the new-order alert (best-effort, non-blocking).
function notifyNewOrder(order) {
  try { sendNewOrderAlert(order); } catch (e) { console.warn('notifyNewOrder error:', e.message); }
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


// ── Site visitor analytics ───────────────────
// Counts unique visitors per calendar day. We hash the IP + user-agent + date,
// so raw visitor identifiers are not persisted.
function visitorHashForRequest(req, day) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.socket && req.socket.remoteAddress || '');
  const ua = String(req.headers['user-agent'] || '');
  const salt = process.env.VISITOR_ANALYTICS_SALT || 'unisocials-visitor-analytics-v1';
  return crypto.createHash('sha256').update(`${salt}|${day}|${ip}|${ua}`).digest('hex');
}
async function recordSiteVisit(req, pathname) {
  if (req.method !== 'GET') return;
  // Count page visits, not API calls/assets.
  if (!(pathname === '/' || pathname.endsWith('.html'))) return;
  if (pathname.startsWith('/admin') || pathname.startsWith('/subadmin') || pathname.startsWith('/influencer')) return;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.VISITOR_ANALYTICS_TIMEZONE || 'Africa/Lagos' }).format(new Date());
  const hash = visitorHashForRequest(req, day);
  if (usePg) {
    await db.query(
      `INSERT INTO visitor_daily (visit_day, visitor_hash, first_path)
       VALUES ($1, $2, $3)
       ON CONFLICT (visit_day, visitor_hash) DO NOTHING`,
      [day, hash, pathname]
    );
    return;
  }
  const file = path.join(DATA_DIR, 'visitor_daily.json');
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(rows)) rows=[]; } catch(e) {}
  if (!rows.some(v => v.day === day && v.hash === hash)) {
    rows.push({day, hash, path: pathname});
    // Keep 180 days locally to prevent unbounded growth.
    const cutoff = new Date(Date.now() - 180*86400000).toISOString().slice(0,10);
    rows = rows.filter(v => v.day >= cutoff);
    fs.writeFileSync(file, JSON.stringify(rows), 'utf8');
  }
}
async function getSiteAnalytics(days) {
  const n = Math.min(90, Math.max(1, Number(days) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - (n-1)*86400000);
  const startDay = start.toISOString().slice(0,10);
  const endDay = end.toISOString().slice(0,10);
  if (usePg) {
    const r = await db.query(
      `SELECT visit_day::text AS day, COUNT(*)::int AS visitors
       FROM visitor_daily WHERE visit_day BETWEEN $1 AND $2
       GROUP BY visit_day ORDER BY visit_day`,
      [startDay, endDay]
    );
    const byDay = Object.fromEntries(r.rows.map(x => [x.day, Number(x.visitors)]));
    const daily = []; for(let i=0;i<n;i++){ const d=new Date(start.getTime()+i*86400000).toISOString().slice(0,10); daily.push({day:d,visitors:byDay[d]||0}); }
    return daily;
  }
  let rows=[]; try { rows=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'visitor_daily.json'),'utf8')); if(!Array.isArray(rows))rows=[]; } catch(e){}
  const counts={}; rows.forEach(v=>{if(v.day>=startDay&&v.day<=endDay) counts[v.day]=(counts[v.day]||0)+1;});
  const daily=[]; for(let i=0;i<n;i++){const d=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);daily.push({day:d,visitors:counts[d]||0});}
  return daily;
}

// ────────────────────────────────────────────
// HTTP SERVER
// ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {

    // ── Admin/Sub-admin: site visitor analytics ──
    if (pathname === '/api/admin/site-analytics' && req.method === 'GET') {
      const auth = isAdminAuthorized(req) ? { role:'admin' } : await isAdminOrSubadmin(req);
      if (!auth || !['admin','subadmin'].includes(auth.role)) return sendJson(res, 401, {success:false,error:'Unauthorized'});
      const daily = await getSiteAnalytics(url.searchParams.get('days') || 30);
      const today = daily[daily.length-1]?.visitors || 0;
      const yesterday = daily[daily.length-2]?.visitors || 0;
      const last7 = daily.slice(-7).reduce((a,x)=>a+x.visitors,0);
      const total = daily.reduce((a,x)=>a+x.visitors,0);
      return sendJson(res,200,{success:true,today,yesterday,last7,total,daily});
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
        role: 'buyer',
        createdAt: new Date().toISOString()
      };
      await addUser(user);
      const token = generateToken();
      await createSession(token, user.id);
      return sendJson(res, 200, { success: true, token: token, user: publicUser(user) });
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
      const password = String(data.password || '');
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

    // ── Admin (master only): list influencer accounts ──
    if (pathname === '/api/admin/influencers' && req.method === 'GET') {
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','subadmin','influencer_admin'].includes(authCtx.role)) {
        return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      }
      const users = await readUsers();
      const links = await readReferralLinks();
      const orders = await readOrders();
      const canViewAll = authCtx.role === 'admin' || authCtx.role === 'subadmin';
       const influencers = users.filter(u => u.role === 'influencer' && (canViewAll || u.createdBy === authCtx.user.id)).map(u => {
        const link = links.find(l => l.subadminId === u.id) || null;
        const referredOrders = link ? orders.filter(o => isReferralOrderCounted(o, link.code)) : [];
        const totalRevenue = referredOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
        const totalTickets = referredOrders.reduce((sum, o) => sum + (o.qty || 0), 0);
        return {
          ...publicUser(u),
          referralCode: link ? link.code : null,
          referralStats: {
            totalOrders: referredOrders.length,
            totalRevenue,
            totalTickets,
            uniquePeople: new Set(referredOrders.map(o => String(o.buyerEmail || '').trim().toLowerCase()).filter(Boolean)).size
          }
        };
      });
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
      if (!name || !email || password.length < 6) {
        return sendJson(res, 400, { success: false, error: 'Name, email and a password of at least 6 characters are required.' });
      }
      const existing = await findUserByEmail(email);
      if (existing) return sendJson(res, 409, { success: false, error: 'A user with this email already exists.' });
      const influencer = {
        id: 'INF-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        name, email, phone: '', passwordHash: hashPassword(password), role: 'influencer',
        createdBy: authCtx.role === 'admin' ? null : authCtx.user.id,
        createdAt: new Date().toISOString()
      };
      await addUser(influencer);
      const referralLink = await generateReferralLink(influencer.id, influencer.name, influencer.email);
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
      const users = await readUsers();
      await writeUsers(users.filter(u => u.id !== user.id));
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
        const link = links.find(l => l.subadminId === u.id) || null;
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
      if (!name || !email || password.length < 6) {
        return sendJson(res, 400, { success: false, error: 'Name, email and a password of at least 6 characters are required.' });
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
      const users = await readUsers();
      await writeUsers(users.filter(u => u.id !== user.id));
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
      if (authCtx.role === 'subadmin' && target.createdBy && target.createdBy !== authCtx.user.id) {
        return sendJson(res,403,{success:false,error:'You can only archive accounts you created.'});
      }
      const users = await readUsers();
      const idx = users.findIndex(u => u.id === target.id);
      if (idx < 0) return sendJson(res,404,{success:false,error:'Account not found'});
      users[idx] = Object.assign({}, users[idx], { archived: archived, archivedAt: archived ? new Date().toISOString() : null, archivedBy: archived ? authCtx.role : null });
      await writeUsers(users);
      if (archived) await deleteUserSessions(target.id);
      return sendJson(res,200,{success:true,user:publicUser(users[idx])});
    }

    // ── Admin: dedicated staff accounts (check-in staff / influencer admin) ──
    if (pathname === '/api/admin/staff' && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      if (req.method === 'GET') {
        const users = await readUsers();
        const staff = users.filter(u => ['checkin_staff','influencer_admin'].includes(u.role)).map(u => publicUser(u));
        return sendJson(res, 200, { success: true, staff });
      }
      if (req.method === 'POST') {
        const body = await readBody(req); let data = {};
        try { data = JSON.parse(body || '{}'); } catch (e) {}
        const name = String(data.name || '').trim();
        const email = String(data.email || '').trim().toLowerCase();
        const password = String(data.password || '');
        const role = String(data.role || '').trim();
        if (!name || !email || password.length < 6 || !['checkin_staff','influencer_admin'].includes(role)) {
          return sendJson(res, 400, { success: false, error: 'Name, email, password (6+ characters), and a valid role are required.' });
        }
        if (await findUserByEmail(email)) return sendJson(res, 409, { success: false, error: 'A user with this email already exists.' });
        const user = { id: (role === 'checkin_staff' ? 'CHK-' : 'IADM-') + crypto.randomBytes(4).toString('hex').toUpperCase(), name, email, phone:'', passwordHash:hashPassword(password), role, createdAt:new Date().toISOString() };
        await addUser(user);
        return sendJson(res, 200, { success:true, staff: publicUser(user) });
      }
      const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
      if (!email) return sendJson(res, 400, { success:false, error:'Missing email' });
      const user = await findUserByEmail(email);
      if (!user || !['checkin_staff','influencer_admin'].includes(user.role)) return sendJson(res,404,{success:false,error:'Staff account not found'});
      const users = await readUsers(); await writeUsers(users.filter(u => u.id !== user.id)); await deleteUserSessions(user.id);
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
      if (!email || newPassword.length < 6) {
        return sendJson(res, 400, { success: false, error: 'Email and a new password of at least 6 characters are required.' });
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
      const users = await readUsers();
      await writeUsers(users.map(u => u.id === target.id ? target : u));
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
      user.otp = otp;
      user.otpExpires = otpExpires;
      await writeUsers(await readUsers().then(list => list.map(u => u.id === user.id ? user : u)));

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
      if (String(user.otp) !== String(otp)) {
        return sendJson(res, 400, { success: false, error: 'Invalid OTP. Please check and try again.' });
      }

      // Issue a one-time reset token (valid 15 minutes)
      const resetToken = generateToken();
      user.resetToken = resetToken;
      user.resetTokenExpires = Date.now() + 15 * 60 * 1000;
      user.otp = null;
      user.otpExpires = null;
      await writeUsers(await readUsers().then(list => list.map(u => u.id === user.id ? user : u)));

      return sendJson(res, 200, { success: true, resetToken: resetToken });
    }

    // ── AUTH: Reset password (with reset token) ──
    if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const email = String(data.email || '').trim().toLowerCase();
      const resetToken = String(data.resetToken || '').trim();
      const newPassword = String(data.password || '');
      if (!email || !resetToken || newPassword.length < 6) {
        return sendJson(res, 400, { success: false, error: 'Email, reset token, and a password of at least 6 characters are required.' });
      }

      const user = await findUserByEmail(email);
      if (!user || !user.resetToken || !user.resetTokenExpires) {
        return sendJson(res, 400, { success: false, error: 'No password reset was requested. Please start over.' });
      }
      if (Date.now() > user.resetTokenExpires) {
        return sendJson(res, 400, { success: false, error: 'This reset link has expired. Please request a new OTP.' });
      }
      if (user.resetToken !== resetToken) {
        return sendJson(res, 400, { success: false, error: 'Invalid reset token. Please start over.' });
      }

      user.passwordHash = hashPassword(newPassword);
      user.resetToken = null;
      user.resetTokenExpires = null;
      user.otp = null;
      user.otpExpires = null;
      await writeUsers(await readUsers().then(list => list.map(u => u.id === user.id ? user : u)));
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
  const relevant = list.filter(o => String(o.eventId || '') === String(event.id || '') && String(o.ticketTier || 'regular').toLowerCase() === t && ['pending','verified'].includes(String(o.status || '').toLowerCase()));
  const reserved = relevant.reduce((s,o) => s + Math.max(0, parseInt(o.qty) || 0), 0);
  const sold = list.filter(o => String(o.eventId || '') === String(event.id || '') && String(o.ticketTier || 'regular').toLowerCase() === t && String(o.status || '').toLowerCase() === 'verified').reduce((s,o) => s + Math.max(0, parseInt(o.qty) || 0), 0);
  return {total, sold, reserved, remaining: total > 0 ? Math.max(0,total-reserved) : 0, soldOut: total > 0 && reserved >= total};
}

// ── Create order (PENDING until payment is server-verified) ──
    if (pathname === '/api/orders' && req.method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}

      const orderId = String(data.orderId || '').trim();
      const eventId = String(data.eventId || '').trim();
      const eventName = String(data.eventName || '').trim();
      const eventDate = String(data.eventDate || '').trim();
      const eventVenue = String(data.eventVenue || '').trim();
      const eventCategory = String(data.eventCategory || '').trim();
      const qty = parseInt(data.qty) || 1;
      let amount = parseFloat(data.amount) || 0;
      const currency = String(data.currency || 'NGN');
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
      let couponDiscount = 0;
      let baseAmountBeforeCoupon = amount;
      let referralApplied = false;

      // Validate referral before pricing. A valid referral intentionally switches
      // this order from the event's bonus price to the selected tier's original price.
      if (referralCode) {
        const referralLink = await getReferralLinkByCode(referralCode);
        if (!referralLink) {
          return sendJson(res, 400, { success: false, error: 'Invalid referral code. Please check the code and try again.' });
        }
        referralApplied = true;
      }

      // Server-authoritative pricing: bonus is the default; a valid referral
      // switches the selected tier back to its original price.
      if (eventId) {
        const eventCatalog = await readEvents();
        const eventRecord = eventCatalog.find(e => String(e.id) === eventId);
        if (!eventRecord) return sendJson(res, 400, { success: false, error: 'Event not found' });
        if (eventRecord.archived === true) {
          return sendJson(res, 409, { success: false, error: 'This event has been archived and is no longer available for purchase.' });
        }
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
        paymentMethod: 'flutterwave',      // Flutterwave is the only method
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
        ticketCodes: generateTicketCodes(qty),  // one code per ticket
        ticketCode: null
      };
      order.ticketCode = order.ticketCodes[0].code;
      await addOrder(order);
      // Notify the admin the moment a new order is placed so they can watch for
      // the payment and verify it (e.g. bank transfer / manual confirmation).
      notifyNewOrder(order);
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
          const updated = await patchOrder(txRef, verifyOrderTicketData(Object.assign({}, order)));
          console.log('Webhook verified order:', txRef);
          notifyOrderVerified(updated);
          await refreshReferralStatsForVerifiedOrder(updated, order.status);
        } else {
          return sendJson(res, 200, { success: false, error: 'Amount/currency mismatch in webhook' });
        }
      }
      return sendJson(res, 200, { success: true, tx_ref: txRef });
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
          ticketCodes: order.ticketCodes || [],
          ticketCode: order.ticketCode || null
        }
      });
    }

// ── Buyer order lookup (Order ID + phone) ──
    // Allows lookup WITHOUT signing in. The order's basic details (event, date,
    // venue, qty, amount, status) are returned to anyone who knows the Order ID
    // and phone. However, the actual ticket codes are ONLY revealed when the
    // requester is signed in AND owns the order (matched by userId or email).
    // Viewing a ticket/QR always requires sign-in via /api/ticket.
    if (pathname === '/api/orders/lookup' && req.method === 'POST') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      let user = null;
      if (token) user = await getSessionUser(token);

      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (e) {}
      const orderId = String(data.orderId || '').trim();
      const phone = String(data.phone || '').trim();
      if (!orderId || !phone) return sendJson(res, 400, { success: false, error: 'Missing orderId or phone' });

      const orders = await readOrders();
      const order = orders.find(o => o.orderId === orderId && o.buyerPhone === phone);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found. Check your Order ID and phone number.' });

      // If signed in, confirm they own this order before revealing ticket codes.
      const ownsOrder = user && (order.userId === user.id || String(order.buyerEmail).toLowerCase() === user.email);

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
        ticketCodes: ownsOrder ? (order.ticketCodes || []) : [],
        ticketCode: ownsOrder ? (order.ticketCode || null) : null,
        requiresSignIn: !ownsOrder
      };
      return sendJson(res, 200, { success: true, order: payload });
    }

    // ── Get ticket by orderId + code (protected, per-ticket) ──
    // Requires login AND ownership of the order.
    if (pathname === '/api/ticket' && req.method === 'GET') {
      const orderId = String(url.searchParams.get('orderId') || '').trim();
      const code = String(url.searchParams.get('code') || '').trim();
      if (!orderId || !code) return sendJson(res, 400, { success: false, error: 'Missing orderId or code' });

      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user) return sendJson(res, 401, { success: false, error: 'Please sign in to view this ticket.' });

      const order = await getOrder(orderId);
      if (!order) return sendJson(res, 404, { success: false, error: 'Order not found' });
      const ownsOrder = order.userId === user.id || String(order.buyerEmail).toLowerCase() === user.email;
      if (!ownsOrder) return sendJson(res, 403, { success: false, error: 'You do not have access to this ticket.' });
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
      const authCtx = await isAdminOrSubadmin(req);
      if (!authCtx || !['admin','checkin_staff'].includes(authCtx.role)) return sendJson(res, 401, { success: false, error: 'Check-in staff access only' });
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

    // ── Influencer: referral link ──
    if (pathname === '/api/influencer/referral-link' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'influencer') return sendJson(res, 403, { success: false, error: 'Influencer access only' });
      let link = await getReferralLinkBySubadminId(user.id);
      if (!link) link = await generateReferralLink(user.id, user.name, user.email);
      else { await updateReferralStats(link.code); link = await getReferralLinkBySubadminId(user.id); }
      return sendJson(res, 200, { success: true, link });
    }

    // ── Influencer: referral stats ──
    if (pathname === '/api/influencer/referral-stats' && req.method === 'GET') {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const user = await getSessionUser(token);
      if (!user || user.role !== 'influencer') return sendJson(res, 403, { success: false, error: 'Influencer access only' });
      const link = await getReferralLinkBySubadminId(user.id);
      if (!link) return sendJson(res, 200, { success: true, stats: { totalOrders: 0, totalRevenue: 0, totalTickets: 0, uniquePeople: 0, link: null } });
      const orders = await readOrders();
      const referredOrders = orders.filter(o => isReferralOrderCounted(o, link.code));
      const uniquePeople = new Set(referredOrders.map(o => String(o.buyerEmail || '').trim().toLowerCase()).filter(Boolean)).size;
      return sendJson(res, 200, { success: true, stats: {
        totalOrders: referredOrders.length,
        totalRevenue: referredOrders.reduce((sum, o) => sum + (o.amount || 0), 0),
        totalTickets: referredOrders.reduce((sum, o) => sum + (o.qty || 0), 0),
        uniquePeople, link
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
      
      return sendJson(res, 200, { success: true, link: link });
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
      
      const orders = await readOrders();
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
      const orders = await readOrders();
      return sendJson(res, 200, { success: true, unseenCount: unseenOrderCount(orders), orders: orders });
    }

    // ── Admin: unseen count ──
    if (pathname === '/api/admin/unseen-count' && req.method === 'GET') {
      if (!isAdminAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
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
          events = allEvents.filter(e => e.archived !== true);
        }
      }
      const uniSlug = String(url.searchParams.get('university') || '').trim();
      const orders = await readOrders();
      function enrich(ev) {
        return Object.assign({}, ev, { inventory: {
          regular: getTierInventory(ev,'regular',orders),
          vip: getTierInventory(ev,'vip',orders),
          vvip: getTierInventory(ev,'vvip',orders),
          table: getTierInventory(ev,'table',orders)
        }});
      }
      if (uniSlug) {
        const filtered = events.filter(function(e) {
          return (e.universityId === uniSlug || e.universitySlug === uniSlug);
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

      // Events happening this month (parse the event date string)
      let eventsThisMonth = 0;
      events.forEach(function(ev) {
        if (!ev.date) return;
        const d = new Date(ev.date);
        if (isNaN(d)) return;
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) eventsThisMonth++;
      });

      // Upcoming events (date >= today)
      const upcomingEvents = events.filter(function(ev) {
        if (!ev.date) return false;
        const d = new Date(ev.date);
        if (isNaN(d)) return false;
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

// ── Admin/Sub-admin: create/update an event ──
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
        image: String(data.image || '').trim(),
        icon: data.icon || '🎟️',
        featured: !!data.featured,
        archived: data.id ? !!data.archived : false,
        seats: data.seats || '—',
        universityId: universityId,
        universityName: universityName,
        universitySlug: uniSlug
      };
            try {
        await addEvent(ev);
        console.log('✓ Event created:', ev.id, '—', ev.name, '(', ev.universityName, ')');
        return sendJson(res, 200, { success: true, event: ev });
      } catch (e) {
        console.error('✗ Error creating event:', e.message);
        return sendJson(res, 500, { success: false, error: 'Failed to save event: ' + e.message });
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
    const filePath = path.join(PUBLIC_DIR, urlPath);
    // Shortlink referral handler: /r/REF-XXXX  (optionally ?to=/path)
    if (urlPath && urlPath.toLowerCase().startsWith('/r/')) {
      const rawCode = decodeURIComponent(urlPath.slice(3) || '').trim();
      const code = String(rawCode || '').toUpperCase();
      const to = String(url.searchParams.get('to') || '/');
      const safeTo = to && to.startsWith('/') ? to : '/';
      const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redirecting…</title></head><body><script>try{sessionStorage.setItem("referralCode", "' + code + '");localStorage.setItem("unn_referral_code", "' + code + '");}catch(e){}window.location.replace("' + safeTo + '");</script><noscript><meta http-equiv="refresh" content="0;url=' + safeTo + '"></noscript></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
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
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="refresh" content="3"><title>Unisocials — Waking up...</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a1a0a;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#e0e0e0;text-align:center;padding:24px}.card{background:linear-gradient(145deg,#0f2a0f,#1a3a1a);border:1px solid #2a5a2a;border-radius:24px;padding:48px 40px;max-width:480px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.6)}.logo{font-size:28px;font-weight:700;margin-bottom:24px}.logo span{color:#ffd700}.icon{font-size:56px;margin-bottom:16px}h1{font-size:22px;font-weight:600;margin-bottom:12px;color:#fff}p{font-size:15px;line-height:1.6;color:#a0c0a0;margin-bottom:24px}.spinner{display:inline-block;width:36px;height:36px;border:3px solid #2a5a2a;border-top-color:#ffd700;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:20px}@keyframes spin{to{transform:rotate(360deg)}}.btn{display:inline-block;background:#ffd700;color:#0a1a0a;font-weight:600;font-size:15px;padding:12px 32px;border-radius:40px;text-decoration:none;transition:background .2s}.btn:hover{background:#ffe44d}.hint{font-size:13px;color:#608060;margin-top:16px}</style>
</head><body><div class="card"><div class="logo">Uni<span>socials</span></div><div class="icon">⚡</div><div class="spinner"></div><h1>Waking up the server…</h1><p>This page is hosted on a free service that sleeps after inactivity.<br>It should be ready in a moment.</p><a href="/" class="btn" onclick="location.reload()">⟳ Refresh Now</a><p class="hint">Auto-refreshing every 3 seconds &mdash; or tap the button above.</p></div></body></html>`);
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
    phone: user.phone,
    role: user.role || 'buyer',
    createdAt: user.createdAt,
    archived: user.archived === true
  };
}

initStorage().then(() => {
  server.listen(PORT, () => {
    console.log('Unisocials server running at http://localhost:' + PORT);
  });
});

