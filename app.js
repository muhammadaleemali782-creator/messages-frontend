
// Register Service Worker for Offline PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW reg error:', err));
  });
}

// Online / Offline Listeners
window.addEventListener('online', () => {
  const b = document.getElementById('offlineBanner');
  if (b) b.classList.add('hidden');
  if (typeof loadInbox === 'function') loadInbox();
});
window.addEventListener('offline', () => {
  const b = document.getElementById('offlineBanner');
  if (b) b.classList.remove('hidden');
});

function formatMessageBody(text) {
  if (!text) return '<span style="color:#94a3b8; font-style:italic;">(Empty message body)</span>';
  let escaped = esc(text);
  
  // Highlight 6-digit OTP codes in prominent badge
  escaped = escaped.replace(/\b(\d{6})\b/g, '<span style="display:inline-block; padding:4px 10px; margin:4px 0; background:rgba(251,191,36,0.2); border:1px solid #fbbf24; border-radius:8px; color:#fbbf24; font-size:18px; font-weight:900; letter-spacing:2px; font-family:monospace;">$1</span>');
  
  return escaped;
}
// app.js - Full Interactive Engine with Bearer Token & Working Controls

let ME = null;
let currentInbox = [];
let starredIds = new Set(JSON.parse(localStorage.getItem('educa_starred_msg_ids') || '[]'));
let deletedIds = new Set(JSON.parse(localStorage.getItem('educa_deleted_msg_ids') || '[]'));
let currentFolder = 'inbox';
let currentLabel = null;
let searchQuery = '';
let authMode = 'login';
let activeSelectedMessage = null;

function initial(name){ return (name||'?').trim()[0]?.toUpperCase() || '?'; }
function fmtTime(ts){ 
  const d = typeof ts === 'number' ? new Date(ts*1000) : new Date(ts);
  return d.toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); 
}

