// app.js
// Loaded as an external same-origin script (not inline), and every action is
// bound via addEventListener - never via onclick="" attributes. This is what
// lets the server's strict Content-Security-Policy (script-src 'self', no
// unsafe-inline) actually work: inline scripts/handlers are blocked by design,
// and this file, being an external same-origin resource, is allowed.
//
// This file makes no security decisions of its own - it only calls the API
// and displays results. Every real check (validity, ownership, auth, rate
// limits) happens server-side; see src/validate.js, src/auth.js, src/api.js.

let ME = null;
let currentInbox = [];
let authMode = 'login';

function initial(name){ return (name||'?').trim()[0]?.toUpperCase() || '?'; }
function fmtTime(ts){ return new Date(ts*1000).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }

// Escape any server-returned text before inserting into innerHTML - defense in
// depth against stored XSS, even though the server also strips markup on save.
function esc(str){
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function switchAuthTab(mode){
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
}

async function submitAuth(){
  const product = document.getElementById('authProduct').value;
  const identifier = document.getElementById('authIdentifier').value.trim();
  const password = document.getElementById('authPassword').value;
  const msgEl = document.getElementById('authMsg');
  msgEl.textContent = '';
  try{
    const res = await fetch(`${API_BASE}/auth/${authMode}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ product, identifier, password })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed');
    await enterApp();
  }catch(e){ msgEl.textContent = e.message; }
}

function showForgot(){ document.getElementById('forgotBox').classList.add('show'); }

async function requestReset(){
  const product = document.getElementById('forgotProduct').value;
  const identifier = document.getElementById('forgotIdentifier').value.trim();
  const contact = document.getElementById('forgotContact').value.trim();
  const msgEl = document.getElementById('forgotMsg');
  try{
    await fetch(`${API_BASE}/reset-request`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ product, identifier, contact })
    });
    msgEl.style.color = 'var(--teal-dark)';
    msgEl.textContent = 'Request bhej diya gaya hai. Admin aapse contact karega naya password ke saath.';
  }catch(e){ msgEl.style.color='var(--accent-red)'; msgEl.textContent = 'Kuch galat ho gaya.'; }
}

async function enterApp(){
  const meRes = await fetch(`${API_BASE}/auth/me`, { credentials:'include' });
  if(!meRes.ok){ return; }
  ME = await meRes.json();
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  document.getElementById('acctSub').textContent = `${ME.identifier} - ${ME.product}`;
  document.getElementById('acctAvatar').textContent = initial(ME.identifier);
  document.getElementById('acctName').textContent = ME.identifier.split('@')[0];
  await loadInbox();
}

async function loadInbox(){
  try{
    const res = await fetch(`${API_BASE}/messages`, { credentials:'include' });
    if(!res.ok) throw new Error('session expired');
    currentInbox = await res.json();
    renderList();
  }catch(e){
    document.getElementById('listScroll').innerHTML = `<div class="empty">Session expire ho gayi, dobara login karein.</div>`;
  }
}

async function logout(){
  await fetch(`${API_BASE}/auth/logout`, { method:'POST', credentials:'include' });
  location.reload();
}

function renderList(){
  document.getElementById('inboxCount').textContent = currentInbox.length || '';
  const wrap = document.getElementById('listScroll');
  if(currentInbox.length===0){ wrap.innerHTML = `<div class="empty">Is inbox me abhi koi message nahi hai.</div>`; return; }
  wrap.innerHTML = `<div class="list-group-label">Primary</div>` + currentInbox.map((m)=>`
    <div class="msg-item" data-id="${esc(m.id)}">
      <div class="av">${esc(initial(m.from))}</div>
      <div class="body">
        <div class="row1">
          <div class="from">${esc(m.from)}${!m.read?'<span class="badge">new</span>':''}</div>
          <div class="time">${esc(fmtTime(m.ts))}</div>
        </div>
        <div class="subj">${esc(m.subject)}</div>
      </div>
    </div>
  `).join('');
}

async function openThread(id, clickedEl){
  document.querySelectorAll('.msg-item').forEach(el=>el.classList.remove('selected'));
  if (clickedEl) clickedEl.classList.add('selected');
  const res = await fetch(`${API_BASE}/message/${encodeURIComponent(id)}`, { credentials:'include' });
  if(!res.ok){ document.getElementById('readPane').innerHTML = `<div class="no-selection">Ye message nahi khul saka.</div>`; return; }
  const msg = await res.json();
  document.getElementById('readPane').innerHTML = `
    <div class="read-toolbar">
      <span>Reply</span><span>Forward</span><span>Star</span><span>Delete</span>
      <div class="spacer"></div>
      <span class="thread-time">${esc(fmtTime(msg.ts))}</span>
    </div>
    <div class="read-scroll">
      <div class="summary-box"><div class="label">Summary</div>${esc(msg.subject)}</div>
      <div class="thread-msg">
        <div class="head">
          <div class="av">${esc(initial(msg.from))}</div>
          <div class="who">
            <div class="name">${esc(msg.from.split('@')[0])}</div>
            <div class="addr">${esc(msg.from)}</div>
            <div class="to-line">To: ${esc(msg.to)}</div>
          </div>
        </div>
        <div class="content">${esc(msg.body)}</div>
      </div>
    </div>
  `;
  const item = currentInbox.find(m=>m.id===id);
  if(item) item.read = true;
}

function openCompose(){
  document.getElementById('composeOverlay').classList.add('show');
  document.getElementById('composeMsg').textContent = '';
}
function closeCompose(){ document.getElementById('composeOverlay').classList.remove('show'); }

async function sendCompose(){
  const to = document.getElementById('cTo').value.trim();
  const subject = document.getElementById('cSubject').value.trim();
  const body = document.getElementById('cBody').value;
  const msgEl = document.getElementById('composeMsg');
  if(!to || !subject){ msgEl.textContent = 'To aur Subject dono zaroori hain.'; return; }
  msgEl.textContent = 'Bhej rahe hain...';
  try{
    const res = await fetch(`${API_BASE}/mail/send`, {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ to, subject, body })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'send failed');
    msgEl.textContent = 'Bhej diya gaya';
    setTimeout(closeCompose, 800);
  }catch(e){ msgEl.textContent = 'Error: ' + e.message; }
}

// ---- bind everything, no inline handlers anywhere ----
document.getElementById('tabLogin').addEventListener('click', () => switchAuthTab('login'));
document.getElementById('tabSignup').addEventListener('click', () => switchAuthTab('signup'));
document.getElementById('authSubmitBtn').addEventListener('click', submitAuth);
document.getElementById('forgotLink').addEventListener('click', (e) => { e.preventDefault(); showForgot(); });
document.getElementById('requestResetBtn').addEventListener('click', requestReset);
document.getElementById('composeBtn').addEventListener('click', openCompose);
document.getElementById('composeCloseBtn').addEventListener('click', closeCompose);
document.getElementById('sendComposeBtn').addEventListener('click', sendCompose);
document.getElementById('logoutBtn').addEventListener('click', logout);

// event delegation for dynamically-rendered message list items
document.getElementById('listScroll').addEventListener('click', (e) => {
  const item = e.target.closest('.msg-item');
  if (item) openThread(item.dataset.id, item);
});

// allow Enter key to submit auth form
['authIdentifier','authPassword'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAuth();
  });
});

enterApp();
