from pathlib import Path
import re
p=Path('/mnt/data/unisocials_work')

# server permission
f=p/'server.js'; s=f.read_text()
s=s.replace("if (authCtx.role === 'subadmin' && target.createdBy && target.createdBy !== authCtx.user.id)", "if (authCtx.role === 'subadmin' && target.role !== 'influencer' && target.createdBy && target.createdBy !== authCtx.user.id)")
f.write_text(s)

# subadmin
f=p/'subadmin.html'; s=f.read_text()
s=s.replace("fetch('/api/events', {\n          headers: authHeaders()\n        })", "fetch('/api/events?includeArchived=1', {\n          headers: authHeaders()\n        })", 1)
# Replace influencer list loop block between var html and container.innerHTML
pat=re.compile(r"          var html='';\n          list\.forEach\(function\(u\)\{.*?\n          container\.innerHTML=html;", re.S)
rep="""          var html='';
          list.forEach(function(u){
            var st=u.referralStats||{}, archived=!!u.archived;
            html+='<div class="admin-ticket-code" data-account-email="'+esc(u.email||'')+'" style="padding:14px 0;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr auto;gap:10px;">'
              +'<div><div style="font-weight:700;color:var(--text-1);">'+esc(u.name||u.email||'Influencer')+(archived?' <span style="font-size:.68rem;color:#b71c1c;border:1px solid #f5c6cb;border-radius:999px;padding:2px 7px;">ARCHIVED</span>':'')+'</div>'
              +'<div style="font-size:.78rem;color:var(--text-3);margin-top:3px;">'+esc(u.email||'')+'</div>'
              +'<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;"><span class="admin-ticket-code">Code: '+esc(u.referralCode||'—')+'</span><span style="font-size:.75rem;color:var(--text-3);">'+Number(st.totalTickets||0).toLocaleString()+' tickets</span><span style="font-size:.75rem;color:var(--text-3);">'+Number(st.totalOrders||0).toLocaleString()+' orders</span><span style="font-size:.75rem;color:var(--text-3);">₦'+Number(st.totalRevenue||0).toLocaleString()+' revenue</span><span style="font-size:.75rem;color:var(--text-3);">'+Number(st.uniquePeople||0).toLocaleString()+' people</span></div></div>'
              +'<div><button type="button" class="admin-ticket-copy" data-account-toggle="1" data-email="'+esc(u.email||'')+'" data-archived="'+(archived?'1':'0')+'" title="'+(archived?'Unarchive influencer':'Archive influencer')+'">'+(archived?'📦':'🗃️')+'</button></div></div>';
          });
          container.innerHTML=html;
          container.querySelectorAll('[data-account-toggle]').forEach(function(btn){
            btn.addEventListener('click',function(){
              var email=btn.getAttribute('data-email')||'', archived=btn.getAttribute('data-archived')==='1';
              if(!email)return;
              if(!confirm((archived?'Unarchive':'Archive')+' influencer '+email+'?'))return;
              fetch('/api/admin/accounts/archive',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({email:email,archived:!archived})})
                .then(function(r){return r.json();}).then(function(d){if(d&&d.success){showToast(archived?'Influencer unarchived':'Influencer archived');loadAllInfluencers();}else showToast((d&&d.error)||'Could not change influencer status',true);})
                .catch(function(){showToast('Network error changing influencer status',true);});
            });
          });"""
