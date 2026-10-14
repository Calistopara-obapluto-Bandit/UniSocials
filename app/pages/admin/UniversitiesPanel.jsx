import { useState } from 'react';
import { useAdmin } from './adminContext.js';
import { adminFetch } from './adminApi.js';
import { esc } from '../../lib/utils.jsx';

// Universities manager: each university has its own categories used across the
// site, and events/tickets are scoped per university. The shared list lives in
// the shell's context so the event form, this panel and the subscriber filter
// all read one copy.
export default function UniversitiesPanel({ active }) {
  const { showToast, loadUniversities, loadEvents, universities } = useAdmin();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [state, setState] = useState('');
  const [categoriesRaw, setCategoriesRaw] = useState('');
  const [saving, setSaving] = useState(false);

  async function addUniversity() {
    const trimmedName = name.trim();
    if (!trimmedName) { showToast('University name is required.', true); return; }
    const categories = categoriesRaw.trim()
      ? categoriesRaw.split(',').map((c) => c.trim()).filter(Boolean)
      : ['General'];
    setSaving(true);
    try {
      const data = await adminFetch('/api/admin/universities', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          location: location.trim(),
          state: state.trim(),
          categories
        })
      });
      if (data && data.success) {
        showToast('University "' + trimmedName + '" added!');
        setName(''); setLocation(''); setState(''); setCategoriesRaw('');
        loadUniversities();
      } else {
        showToast((data && data.error) || 'Failed to add university', true);
      }
    } catch (e) {
      showToast('Network error adding university', true);
    } finally {
      setSaving(false);
    }
  }

  async function deleteUniversity(id) {
    if (!id) return;
    if (!window.confirm('Delete this university and all its events? This cannot be undone.')) return;
    try {
      const data = await adminFetch('/api/admin/universities?universityId=' + encodeURIComponent(id), {
        method: 'DELETE'
      });
      if (data && data.success) {
        showToast('University deleted' + (data.eventsDeleted ? ' (' + data.eventsDeleted + ' events removed)' : ''));
        loadUniversities();
        loadEvents();
      } else {
        showToast((data && data.error) || 'Failed to delete university', true);
      }
    } catch (e) {
      showToast('Network error deleting university', true);
    }
  }

  return (
    <div className={'admin-panel' + (active ? ' active' : '')} id="panel-universities">
      <div className="admin-panel-heading">
        <div>
          <h1>🏛 Universities Manager</h1>
          <p>Add or remove universities. Each university has its own categories used across the site. Events and tickets are scoped per university.</p>
        </div>
      </div>
      <div className="admin-scan-panel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, marginBottom: 14 }}>
          <div className="form-group">
            <label htmlFor="uniName">University Name</label>
            <input type="text" id="uniName" placeholder="e.g. University of Lagos"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="uniLocation">Location</label>
            <input type="text" id="uniLocation" placeholder="e.g. Akoka, Lagos"
              value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="uniState">State</label>
            <input type="text" id="uniState" placeholder="e.g. Lagos"
              value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="uniCategories">Categories (comma separated)</label>
            <input type="text" id="uniCategories" placeholder="Law, Medicine, Social Sciences, Engineering, General"
              value={categoriesRaw} onChange={(e) => setCategoriesRaw(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-submit" style={{ whiteSpace: 'nowrap' }} disabled={saving} onClick={addUniversity}>
            ➕ Add University
          </button>
          <button className="admin-refresh-btn" onClick={loadUniversities}>↻ Refresh</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', alignSelf: 'center' }}>
            {universities.length} universit{universities.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="admin-ticket-codes" style={{ marginTop: 14 }}>
          {universities.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: '0.85rem' }}>
              No universities added yet. Add your first university above.
            </div>
          ) : (
            <>
              <div className="admin-ticket-codes-label">🏛 Saved Universities ({universities.length})</div>
              {universities.map((uni) => {
                const id = String(uni.id || uni._id || '').replace(/[^a-zA-Z0-9_-]/g, '');
                return (
                  <div className="admin-ticket-code" key={id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 0' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
                      <strong>{esc(uni.name)}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                        {esc(uni.location || '')}{uni.state ? ', ' + esc(uni.state) : ''}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                        Categories: {esc((uni.categories || []).join(', ') || '—')}
                      </span>
                    </div>
                    <button className="admin-ticket-copy" onClick={() => deleteUniversity(id)}
                      title="Delete university" style={{ color: '#B71C1C', borderColor: '#F5C6CB' }}>✕</button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
