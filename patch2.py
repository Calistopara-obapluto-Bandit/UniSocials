from pathlib import Path
import re
root=Path('/mnt/data/event_edit')
helper='''      var editingEventId = '';\n\n      window.cancelEditEvent = function() {\n        editingEventId = '';\n        var btn=document.getElementById('eventSubmitBtn'); if(btn) btn.textContent='➕ Add Event';\n        var cancel=document.getElementById('eventCancelEditBtn'); if(cancel) cancel.style.display='none';\n        ['evName','evPrice','evVIPPrice','evVVIPPrice','evTablePrice','evDate','evTime','evVenue','evDesc','evTags','evIncludedRegular','evIncludedVip','evIncludedVVIP','evIncludedTable'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});\n        var uni=document.getElementById('evUniversity');if(uni)uni.value='';\n        if(typeof updateUniCategories==='function')updateUniCategories();\n        if(typeof clearEventImage==='function')clearEventImage();\n      };\n\n      window.editManagedEvent = function(eventId) {\n        if(!eventId)return;\n        fetch('/api/events',{headers:authHeaders()}).then(function(r){if(r.status===401)throw new Error('Unauthorized');return r.json();}).then(function(data){\n          var events=(data&&data.success&&data.events)||[];\n          var ev=events.find(function(x){return String(x.id||x._id||'')===String(eventId);});\n          if(!ev)throw new Error('Event not found');\n          editingEventId=String(ev.id||eventId);\n          var set=function(id,v){var e=document.getElementById(id);if(e)e.value=(v==null?'':v);};\n          set('evName',ev.name);set('evPrice',ev.price);set('evVIPPrice',ev.vipPrice);set('evVVIPPrice',ev.vvipPrice);set('evTablePrice',ev.tablePrice);\n          set('evDate',ev.date);set('evTime',ev.time);set('evVenue',ev.venue);set('evDesc',ev.description);\n          set('evTags',Array.isArray(ev.tags)?ev.tags.join(', '):ev.tags);\n          set('evIncludedRegular',ev.includedRegular);set('evIncludedVip',ev.includedVip);set('evIncludedVVIP',ev.includedVVIP);set('evIncludedTable',ev.includedTable);\n          var uni=document.getElementById('evUniversity');if(uni){uni.value=ev.universityId||'';if(typeof updateUniCategories==='function')updateUniCategories();var cat=document.getElementById('evCategory');if(cat)cat.value=ev.category||'General';}\n          selectedEventImage=ev.image||'';if(typeof setEventImagePreview==='function')setEventImagePreview(selectedEventImage);\n          var btn=document.getElementById('eventSubmitBtn');if(btn)btn.textContent='💾 Save Event Changes';\n          var cancel=document.getElementById('eventCancelEditBtn');if(cancel)cancel.style.display='inline-flex';\n          var panel=document.getElementById('panel-events');if(panel)panel.scrollIntoView({behavior:'smooth',block:'start'});\n          showToast('Editing “'+(ev.name||'event')+'”. Update the fields and save.');\n        }).catch(function(err){showToast(err.message||'Could not load that event.',true);});\n      };\n\n'''
for fn in ['admin.html','subadmin.html']:
 p=root/fn;s=p.read_text()
 s=s.replace('onclick="addEventItem()">➕ Add Event</button>','onclick="addEventItem()" id="eventSubmitBtn">➕ Add Event</button>',1)
 s=s.replace('<button class="admin-refresh-btn" onclick="loadManagedEvents()">↻ Refresh Events</button>', '<button class="admin-refresh-btn" onclick="loadManagedEvents()">↻ Refresh Events</button>\n              <button type="button" class="admin-refresh-btn" id="eventCancelEditBtn" onclick="cancelEditEvent()" style="display:none;">✕ Cancel Edit</button>',1)
 # insert helper
 s=s.replace('      window.addEventItem = function() {',helper+'      window.addEventItem = function() {',1)
 # add id to event object
 s=s.replace('var ev = {\n          name: name,','var ev = {\n          id: editingEventId || undefined,\n          name: name,',1)
 # admin has `var ev = {` exact; subadmin too
 s=s.replace('var ev = {\n          name: name,','var ev = {\n          id: editingEventId || undefined,\n          name: name,',1)
 # handle both likely spacing variant
 s=s.replace('var ev = {\n          id: editingEventId || undefined,\n          id: editingEventId || undefined,','var ev = {\n          id: editingEventId || undefined,',1)
 # add edit button into event list: find row action area patterns
 if fn=='admin.html':
  needle="'<button class=\"admin-ticket-copy\" onclick=\"notifySubscribers(\\'" + esc(id) + "\\', this)\" title=\"Email subscribers about this event\">📧</button>' +"
  if needle in s:
   s=s.replace(needle, "'<button type=\"button\" class=\"admin-ticket-copy\" onclick=\"editManagedEvent(\\'" + esc(id) + "\\')\" title=\"Edit event\">✏️</button>' +\n                "+needle,1)
  else:
   # exact textual substring insertion before notify button using split
   marker="'<button class=\"admin-ticket-copy\" onclick=\"notifySubscribers("
   pos=s.find(marker)
   if pos!=-1:
    line_start=s.rfind("              ",0,pos)
    # Insert JS expression line
    s=s[:line_start]+"'<button type=\"button\" class=\"admin-ticket-copy\" onclick=\"editManagedEvent(\\'" + esc(id) + "\\')\" title=\"Edit event\">✏️</button>' +\n                "+s[line_start:]
 else:
  marker="                '</div>' +\n                '</div>';"
  pos=s.find(marker)
  if pos!=-1:
   repl="                '</div>' +\n                '<div style=\"display:flex;gap:6px;align-items:center;\">' +\n                '<button type=\"button\" class=\"admin-ticket-copy\" onclick=\"editManagedEvent(\\'" + esc(id) + "\\')\" title=\"Edit event\">✏️</button>' +\n                '</div>' +\n                '</div>';"
   s=s[:pos]+repl+s[pos+len(marker):]
 # reset editing state after successful save: target clearEventImage followed by loadManagedEvents or comment
 s=s.replace('clearEventImage();\n            loadManagedEvents();','clearEventImage();\n            cancelEditEvent();\n            loadManagedEvents();',1)
 s=s.replace('clearEventImage();\n            // Refresh event list','clearEventImage();\n            cancelEditEvent();\n            // Refresh event list',1)
 p.write_text(s)