s,n=pat.subn(rep,s,count=1)
if n!=1: raise SystemExit('subadmin influencer replace failed')
# event renderer badge and button
s=s.replace("'<strong>' + esc(ev.name) + '</strong>' +", "'<strong>' + esc(ev.name) + '</strong>' +\n                (ev.archived ? '<span style=\"font-size:.68rem;color:#b71c1c;border:1px solid #f5c6cb;border-radius:999px;padding:2px 7px;\">ARCHIVED</span>' : '') +",1)
needle="                '<button type=\"button\" class=\"admin-ticket-copy\" onclick=\"editManagedEvent(\\\'' + esc(id) + '\\\')\" title=\"Edit event\">✏️</button>' +"
if needle not in s: raise SystemExit('subadmin event edit line missing')
s=s.replace(needle, needle+"\n                '<button type=\"button\" class=\"admin-ticket-copy\" data-event-toggle=\"1\" data-event-id=\"' + esc(id) + '\" data-archived=\"' + (ev.archived ? '1' : '0') + '\" title=\"' + (ev.archived ? 'Unarchive event' : 'Archive event') + '\">' + (ev.archived ? '📦' : '🗃️') + '</button>' +",1)
needle2="            container.innerHTML = html;\n          })\n          .catch(function(err) {"
rep2="""            container.innerHTML = html;
            container.querySelectorAll('[data-event-toggle]').forEach(function(btn){
              btn.addEventListener('click',function(){
                var eventId=btn.getAttribute('data-event-id')||'', archived=btn.getAttribute('data-archived')==='1';
                if(!eventId)return;
                if(!confirm((archived?'Unarchive':'Archive')+' this event?'))return;
                fetch('/api/admin/events/archive',{method:'POST',headers:authHeaders(),body:JSON.stringify({eventId:eventId,archived:!archived})})
                  .then(function(r){return r.json();}).then(function(d){if(d&&d.success){showToast(archived?'Event unarchived':'Event archived');loadManagedEvents();}else showToast((d&&d.error)||'Could not change event status',true);})
                  .catch(function(){showToast('Network error changing event status',true);});
              });
            });
          })
          .catch(function(err) {"""
s=s.replace(needle2,rep2,1)
# no-op old script
start=s.find('<script id="archive-controls-ui">')
if start!=-1:
    end=s.find('</script>',start)+len('</script>')
    s=s[:start]+'<script id="archive-controls-ui"><!-- archive controls are rendered directly by the managers --></script>'+s[end:]
f.write_text(s)

