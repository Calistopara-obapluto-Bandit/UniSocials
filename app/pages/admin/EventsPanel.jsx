import { useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch, changeCommissionPlan, planInfo, COMMISSION_PLANS } from './adminApi.js';
import { esc, fmtN } from '../../lib/utils.jsx';

// Downscale + JPEG-compress an uploaded picture so the inline data URL stays
// comfortably below the server's request-body limit. Ported from admin.html's
// resizeImageFile().
function resizeImageFile(file, maxSize = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        let quality = 0.78;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 800000 && quality > 0.45) {
          quality -= 0.05;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > 800000) {
          const smaller = Math.max(640, Math.round(maxSize * 0.75));
          const scale = smaller / Math.max(width, height);
          const w2 = Math.max(1, Math.round(width * scale));
          const h2 = Math.max(1, Math.round(height * scale));
          canvas.width = w2;
          canvas.height = h2;
          ctx.drawImage(img, 0, 0, w2, h2);
          dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        }
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

const EMPTY_EVENT = {
  name: '', universityId: '', category: 'General',
  price: '', bonusPrice: '', vipPrice: '', bonusVipPrice: '',
  vvipPrice: '', bonusVvipPrice: '', tablePrice: '', bonusTablePrice: '',
  regularTicketLimit: '', vipTicketLimit: '', vvipTicketLimit: '', tableTicketLimit: '',
  date: '', time: '', venue: '', description: '', tags: '',
  includedRegular: '', includedVip: '', includedVVIP: '', includedTable: ''
};

const NUM_KEYS = [
  'price', 'bonusPrice', 'vipPrice', 'bonusVipPrice', 'vvipPrice', 'bonusVvipPrice',
  'tablePrice', 'bonusTablePrice', 'regularTicketLimit', 'vipTicketLimit',
  'vvipTicketLimit', 'tableTicketLimit'
];

function numKey(k, v) {
  if (v === '') return 0;
  return k.indexOf('TicketLimit') > -1 ? (parseInt(v, 10) || 0) : (parseFloat(v) || 0);
}

// Safe image src: only absolute URLs, root-relative paths or inline data images.
function safeImg(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v || /^(?:https?:\/\/|\/[^\/]|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*)$/.test(v)) return v;
  return '';
}

