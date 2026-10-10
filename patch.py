from pathlib import Path
root=Path('/mnt/data/event_edit')

for fn in ['admin.html','subadmin.html']:
    p=root/fn; s=p.read_text()
    # button labels
    s=s.replace('onclick="addEventItem()">➕ Add Event</button>', 'onclick="addEventItem()" id="eventSubmitBtn">➕ Add Event</button>', 1)
    marker='<button class="admin-refresh-btn" onclick="loadManagedEvents()">↻ Refresh Events</button>'
    replacement=marker+'\n              <button type="button" class="admin-refresh-btn" id="eventCancelEditBtn" onclick="cancelEditEvent()" style="display:none;">✕ Cancel Edit</button>'
    s=s.replace(marker,replacement,1)
    # Add edit button to event rows. For admin, before notify; for subadmin, before closing action area.
    if fn=='admin.html':
        old='<button class="admin-ticket-copy" onclick="notifySubscribers(\'\\\' + esc(id) + \'\\\', this)" title="Email subscribers about this event">📧</button>'
        # Easier exact substring
        target='<button class="admin-ticket-copy" onclick="notifySubscribers(\' + esc(id) + \' , this)"'
        # use direct literal search around known source
        needle="<button class=\"admin-ticket-copy\" onclick=\"notifySubscribers(\\\'\" + esc(id) + \"\\\', this)\" title=\"Email subscribers about this event\">📧</button>"
        if needle in s:
            s=s.replace(needle, '<button class="admin-ticket-copy" onclick="editManagedEvent(\\\'" + esc(id) + "\\\')" title="Edit event">✏️</button>'+' +\n                '+needle,1)
        else:
            # locate by simple text and insert before notify button line
            idx=s.find("onclick=\"notifySubscribers")
            if idx!=-1:
                line_start=s.rfind('<button',0,idx)
                ins='<button class="admin-ticket-copy" onclick="editManagedEvent(\\\'" + esc(id) + "\\\')" title="Edit event">✏️</button>'
                s=s[:line_start]+ins+' +\n                '+s[line_start:]
    else:
        # subadmin has no action div currently; add one after university span before row close
        needle="'<span style=\"font-size:0.75rem;color:var(--text-3);\">' + esc(ev.universityName || '') + '</span>' +\n                '</div>' +\n                '</div>';"
        if needle in s:
            repl="'<span style=\"font-size:0.75rem;color:var(--text-3);\">' + esc(ev.universityName || '') + '</span>' +\n                '</div>' +\n                '<div style=\"display:flex;gap:6px;align-items:center;\">' +\n                '<button type=\"button\" class=\"admin-ticket-copy\" onclick=\"editManagedEvent(\\\'" + esc(id) + "\\\')\" title=\"Edit event\">✏️</button>' +\n                '</div>' +\n                '</div>';"
            s=s.replace(needle,repl,1)
        else:
            print('subadmin needle not found')
    # Insert editing state/helper immediately before window.addEventItem
    add_marker='      window.addEventItem = function() {'
    if add_marker not in s: print('missing add marker',fn); continue
    helper='''      var editingEventId = '';\n\n      window.cancelEditEvent = function() {\n        editingEventId = '';\n        var btn = document.getElementById('eventSubmitBtn');\n        if (btn) btn.textContent = '➕ Add Event';\n        var cancel = document.getElementById('eventCancelEditBtn');\n        if (cancel) cancel.style.display = 'none';\n        ['evName','evPrice','evVIPPrice','evVVIPPrice','evTablePrice','evDate','evTime','evVenue','evDesc','evTags','evIncludedRegular','evIncludedVip','evIncludedVVIP','evIncludedTable'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });\n        var uni = document.getElementById('evUniversity'); if (uni) uni.value='';\n        if (typeof updateUniCategories === 'function') updateUniCategories();\n        if (typeof clearEventImage === 'function') clearEventImage();\n      };\n\n      window.editManagedEvent = function(eventId) {\n        if (!eventId) return;\n        fetch('/api/events', { headers: authHeaders() })\n          .then(function(r){ return r.json(); })\n          .then(function(data){\n            var events=(data && data.success && data.events)||[];\n            var ev=events.find(function(x){ return String(x.id||x._id||'')===String(eventId); });\n            if (!ev) { showToast('Event not found.', true); return; }\n            editingEventId=String(ev.id||eventId);\n            var set=function(id,val){var e=document.getElementById(id);if(e)e.value=(val==null?'':val);};\n            set('evName',ev.name); set('evPrice',ev.price); set('evVIPPrice',ev.vipPrice); set('evVVIPPrice',ev.vvipPrice); set('evTablePrice',ev.tablePrice);\n            set('evDate',ev.date); set('evTime',ev.time); set('evVenue',ev.venue); set('evDesc',ev.description);\n            set('evTags',Array.isArray(ev.tags)?ev.tags.join(', '):ev.tags);\n            set('evIncludedRegular',ev.includedRegular); set('evIncludedVip',ev.includedVip); set('evIncludedVVIP',ev.includedVVIP); set('evIncludedTable',ev.includedTable);\n            var uni=document.getElementById('evUniversity');\n            if (uni) { uni.value=ev.universityId||''; if (typeof updateUniCategories==='function') updateUniCategories(); var cat=document.getElementById('evCategory'); if(cat) cat.value=ev.category||'General'; }\n            selectedEventImage=ev.image||''; if (typeof setEventImagePreview==='function') setEventImagePreview(selectedEventImage);\n            var btn=document.getElementById('eventSubmitBtn'); if(btn) btn.textContent='💾 Save Event Changes';\n            var cancel=document.getElementById('eventCancelEditBtn'); if(cancel) cancel.style.display='inline-flex';\n            var panel=document.getElementById('panel-events'); if(panel) panel.scrollIntoView({behavior:'smooth',block:'start'});\n            showToast('Editing “'+(ev.name||'event')+'”. Update the fields and save.');\n          })\n          .catch(function(){ showToast('Could not load that event.', true); });\n      };\n\n'''
    s=s.replace(add_marker,helper+add_marker,1)
    # Add id to event object in addEventItem after opening object
    # Need target exact `var ev = {` or `var ev={`
    if fn=='admin.html':
        s=s.replace('var ev = {\n          name: name,', "var ev = {\n          id: editingEventId || undefined,\n          name: name,",1)
    else:
        s=s.replace('var ev = {\n          name: name,', "var ev = {\n          id: editingEventId || undefined,\n          name: name,",1)
    # On successful save, replace clear/refresh area to cancel edit first
    s=s.replace("clearEventImage();\n            loadManagedEvents();", "clearEventImage();\n            cancelEditEvent();\n            loadManagedEvents();",1)
    s=s.replace("clearEventImage();\n            // Refresh event list", "clearEventImage();\n            cancelEditEvent();\n            // Refresh event list",1)
    p.write_text(s)