function getAuthHeaders(){
  const token = localStorage.getItem('educa_mail_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function esc(str){
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function switchAuthTab(mode){
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('loginFields').classList.toggle('hidden', mode !== 'login');
  document.getElementById('signupFields').classList.toggle('hidden', mode !== 'signup');
  document.getElementById('generatedEmailMsg').textContent = '';
}

async function submitAuth(){
  const msgEl = document.getElementById('authMsg');
  const genEl = document.getElementById('generatedEmailMsg');
  msgEl.textContent = '';
  genEl.textContent = '';

  if (authMode === 'login') {
    const identifier = document.getElementById('authIdentifier').value.trim();
    const password = document.getElementById('authPassword').value;
    try{
      const res = await fetch(`${API_BASE}/auth/login`, {
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
        body: JSON.stringify({ identifier, password })
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'Login failed');
      if (data.token) localStorage.setItem('educa_mail_token', data.token);
      if (data.identifier) localStorage.setItem('educa_cached_identifier', data.identifier);
      await enterApp();
    }catch(e){ msgEl.textContent = e.message; }
  } else {
    const name = document.getElementById('signupName').value.trim();
    const phone = document.getElementById('signupPhone').value.trim();
    const password = document.getElementById('signupPassword').value;
    try{
      const res = await fetch(`${API_BASE}/auth/signup`, {
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
        body: JSON.stringify({ name, password, phone })
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'Signup failed');
      if (data.token) localStorage.setItem('educa_mail_token', data.token);
      if (data.identifier) localStorage.setItem('educa_cached_identifier', data.identifier);
      genEl.style.color = '#10b981';
      genEl.textContent = `Aapka account ban gaya: ${data.identifier}`;
      await enterApp();
    }catch(e){ msgEl.textContent = e.message; }
  }
}

function showForgot(){ document.getElementById('forgotBox').classList.add('show'); }

async function requestReset(){
  const identifier = document.getElementById('forgotIdentifier').value.trim();
  const phone = document.getElementById('forgotPhone').value.trim();
  const msgEl = document.getElementById('forgotMsg');
  try{
    await fetch(`${API_BASE}/reset-request`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ identifier, phone })
    });
    msgEl.style.color = '#10b981';
    msgEl.textContent = 'Agar match hua, request submit ho gayi hai.';
  }catch(e){ msgEl.style.color='#ef4444'; msgEl.textContent = 'Kuch galat ho gaya.'; }
}

async function enterApp(){
  const bootEl = document.getElementById('appBootLoader');
  const authEl = document.getElementById('authScreen');
  const mainEl = document.getElementById('mainApp');

  const cachedToken = localStorage.getItem('educa_mail_token');
  const cachedId = localStorage.getItem('educa_cached_identifier');

  // If cached session exists, pre-fill UI immediately for zero-lag instant display
  if (cachedToken && cachedId) {
    mainEl.classList.remove('hidden');
    authEl.classList.add('hidden');
    document.getElementById('acctSub').textContent = cachedId;
    document.getElementById('acctAvatar').textContent = initial(cachedId);
    document.getElementById('acctName').textContent = cachedId.split('@')[0].toUpperCase();
  }

  try {
    const meRes = await fetch(`${API_BASE}/auth/me`, { 
      headers: getAuthHeaders(),
      credentials:'include' 
    });

    if (!meRes.ok) { 
      // Invalid session: show login screen cleanly
      localStorage.removeItem('educa_mail_token');
      localStorage.removeItem('educa_cached_identifier');
      authEl.classList.remove('hidden');
      mainEl.classList.add('hidden');
      if (bootEl) bootEl.classList.add('hidden');
      return; 
    }

    ME = await meRes.json();
    localStorage.setItem('educa_cached_identifier', ME.identifier);
    authEl.classList.add('hidden');
    mainEl.classList.remove('hidden');
    document.getElementById('acctSub').textContent = `${ME.identifier}`;
    document.getElementById('acctAvatar').textContent = initial(ME.identifier);
    document.getElementById('acctName').textContent = ME.identifier.split('@')[0].toUpperCase();
    if (bootEl) bootEl.classList.add('hidden');
    await loadInbox();
  } catch(e) {
    if (!cachedToken) {
      authEl.classList.remove('hidden');
      mainEl.classList.add('hidden');
    }
    if (bootEl) bootEl.classList.add('hidden');
  }
}

async function loadInbox(){
  try{
    if (!navigator.onLine) throw new Error('Offline');
    const res = await fetch(`${API_BASE}/messages`, { 
      headers: getAuthHeaders(),
      credentials:'include' 
    });
    if(!res.ok) throw new Error('session expired');
    const data = await res.json();
    currentInbox = Array.isArray(data) ? data : [];
    // Cache for offline viewing
    localStorage.setItem('educa_offline_inbox', JSON.stringify(currentInbox));
    renderList();
  }catch(e){
    // Offline / Network error fallback
    const offlineData = localStorage.getItem('educa_offline_inbox');
    if (offlineData) {
      try {
        currentInbox = JSON.parse(offlineData);
        renderList();
        const b = document.getElementById('offlineBanner');
        if (b) b.classList.remove('hidden');
        return;
      } catch (err) {}
    }
    document.getElementById('listScroll').innerHTML = `<div class="empty">Messages load nahi ho sake. ${navigator.onLine ? 'Dobara login karein.' : 'Internet disconnected.'}</div>`;
  }
}

async function logout(){
  try {
    await fetch(`${API_BASE}/auth/logout`, { method:'POST', headers: getAuthHeaders(), credentials:'include' });
  } catch(e){}
  localStorage.removeItem('educa_mail_token');
  location.reload();
}

function getFilteredMessages(){
  const nowSec = Math.floor(Date.now() / 1000);
  const THREE_HOURS_SEC = 3 * 3600;

  return currentInbox.filter(m => {
    // 3-hour auto-expire
    if (m.ts && (nowSec - m.ts > THREE_HOURS_SEC)) return false;
    const id = String(m.id);

    // Folder-specific strict routing
    if (currentFolder === 'trash') {
      return deletedIds.has(id);
    }
    if (deletedIds.has(id)) return false; // Deleted messages only belong in trash

    if (currentFolder === 'spam') {
      return spamIds.has(id);
    }
    if (spamIds.has(id)) return false; // Spam messages only belong in spam folder

    if (currentFolder === 'archive') {
      return archivedIds.has(id);
    }
    if (archivedIds.has(id)) return false; // Archived messages only belong in archive folder

    if (currentFolder === 'starred') {
      return starredIds.has(id);
    }

    if (currentFolder === 'sent') {
      const myId = (ME?.identifier || localStorage.getItem('educa_cached_identifier') || '').toLowerCase();
      return (m.from || '').toLowerCase().includes(myId.split('@')[0]);
    }

    if (currentFolder === 'drafts') {
      return false;
    }

    // Inbox: only non-deleted, non-archived, non-spam
    if (currentFolder === 'inbox') {
      return !deletedIds.has(id) && !archivedIds.has(id) && !spamIds.has(id);
    }

    if (currentLabel) {
      const text = `${m.subject || ''} ${m.body || ''}`.toLowerCase();
      if (!text.includes(currentLabel.toLowerCase())) return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match = (m.subject || '').toLowerCase().includes(q) ||
                    (m.from || '').toLowerCase().includes(q) ||
                    (m.body || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });
}

function renderList(){
  const filtered = getFilteredMessages();
  const unreadCount = currentInbox.filter(m => !m.read && !deletedIds.has(String(m.id))).length;
  document.getElementById('inboxCount').textContent = unreadCount ? String(unreadCount) : '';
  document.getElementById('starredCount').textContent = starredIds.size ? String(starredIds.size) : '';

  const wrap = document.getElementById('listScroll');
  if(filtered.length === 0){ 
    wrap.innerHTML = `<div class="empty">Is folder me koi message nahi hai.</div>`; 
    return; 
  }

  wrap.innerHTML = `<div class="list-group-label">${currentFolder.toUpperCase()} (${filtered.length})</div>` + filtered.map((m)=>{
    const isStarred = starredIds.has(String(m.id));
    return `
    <div class="msg-item ${activeSelectedMessage === m.id ? 'selected' : ''}" data-id="${esc(m.id)}">
      <div class="av">${esc(initial(m.from))}</div>
      <div class="body">
        <div class="row1">
          <div class="from">${esc(m.from)}${!m.read?'<span class="badge">new</span>':''}</div>
          <div class="time">
            ${isStarred ? '<span style="color:#fbbf24; margin-right:4px;">★</span>' : ''}
            ${esc(fmtTime(m.ts))}
          </div>
        </div>
        <div class="subj">${esc(m.subject)}</div>
      </div>
    </div>
  `}).join('');
}

async function openThread(id, clickedEl){
  activeSelectedMessage = id;
  document.querySelectorAll('.msg-item').forEach(el=>el.classList.remove('selected'));
  if (clickedEl) clickedEl.classList.add('selected');
  
  // Mobile responsive view: toggle reading pane into view
  document.querySelector('.read-pane')?.classList.add('mobile-active');

  let msg = currentInbox.find(m => String(m.id) === String(id));
  try {
    if (navigator.onLine) {
      const res = await fetch(`${API_BASE}/message/${encodeURIComponent(id)}`, { 
        headers: getAuthHeaders(),
        credentials:'include' 
      });
      if (res.ok) msg = await res.json();
    }
  } catch(e){}

  if(!msg){ 
    document.getElementById('readPane').innerHTML = `<div class="no-selection">Ye message nahi khul saka.</div>`; 
    return; 
  }

  msg.read = true;
  const isStarred = starredIds.has(String(id));
  const isArchived = archivedIds.has(String(id));

  document.getElementById('readPane').innerHTML = `
    <div class="read-toolbar">
      <button id="mobileBackBtn" class="toolbar-btn mobile-only-btn" type="button">← Back</button>
      <button id="replyBtn" class="toolbar-btn" type="button">↩ Reply</button>
      <button id="forwardBtn" class="toolbar-btn" type="button">↪ Forward</button>
      <button id="starBtn" class="toolbar-btn ${isStarred ? 'active-star' : ''}" type="button">${isStarred ? '★ Starred' : '☆ Star'}</button>
      <button id="archiveBtn" class="toolbar-btn" type="button">${isArchived ? '📥 Unarchive' : '📦 Archive'}</button>
      <button id="deleteBtn" class="toolbar-btn text-danger" type="button">🗑️ Delete</button>
      <div class="spacer"></div>
      <span class="thread-time">${esc(fmtTime(msg.ts))}</span>
    </div>
    <div class="read-scroll">
      <div class="summary-box"><div class="label">Subject</div>${esc(msg.subject)}</div>
      <div class="thread-msg">
        <div class="head">
          <div class="av">${esc(initial(msg.from))}</div>
          <div class="who">
            <div class="name">${esc(msg.from.split('@')[0])}</div>
            <div class="addr">${esc(msg.from)}</div>
            <div class="to-line">To: ${esc(msg.to)}</div>
          </div>
        </div>
        <div class="content">${formatMessageBody(msg.body)}</div>
      </div>
    </div>
  `;

  // Back button on mobile
  document.getElementById('mobileBackBtn')?.addEventListener('click', () => {
    document.querySelector('.read-pane')?.classList.remove('mobile-active');
  });

  // Reply
  document.getElementById('replyBtn')?.addEventListener('click', () => {
    openCompose(msg.from, `Re: ${msg.subject}`, `

--- Original Message from ${msg.from} ---
${msg.body}`);
  });

  // Forward
  document.getElementById('forwardBtn')?.addEventListener('click', () => {
    openCompose('', `Fwd: ${msg.subject}`, `

--- Forwarded Message ---
From: ${msg.from}
Date: ${fmtTime(msg.ts)}
Subject: ${msg.subject}

${msg.body}`);
  });

  // Star / Unstar
  document.getElementById('starBtn')?.addEventListener('click', () => {
    if (starredIds.has(String(id))) starredIds.delete(String(id));
    else starredIds.add(String(id));
    localStorage.setItem('educa_starred_ids', JSON.stringify([...starredIds]));
    renderList();
    openThread(id, clickedEl);
  });

  // Archive / Unarchive
  document.getElementById('archiveBtn')?.addEventListener('click', () => {
    if (archivedIds.has(String(id))) archivedIds.delete(String(id));
    else archivedIds.add(String(id));
    localStorage.setItem('educa_archived_ids', JSON.stringify([...archivedIds]));
    renderList();
    openThread(id, clickedEl);
  });

  // Delete
  document.getElementById('deleteBtn')?.addEventListener('click', () => {
    deletedIds.add(String(id));
    localStorage.setItem('educa_deleted_ids', JSON.stringify([...deletedIds]));
    renderList();
    document.getElementById('readPane').innerHTML = `<div class="no-selection">Message delete kar diya gaya.</div>`;
    document.querySelector('.read-pane')?.classList.remove('mobile-active');
  });
}

function openCompose(to = '', subject = '', body = ''){
  document.getElementById('cTo').value = to;
  document.getElementById('cSubject').value = subject;
  document.getElementById('cBody').value = body;
  document.getElementById('composeOverlay').classList.add('show');
  document.getElementById('composeMsg').textContent = '';
}

function closeCompose(){ 
  document.getElementById('composeOverlay').classList.remove('show'); 
}

async function sendCompose(){
  const to = document.getElementById('cTo').value.trim();
  const subject = document.getElementById('cSubject').value.trim();
  const body = document.getElementById('cBody').value;
  const msgEl = document.getElementById('composeMsg');
  if(!to || !subject){ msgEl.textContent = 'To aur Subject dono zaroori hain.'; return; }
  msgEl.textContent = 'Bhej rahe hain...';
  try{
    const res = await fetch(`${API_BASE}/mail/send`, {
      method:'POST', 
      headers: getAuthHeaders(), 
      credentials:'include',
      body: JSON.stringify({ to, subject, body })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Send failed');
    msgEl.style.color = '#10b981';
    msgEl.textContent = '✓ Message bhej diya gaya!';
    setTimeout(() => {
      closeCompose();
      loadInbox();
    }, 600);
  }catch(e){ 
    msgEl.style.color = '#ef4444';
    msgEl.textContent = 'Error: ' + e.message; 
  }
}

// ── Bind UI Events ──
document.getElementById('tabLogin').addEventListener('click', () => switchAuthTab('login'));
document.getElementById('tabSignup').addEventListener('click', () => switchAuthTab('signup'));
document.getElementById('authSubmitBtn').addEventListener('click', submitAuth);
document.getElementById('forgotLink').addEventListener('click', (e) => { e.preventDefault(); showForgot(); });
document.getElementById('requestResetBtn').addEventListener('click', requestReset);
document.getElementById('composeBtn').addEventListener('click', () => openCompose());
document.getElementById('composeCloseBtn').addEventListener('click', closeCompose);
document.getElementById('sendComposeBtn').addEventListener('click', sendCompose);
document.getElementById('logoutBtn').addEventListener('click', logout);
const qlBtn = document.getElementById('quickLogoutBtn');
if (qlBtn) qlBtn.addEventListener('click', logout);

// Sidebar Folder Navigation
document.getElementById('sidebarNav').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.label-item').forEach(el => el.classList.remove('active'));
  item.classList.add('active');
  currentFolder = item.dataset.folder || 'inbox';
  currentLabel = null;
  document.getElementById('currentFolderTitle').textContent = item.querySelector('.ico').textContent.trim();
  renderList();
});

// Labels Navigation
document.getElementById('labelsNav').addEventListener('click', (e) => {
  const item = e.target.closest('.label-item');
  if (!item) return;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.label-item').forEach(el => el.classList.remove('active'));
  item.classList.add('active');
  currentLabel = item.dataset.label;
  document.getElementById('currentFolderTitle').textContent = `Label: ${currentLabel}`;
  renderList();
});

// Search Filter Input
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderList();
});

// Message List item click
document.getElementById('listScroll').addEventListener('click', (e) => {
  const item = e.target.closest('.msg-item');
  if (item) openThread(item.dataset.id, item);
});

// Enter key in auth
['authIdentifier','authPassword'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAuth();
  });
});

enterApp();