// Events manager: add/edit/archive/notify/delete events. New events appear
// instantly on the Events, Tickets and Home pages for buyers.
export default function EventsPanel() {
  const { showToast, loadOrders, loadEvents, events, universities, loadUniversities } = useAdmin();
  const [form, setForm] = useState(EMPTY_EVENT);
  const [editingId, setEditingId] = useState('');
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUniversities();
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uni = universities.find((u) => u.id === form.universityId);
  const categories = (uni && uni.categories && uni.categories.length) ? uni.categories : ['General'];

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function selectUniversity(id) {
    // Mirror legacy updateUniCategories(): the category list follows the chosen
    // university and the selection resets to its first category.
    const selected = universities.find((u) => u.id === id);
    const cats = (selected && selected.categories && selected.categories.length)
      ? selected.categories
      : ['General'];
    setForm((f) => ({ ...f, universityId: id, category: cats[0] }));
  }

  function handleImage(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) { setImage(''); return; }
    if (!/^image\//.test(file.type || '')) {
      showToast('Please choose an image file.', true);
      e.target.value = '';
      return;
    }
    resizeImageFile(file)
      .then((dataUrl) => setImage(dataUrl))
      .catch(() => {
        setImage('');
        showToast('Could not prepare that image. Try another file.', true);
        e.target.value = '';
      });
  }

  function cancelEdit() {
    setEditingId('');
    setForm(EMPTY_EVENT);
    setImage('');
    const inp = document.getElementById('ev-image-file');
    if (inp) inp.value = '';
  }

  async function submitEvent() {
    const name = form.name.trim();
    const category = form.category || 'General';
    const date = form.date.trim();
    const venue = form.venue.trim();
    const uniId = form.universityId;
    const selected = universities.find((u) => u.id === uniId);

    if (!uniId) { showToast('Please select a university for this event.', true); return; }
    if (!name || !category || !date || !venue) {
      showToast('Event Name, Category, Date, and Venue are required.', true);
      return;
    }

    const ev = {
      id: editingId || undefined,
      name,
      category,
      includedRegular: form.includedRegular.trim(),
      includedVip: form.includedVip.trim(),
      includedVVIP: form.includedVVIP.trim(),
      includedTable: form.includedTable.trim(),
      date,
      time: form.time.trim(),
      venue,
      description: form.description.trim(),
      image,
      tags: form.tags.trim()
        ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      universityId: uniId,
      universityName: selected ? selected.name : '',
      universitySlug: selected ? (selected.slug || selected.id) : ''
    };
    NUM_KEYS.forEach((k) => { ev[k] = numKey(k, form[k]); });

    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/events', {
        method: 'POST',
        body: JSON.stringify(ev)
      });
      if (data && data.success) {
        showToast(editingId ? 'Event "' + name + '" updated successfully!' : 'Event "' + name + '" added!');
        cancelEdit();
        loadEvents();
        loadOrders();
      } else {
        showToast((data && data.error) || 'Failed to add event', true);
      }
    } catch (e) {
      showToast('Network error adding event', true);
    } finally {
      setSaving(false);
    }
  }

  function editEvent(id) {
    const ev = events.find((x) => String(x.id || x._id || '') === String(id));
    if (!ev) return;
    setEditingId(String(ev.id || id));
    const next = {};
    Object.keys(EMPTY_EVENT).forEach((k) => { next[k] = ''; });
    next.name = ev.name || '';
    next.universityId = ev.universityId || '';
    next.category = ev.category || 'General';
    next.date = ev.date || '';
    next.time = ev.time || '';
    next.venue = ev.venue || '';
    next.description = ev.description || '';
    next.tags = Array.isArray(ev.tags) ? ev.tags.join(', ') : (ev.tags || '');
    next.includedRegular = ev.includedRegular || '';
    next.includedVip = ev.includedVip || '';
    next.includedVVIP = ev.includedVVIP || '';
    next.includedTable = ev.includedTable || '';
    ['price', 'bonusPrice', 'vipPrice', 'bonusVipPrice', 'vvipPrice', 'bonusVvipPrice',
      'tablePrice', 'bonusTablePrice', 'regularTicketLimit', 'vipTicketLimit',
      'vvipTicketLimit', 'tableTicketLimit'].forEach((k) => {
      const v = ev[k];
      next[k] = v == null ? '' : String(v);
    });
    setForm(next);
    setImage(ev.image || '');
    showToast('Editing “' + (ev.name || 'event') + '”. Update the fields and save.');
    const panel = document.getElementById('panel-events');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteEvent(id) {
    if (!id) return;
    if (!window.confirm('Delete this event? This cannot be undone.')) return;
    try {
      const data = await adminFetch('/api/admin/events?eventId=' + encodeURIComponent(id), {
        method: 'DELETE'
      });
      if (data && data.success) {
        showToast('Event deleted' + (data.ordersDeleted > 0 ? ' — ' + data.ordersDeleted + ' related order(s) removed too' : ''));
        loadEvents();
        loadOrders();
      } else {
        showToast((data && data.error) || 'Failed to delete event', true);
      }
    } catch (e) {
      showToast('Network error deleting event', true);
    }
  }

  async function toggleArchive(ev) {
    const id = String(ev.id || ev._id || '');
    const archived = !ev.archived;
    if (!window.confirm((archived ? 'Archive' : 'Unarchive') + ' this event?')) return;
    try {
      const data = await adminFetch('/api/admin/events/archive', {
        method: 'POST',
        body: JSON.stringify({ eventId: id, archived })
      });
      if (data && data.success) {
        showToast(archived ? 'Event archived' : 'Event unarchived');
        loadEvents();
      } else {
        showToast((data && data.error) || 'Could not change event status', true);
      }
    } catch (e) {
      showToast('Network error changing event status', true);
    }
  }

  async function notifySubscribers(ev) {
    const id = String(ev.id || ev._id || '');
    if (!window.confirm('Send an email notification about this event to all subscribers of its university?')) return;
    try {
      const data = await adminFetch('/api/admin/events/notify', {
        method: 'POST',
        body: JSON.stringify({ eventId: id })
      });
      if (data && data.success) showToast('Notification sent to ' + (data.notified || 0) + ' subscriber(s)');
      else showToast((data && data.error) || 'Failed to send notification', true);
    } catch (e) {
      showToast('Network error sending notification', true);
    }
  }

  async function setPlan(eventId, next) {
    await changeCommissionPlan(eventId, next, showToast, () => {
      loadEvents();
      loadOrders();
    });
  }

  const num = (key, label, placeholder) => (
    <div className="form-group" key={key}>
      <label htmlFor={'ev-' + key}>{label}</label>
      <input
        type="number" id={'ev-' + key} min="0" placeholder={placeholder}
        value={form[key]}
        onChange={(e) => setField(key, e.target.value)}
      />
    </div>
  );

  const wide = (key, label, placeholder) => (
    <div className="form-group" style={{ gridColumn: '1/-1' }} key={key}>
      <label htmlFor={'ev-' + key}>{label}</label>
      <input
        type="text" id={'ev-' + key} placeholder={placeholder}
        value={form[key]}
        onChange={(e) => setField(key, e.target.value)}
      />
    </div>
  );

  return (
    <div className="admin-panel" id="panel-events">
      <div className="admin-panel-heading">
        <div>
          <h1>🎤 Manage Events</h1>
          <p>Add or remove events. New events appear instantly on the Events page, Tickets page, and Home page for buyers.</p>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="ev-name">Event Name</label>
            <input type="text" id="ev-name" placeholder="e.g. Medical Dinner Night"
              value={form.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="ev-university">University</label>
            <select id="ev-university" value={form.universityId} onChange={(e) => selectUniversity(e.target.value)}>
              <option value="">Select university...</option>
              {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="ev-category">Category</label>
            <select id="ev-category" value={form.category} onChange={(e) => setField('category', e.target.value)}>
              {(categories.length ? categories : ['General']).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          {num('price', 'Regular Price (₦)', '3000')}
          {num('bonusPrice', 'Regular Bonus Price (₦)', 'e.g. 3600')}
          {num('vipPrice', 'VIP Price (₦) — optional', 'e.g. 8000')}
          {num('bonusVipPrice', 'VIP Bonus Price (₦)', 'e.g. 7200')}
          {num('vvipPrice', 'VVIP Price (₦) — optional', 'e.g. 10000')}
          {num('bonusVvipPrice', 'VVIP Bonus Price (₦)', 'e.g. 9000')}
          {num('tablePrice', 'Table Price (₦) — optional', 'e.g. 50000')}
          {num('bonusTablePrice', 'Table Bonus Price (₦)', 'e.g. 45000')}
          {num('regularTicketLimit', 'Regular Tickets Available', 'e.g. 1000')}
          {num('vipTicketLimit', 'VIP Tickets Available', 'e.g. 200')}
          {num('vvipTicketLimit', 'VVIP Tickets Available', 'e.g. 100')}
          {num('tableTicketLimit', 'Table Tickets Available', 'e.g. 20')}
          <div className="form-group">
            <label htmlFor="ev-date">Date</label>
            <input type="text" id="ev-date" placeholder="May 20, 2025"
              value={form.date} onChange={(e) => setField('date', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="ev-time">Time</label>
            <input type="text" id="ev-time" placeholder="6:00 PM"
              value={form.time} onChange={(e) => setField('time', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="ev-venue">Venue</label>
            <input type="text" id="ev-venue" placeholder="e.g. Enugu Sports Field"
              value={form.venue} onChange={(e) => setField('venue', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="ev-description">Description</label>
            <input type="text" id="ev-description" placeholder="Short description of the event..."
              value={form.description} onChange={(e) => setField('description', e.target.value)} />
          </div>
          <div className="form-group" style={{ gridColumn: '1/-1' }}>
            <label htmlFor="ev-image-file">Event Picture</label>
            <input type="file" id="ev-image-file" accept="image/*" onChange={handleImage} />
            {image ? (
              <div style={{ marginTop: 10 }}>
                <img alt="Event image preview" src={image}
                  style={{ display: 'block', width: '100%', maxWidth: 320, height: 160, objectFit: 'cover', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg)' }} />
              </div>
            ) : null}
          </div>
          {wide('tags', 'Tags (comma separated)', '🎶 Live Music, 🎤 DJ')}
          {wide('includedRegular', "What's Included — Regular (comma separated)", 'Standard entry, Welcome drink')}
          {wide('includedVip', "What's Included — VIP (comma separated)", 'VIP lounge access, Meet & greet, VIP parking')}
          {wide('includedVVIP', "What's Included — VVIP (comma separated)", 'VVIP lounge access, premium seating, concierge service')}
          {wide('includedTable', "What's Included — Table (comma separated)", 'Reserved table for 8, Waitress service, Bottled beverage')}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-submit" style={{ whiteSpace: 'nowrap' }} disabled={saving} onClick={submitEvent}>
            {editingId ? '💾 Save Event Changes' : '➕ Add Event'}
          </button>
          <button className="admin-refresh-btn" onClick={loadEvents}>↻ Refresh Events</button>
          {editingId ? (
            <button type="button" className="admin-refresh-btn" onClick={cancelEdit}>✕ Cancel Edit</button>
          ) : null}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', alignSelf: 'center' }}>
            {events.length} event{events.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>
              No events added yet. Add your first event above.
            </div>
          ) : (
            <>
              <div className="admin-ticket-codes-label">📋 Saved Events ({events.length})</div>
              {events.map((ev) => (
                <EventRow
                  key={String(ev.id || ev._id)}
                  ev={ev}
                  onEdit={() => editEvent(String(ev.id || ev._id || ''))}
                  onDelete={() => deleteEvent(String(ev.id || ev._id || ''))}
                  onArchive={() => toggleArchive(ev)}
                  onNotify={() => notifySubscribers(ev)}
                  onPlan={(next) => setPlan(String(ev.id || ev._id || ''), next)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EventRow({ ev, onEdit, onDelete, onArchive, onNotify, onPlan }) {
  const id = String(ev.id || ev._id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const vip = parseFloat(ev.vipPrice || 0) || 0;
  const bonusVip = parseFloat(ev.bonusVipPrice || 0) || 0;
  const vvip = parseFloat(ev.vvipPrice || 0) || 0;
  const bonusVvip = parseFloat(ev.bonusVvipPrice || 0) || 0;
  const bonus = parseFloat(ev.bonusPrice || 0) || 0;
  const table = parseFloat(ev.tablePrice || 0) || 0;
  const bonusTable = parseFloat(ev.bonusTablePrice || 0) || 0;
  const reg = parseFloat(ev.price || 0) || 0;
  const plan = planInfo(ev.commissionPlan);

  const priceHtml = bonus > 0
    ? (<>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', textDecoration: 'line-through' }}>₦{Number(ev.price || 0).toLocaleString()}</span>{' '}
        <strong style={{ fontSize: '0.78rem' }}>₦{bonus.toLocaleString()}</strong>
      </>)
    : (reg > 0
      ? <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>₦{Number(ev.price || 0).toLocaleString()}</span>
      : <strong style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>FREE</strong>);

  const tierHtml = (label, v, bv) => v > 0
    ? (
      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
        {label}{' '}
        {bv > 0
          ? <><s>₦{v.toLocaleString()}</s> <strong>₦{bv.toLocaleString()}</strong></>
          : <>₦{v.toLocaleString()}</>}
      </span>
    )
    : null;

  return (
    <div className="admin-ticket-code" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
        <span style={{ width: 46, height: 46, borderRadius: 12, overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-ghost)', border: '1px solid var(--accent-border)', flexShrink: 0 }}>
          {safeImg(ev.image)
            ? <img src={safeImg(ev.image)} alt={ev.name || 'Event image'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : esc(ev.icon || '🎤')}
        </span>
        <strong>{esc(ev.name)}</strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(ev.category)}</span>
        {priceHtml}
        {tierHtml('VIP', vip, bonusVip)}
        {tierHtml('VVIP', vvip, bonusVvip)}
        {tierHtml('Table', table, bonusTable)}
        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(ev.date || '')}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{esc(ev.universityName || '')}</span>
        <select
          value={plan.value}
          onChange={(e) => onPlan(e.target.value)}
          title="Platform split on direct sales: 20%, 15% or 10% to Unisocials"
          style={{ fontSize: '0.72rem', fontWeight: 700, padding: '5px 6px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer', maxWidth: 170 }}
        >
          {COMMISSION_PLANS.map((p) => (
            <option key={p.value} value={p.value}>{p.fee}% Unisocials / {p.owner}% owner</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className="admin-ticket-copy" onClick={onEdit} title="Edit event" data-ev-edit={id}>✏️</button>
        <button type="button" className="admin-ticket-copy" onClick={onArchive}
          title={ev.archived ? 'Unarchive event' : 'Archive event'}>
          {ev.archived ? '📦' : '🗃️'}
        </button>
        <button className="admin-ticket-copy" onClick={onNotify} title="Email subscribers about this event">📧</button>
        <button className="admin-ticket-copy" onClick={onDelete} title="Delete event" style={{ color: '#B71C1C', borderColor: '#F5C6CB' }}>✕</button>
      </div>
    </div>
  );
}
