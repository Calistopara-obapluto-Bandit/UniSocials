/* Verify the new reduced_13 (13% Unisocials / 87% owner) commission plan
   through the real HTTP endpoints. Runs server.js in-process on PORT=3987 so
   isAdminAuthorized() resolves against this shell's ADMIN_PASSWORD. */
'use strict';
// Test-fixture only, scoped to THIS throwaway process: the workspace's
// ADMIN_PASSWORD is the fail-closed placeholder, so admin auth rejects every
// request by design (pre-existing). Overriding it locally lets the harness
// exercise the admin endpoint; the preview/production server is untouched.
process.env.ADMIN_PASSWORD = 'harness-split-check-' + Date.now() + '-x';
process.env.PORT = '3987'; // never clash with the managed preview on 3000
const http = require('http');

const PORT = Number(process.env.PORT);
const BASE = 'http://127.0.0.1:' + PORT;
const AUTH = 'Bearer ' + process.env.ADMIN_PASSWORD;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + path, {
      method,
      headers: Object.assign(
        { Authorization: AUTH },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      )
    }, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await req('GET', '/api/universities');
      if (r.status === 200) return;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not come up');
}

async function main() {
  require('../server.js');
  await waitForServer();

  // Debug: is admin auth resolvable in this process? (lengths only, never values)
  const expected = String(process.env.ADMIN_PASSWORD || '').trim();
  console.log('DEBUG adminKeyLen=' + expected.length +
    ' placeholder=' + (expected === 'CHANGE_ME_STRONG_PASSWORD') +
    ' headerSentLen=' + AUTH.replace('Bearer ', '').length +
    ' headerLenMatches=' + (Buffer.byteLength(expected) === Buffer.byteLength(AUTH.replace('Bearer ', ''))));

  // 1. Create a throwaway event.
  const created = await req('POST', '/api/admin/events', {
    name: 'Split Test (temp)', category: 'General', date: 'Jan 1, 2027', venue: 'Test Hall'
  });
  const evId = created.json && created.json.event && created.json.event.id;
  check('create temp event', created.status === 200 && created.json.success && !!evId,
    'status=' + created.status + ' id=' + evId);
  if (!evId) throw new Error('could not create temp event: ' + created.raw);

  // 2. Authorize the new 13/87 split.
  const set = await req('POST', '/api/admin/events/commission-plan', { eventId: evId, plan: 'reduced_13' });
  check('authorize reduced_13 returns 200', set.status === 200 && set.json.success, 'status=' + set.status);
  check('message names the 13/87 split',
    !!(set.json.message && set.json.message.indexOf('13% Unisocials / 87% event owner') >= 0),
    JSON.stringify(set.json.message));
  check('event stamped with reduced_13', set.json.event && set.json.event.commissionPlan === 'reduced_13',
    'plan=' + (set.json.event && set.json.event.commissionPlan));

  // 3. The plan list the admin UI reads now contains reduced_13 (400 named it).
  const bad = await req('POST', '/api/admin/events/commission-plan', { eventId: evId, plan: 'reduced_99' });
  check('unknown plan rejected 400', bad.status === 400, 'status=' + bad.status);
  check('validation lists reduced_13', !!(bad.json.error && bad.json.error.indexOf('reduced_13') >= 0),
    JSON.stringify(bad.json.error));

  // 4. Standard still restores fine (existing behaviour unchanged).
  const back = await req('POST', '/api/admin/events/commission-plan', { eventId: evId, plan: 'standard' });
  check('restore standard works', back.status === 200 && back.json.event.commissionPlan === 'standard',
    JSON.stringify(back.json.message));

  // Re-apply reduced_13 once more, then verify it survives re-read from disk.
  await req('POST', '/api/admin/events/commission-plan', { eventId: evId, plan: 'reduced_13' });
  const list = await req('GET', '/api/admin/events');
  const listed = (list.json.events || []).find(e => String(e.id) === evId);
  check('reduced_13 persists in event list', !!(listed && listed.commissionPlan === 'reduced_13'),
    'plan=' + (listed && listed.commissionPlan));

  // 5. Clean up so preview data stays exactly as it was.
  const del = await req('DELETE', '/api/admin/events?eventId=' + encodeURIComponent(evId));
  check('temp event deleted', del.status === 200 && del.json.success, 'status=' + del.status);

  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? 'RESULT: ' + failed.length + ' FAILED' : 'RESULT: all ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => { console.error('HARNESS ERROR:', err.message); process.exit(1); });