# admin direct UI
f=p/'admin.html'; s=f.read_text()
s=s.replace("'<strong>' + esc(ev.name) + '</strong>' +", "'<strong>' + esc(ev.name) + '</strong>' +\n                (ev.archived ? '<span style=\"font-size:.68rem;color:#b71c1c;border:1px solid #f5c6cb;border-radius:999px;padding:2px 7px;\">ARCHIVED</span>' : '') +",1)
needle="                '<button class=\"admin-ticket-copy\" onclick=\"notifySubscribers(\\\'' + esc(id) + '\\\', this)\" title=\"Email subscribers about this event\">📧</button>' +"
if needle not in s: raise SystemExit('admin notify missing')
s=s.replace(needle,needle+"\n                '<button type=\"button\" class=\"admin-ticket-copy\" data-event-toggle=\"1\" data-event-id=\"' + esc(id) + '\" data-archived=\"' + (ev.archived ? '1' : '0') + '\" title=\"' + (ev.archived ? 'Unarchive event' : 'Archive event') + '\">' + (ev.archived ? '📦' : '🗃️') + '</button>' +",1)
# badges
s=s.replace("'<strong>' + esc(u.name || '—') + '</strong>' +", "'<strong>' + esc(u.name || '—') + '</strong>' + (u.archived ? '<span style=\"font-size:.68rem;color:#b71c1c;border:1px solid #f5c6cb;border-radius:999px;padding:2px 7px;\">ARCHIVED</span>' : '') +",1)
s=s.replace("<div class=\"admin-ticket-codes-label\">🔑 Active Sub-Admins", "<div class=\"admin-ticket-codes-label\">🔑 Sub-Admins",1)
s=s.replace("<div class=\"admin-ticket-codes-label\">📣 Active Influencers", "<div class=\"admin-ticket-codes-label\">📣 Influencers",1)
s=s.replace("'<span>📣</span><strong>' + esc(u.name || '—') + '</strong>'", "'<span>📣</span><strong>' + esc(u.name || '—') + '</strong>' + (u.archived ? '<span style=\"font-size:.68rem;color:#b71c1c;border:1px solid #f5c6cb;border-radius:999px;padding:2px 7px;\">ARCHIVED</span>' : '')",1)
s=s.replace("'<strong>'+esc(u.name||'—')+'</strong> <span", "'<strong>'+esc(u.name||'—')+'</strong>'+(u.archived?'<span style=\"font-size:.68rem;color:#b71c1c;border:1px solid #f5c6cb;border-radius:999px;padding:2px 7px;margin-left:6px;\">ARCHIVED</span>':'')+' <span",1)
# Add toggle buttons by replacing action div endings with known strings
s=s.replace("'<div style=\"display:flex;gap:6px;align-items:flex-start;\"><button class=\"admin-ticket-copy\" onclick=\"resetManagedPassword(\\\'' + esc(u.email || id) + '\\\')\" title=\"Reset password\">🔑</button><button class=\"admin-ticket-copy\" onclick=\"deleteSubAdmin(\\\'' + esc(u.email || id) + '\\\')\" title=\"Remove sub-admin\" style=\"color:#B71C1C;border-color:#F5C6CB;\">✕</button></div>' +", "'<div style=\"display:flex;gap:6px;align-items:flex-start;\"><button class=\"admin-ticket-copy\" onclick=\"resetManagedPassword(\\\'' + esc(u.email || id) + '\\\')\" title=\"Reset password\">🔑</button><button class=\"admin-ticket-copy\" onclick=\"deleteSubAdmin(\\\'' + esc(u.email || id) + '\\\')\" title=\"Remove sub-admin\" style=\"color:#B71C1C;border-color:#F5C6CB;\">✕</button><button type=\"button\" class=\"admin-ticket-copy\" data-account-toggle=\"1\" data-email=\"' + esc(u.email || id) + '\" data-archived=\"' + (u.archived ? '1' : '0') + '\" title=\"' + (u.archived ? 'Unarchive account' : 'Archive account') + '\">' + (u.archived ? '📦' : '🗃️') + '</button></div>' +",1)
s=s.replace("'</button></div></div>';", "'</button><button type=\"button\" class=\"admin-ticket-copy\" data-account-toggle=\"1\" data-email=\"' + esc(u.email || '') + '\" data-archived=\"' + (u.archived ? '1' : '0') + '\" title=\"' + (u.archived ? 'Unarchive influencer' : 'Archive influencer') + '\">' + (u.archived ? '📦' : '🗃️') + '</button></div></div>';",1)
s=s.replace("'</button></div></div>';", "'</button><button type=\"button\" class=\"admin-ticket-copy\" data-account-toggle=\"1\" data-email=\"' + esc(u.email || '') + '\" data-archived=\"' + (u.archived ? '1' : '0') + '\" title=\"' + (u.archived ? 'Unarchive account' : 'Archive account') + '\">' + (u.archived ? '📦' : '🗃️') + '</button></div></div>';",1)
# replace old archive script
start=s.find('<script id="archive-controls-ui">')
if start!=-1:
    end=s.find('</script>',start)+len('</script>')
    script="""<script id=\"archive-controls-ui\">\n(function(){\nfunction token(){return typeof getToken==='function'?getToken():'';}\nfunction headers(){return {'Content-Type':'application/json','Authorization':'Bearer '+token()};}\nfunction bind(){\n document.querySelectorAll('[data-event-toggle]:not([data-bound])').forEach(function(btn){btn.setAttribute('data-bound','1');btn.addEventListener('click',function(){var id=btn.getAttribute('data-event-id')||'',a=btn.getAttribute('data-archived')==='1';if(!id)return;if(!confirm((a?'Unarchive':'Archive')+' this event?'))return;fetch('/api/admin/events/archive',{method:'POST',headers:headers(),body:JSON.stringify({eventId:id,archived:!a})}).then(function(r){return r.json();}).then(function(d){if(d&&d.success){showToast(a?'Event unarchived':'Event archived');loadManagedEvents();}else showToast((d&&d.error)||'Could not change event status',true);}).catch(function(){showToast('Network error changing event status',true);});});});\n document.querySelectorAll('[data-account-toggle]:not([data-bound])').forEach(function(btn){btn.setAttribute('data-bound','1');btn.addEventListener('click',function(){var email=btn.getAttribute('data-email')||'',a=btn.getAttribute('data-archived')==='1';if(!email)return;if(!confirm((a?'Unarchive':'Archive')+' '+email+'?'))return;fetch('/api/admin/accounts/archive',{method:'POST',headers:headers(),body:JSON.stringify({email:email,archived:!a})}).then(function(r){return r.json();}).then(function(d){if(d&&d.success){showToast(a?'Account unarchived':'Account archived');loadSubAdmins();loadStaffAccounts();loadInfluencers();}else showToast((d&&d.error)||'Could not change account status',true);}).catch(function(){showToast('Network error changing account status',true);});});});\n}\nnew MutationObserver(bind).observe(document.body,{subtree:true,childList:true});setTimeout(bind,300);\n})();\n</script>"""
    s=s[:start]+script+s[end:]
f.write_text(s)
