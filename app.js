// EDUCA Mail Client Application Engine · Enterprise v2.0
const API_BASE = window.MAIL_SERVER_URL || 'https://messages-backend-e6pe.onrender.com';

let ME = null;
let currentFolder = 'inbox';
let currentLabel = null;
let currentInbox = [];
let searchQuery = '';
let activeSelectedMessage = null;

// Persistent User Folder Sets
const starredIds = new Set(JSON.parse(localStorage.getItem('educa_starred_ids') || '[]'));
const deletedIds = new Set(JSON.parse(localStorage.getItem('educa_deleted_ids') || '[]'));
const archivedIds = new Set(JSON.parse(localStorage.getItem('educa_archived_ids') || '[]'));
const spamIds = new Set(JSON.parse(localStorage.getItem('educa_spam_ids') || '[]'));

// Register Service Worker for Offline PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW notice:', err));
  });
}

// Online / Offline Detection
window.addEventListener('online', () => {
  const b = document.getElementById('offlineBanner');
  if (b) b.classList.add('hidden');
  loadInbox();
});
window.addEventListener('offline', () => {
  const b = document.getElementById('offlineBanner');
  if (b) b.classList.remove('hidden');
});

// Helper: Escape HTML
function esc(str){
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

// Helper: Initial
function initial(name){
  if (!name) return 'U';
  const clean = name.replace(/^[^a-zA-Z0-9]+/, '');
  return (clean[0] || 'U').toUpperCase();
}

// Helper: Format Timestamp
function fmtTime(ts){
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Helper: Format Message Body & Highlight OTP Codes
function formatMessageBody(text) {
  if (!text) return '<span style="color:#94a3b8; font-style:italic;">(No message content)</span>';
  let escaped = esc(text);

  // Detect 6-digit OTP code and render luxury copyable card
  escaped = escaped.replace(/\b(\d{6})\b/g, (match) => {
    return `
      <div class="otp-highlight-card">
        <span class="otp-code">${match}</span>
        <button type="button" class="otp-copy-btn" onclick="copyOtpCode('${match}', this)">
          📋 Copy OTP
        </button>
      </div>
    `;
  });

  return escaped;
}

// Global OTP Copy Handler
window.copyOtpCode = function(code, btn) {
  navigator.clipboard.writeText(code).then(() => {
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.background = '#16a34a';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '#16a34a';
    }, 1800);
  }).catch(() => {
    alert('OTP Code: ' + code);
  });
};

function getAuthHeaders(){
  const token = localStorage.getItem('educa_mail_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/* ================= BOOT & AUTH ================= */
async function enterApp(){
  const bootEl = document.getElementById('appBootLoader');
  const authEl = document.getElementById('authScreen');
  const mainEl = document.getElementById('mainApp');

  const cachedToken = localStorage.getItem('educa_mail_token');
  const cachedId = localStorage.getItem('educa_cached_identifier');

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
    document.getElementById('acctSub').textContent = ME.identifier;
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
    localStorage.setItem('educa_offline_inbox', JSON.stringify(currentInbox));
    renderList();
  }catch(e){
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
    document.getElementById('listScroll').innerHTML = `<div class="empty-state">Messages could not be loaded. ${navigator.onLine ? 'Please sign in again.' : 'Offline mode.'}</div>`;
  }
}

/* ================= FILTERING & LIST RENDERING ================= */
function getFilteredMessages(){
  const nowSec = Math.floor(Date.now() / 1000);
  const THREE_HOURS_SEC = 3 * 3600;

  return currentInbox.filter(m => {
    // 3-hour TTL auto-expiration
    if (m.ts && (nowSec - m.ts > THREE_HOURS_SEC)) return false;
    const id = String(m.id);

    // Folder routing
    if (currentFolder === 'trash') return deletedIds.has(id);
    if (deletedIds.has(id)) return false;

    if (currentFolder === 'spam') return spamIds.has(id);
    if (spamIds.has(id)) return false;

    if (currentFolder === 'archive') return archivedIds.has(id);
    if (archivedIds.has(id)) return false;

    if (currentFolder === 'starred') return starredIds.has(id);

    if (currentFolder === 'sent') {
      const myId = (ME?.identifier || localStorage.getItem('educa_cached_identifier') || '').toLowerCase();
      return (m.from || '').toLowerCase().includes(myId.split('@')[0]);
    }

    if (currentFolder === 'drafts') return false;

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
  const unreadCount = currentInbox.filter(m => !m.read && !deletedIds.has(String(m.id)) && !archivedIds.has(String(m.id))).length;
  
  const inboxBadge = document.getElementById('inboxCount');
  if (inboxBadge) inboxBadge.textContent = unreadCount ? String(unreadCount) : '';
  
  const starredBadge = document.getElementById('starredCount');
  if (starredBadge) starredBadge.textContent = starredIds.size ? String(starredIds.size) : '';

  const wrap = document.getElementById('listScroll');
  if(filtered.length === 0){ 
    wrap.innerHTML = `<div class="empty-state">No messages in ${currentFolder}.</div>`; 
    return; 
  }

  wrap.innerHTML = filtered.map((m) => {
    const isStarred = starredIds.has(String(m.id));
    const isSelected = activeSelectedMessage === m.id;
    const isUnread = !m.read;

    return `
    <div class="msg-item ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''}" data-id="${esc(m.id)}">
      <div class="msg-avatar">${esc(initial(m.from))}</div>
      <div class="msg-content">
        <div class="msg-top-row">
          <div class="msg-from">
            <span>${esc(m.from)}</span>
            ${isUnread ? '<span class="badge-new">NEW</span>' : ''}
          </div>
          <div class="msg-time">
            ${isStarred ? '<span style="color:#2563eb;">★</span>' : ''}
            <span>${esc(fmtTime(m.ts))}</span>
          </div>
        </div>
        <div class="msg-subject">${esc(m.subject || 'No Subject')}</div>
        <div class="msg-preview">${esc(m.body ? m.body.slice(0, 70) + '...' : '')}</div>
      </div>
    </div>
  `}).join('');
}

/* ================= OPEN THREAD ================= */
async function openThread(id, clickedEl){
  activeSelectedMessage = id;
  document.querySelectorAll('.msg-item').forEach(el=>el.classList.remove('selected'));
  if (clickedEl) clickedEl.classList.add('selected');
  
  // Mobile active reading view
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
    document.getElementById('readPane').innerHTML = `<div class="no-selection-state"><h3>Message could not be opened</h3></div>`; 
    return; 
  }

  msg.read = true;
  const isStarred = starredIds.has(String(id));
  const isArchived = archivedIds.has(String(id));

  document.getElementById('readPane').innerHTML = `
    <div class="read-toolbar">
      <button id="mobileBackBtn" class="toolbar-btn mobile-back-btn hidden" type="button">← Back to Inbox</button>
      <button id="replyBtn" class="toolbar-btn" type="button">↩ Reply</button>
      <button id="forwardBtn" class="toolbar-btn" type="button">↪ Forward</button>
      <button id="starBtn" class="toolbar-btn ${isStarred ? 'active-star' : ''}" type="button">${isStarred ? '★ Starred' : '☆ Star'}</button>
      <button id="archiveBtn" class="toolbar-btn" type="button">${isArchived ? '📥 Unarchive' : '📦 Archive'}</button>
      <button id="deleteBtn" class="toolbar-btn text-danger" type="button">🗑️ Delete</button>
      <div class="spacer"></div>
      <span class="thread-time">${esc(fmtTime(msg.ts))}</span>
    </div>
    <div class="read-scroll">
      <div class="subject-banner">
        <div class="subject-tag">Subject</div>
        <h2 class="subject-heading">${esc(msg.subject)}</h2>
      </div>
      <div class="thread-card">
        <div class="thread-sender-row">
          <div class="sender-avatar">${esc(initial(msg.from))}</div>
          <div class="sender-details">
            <div class="sender-name">${esc(msg.from.split('@')[0])}</div>
            <div class="sender-addr">${esc(msg.from)}</div>
            <div class="sender-to">To: ${esc(msg.to)}</div>
          </div>
        </div>
        <div class="thread-body-content">${formatMessageBody(msg.body)}</div>
      </div>
    </div>
  `;

  // Mobile Back Button
  document.getElementById('mobileBackBtn')?.addEventListener('click', () => {
    document.querySelector('.read-pane')?.classList.remove('mobile-active');
  });

  // Reply
  document.getElementById('replyBtn')?.addEventListener('click', () => {
    openCompose(msg.from, `Re: ${msg.subject}`, `\n\n--- Original Message from ${msg.from} ---\n${msg.body}`);
  });

  // Forward
  document.getElementById('forwardBtn')?.addEventListener('click', () => {
    openCompose('', `Fwd: ${msg.subject}`, `\n\n--- Forwarded Message ---\nFrom: ${msg.from}\nDate: ${fmtTime(msg.ts)}\nSubject: ${msg.subject}\n\n${msg.body}`);
  });

  // Star
  document.getElementById('starBtn')?.addEventListener('click', () => {
    if (starredIds.has(String(id))) starredIds.delete(String(id));
    else starredIds.add(String(id));
    localStorage.setItem('educa_starred_ids', JSON.stringify([...starredIds]));
    renderList();
    openThread(id, clickedEl);
  });

  // Archive
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
    document.getElementById('readPane').innerHTML = `<div class="no-selection-state"><h3>Message deleted</h3></div>`;
    document.querySelector('.read-pane')?.classList.remove('mobile-active');
  });
}

/* ================= COMPOSE MODAL ================= */
function openCompose(to='', subj='', body=''){
  document.getElementById('cTo').value = to;
  document.getElementById('cSubject').value = subj;
  document.getElementById('cBody').value = body;
  document.getElementById('composeMsg').textContent = '';
  document.getElementById('composeOverlay').classList.remove('hidden');
}

function closeCompose(){
  document.getElementById('composeOverlay').classList.add('hidden');
}

async function sendCompose(){
  const to = document.getElementById('cTo').value.trim();
  const subject = document.getElementById('cSubject').value.trim();
  const body = document.getElementById('cBody').value.trim();
  const msgEl = document.getElementById('composeMsg');

  if(!to || !subject){
    msgEl.style.color = '#dc2626';
    msgEl.textContent = 'Recipient and Subject are required.';
    return;
  }

  try {
    msgEl.style.color = '#0284c7';
    msgEl.textContent = 'Sending message...';
    const res = await fetch(`${API_BASE}/mail/send`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ to, subject, body })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed to send');
    msgEl.style.color = '#16a34a';
    msgEl.textContent = 'Message sent successfully!';
    setTimeout(() => {
      closeCompose();
      loadInbox();
    }, 1000);
  } catch(e) {
    msgEl.style.color = '#dc2626';
    msgEl.textContent = e.message;
  }
}

/* ================= LOGOUT ================= */
async function logout(){
  try {
    await fetch(`${API_BASE}/auth/logout`, { method:'POST', headers: getAuthHeaders(), credentials:'include' });
  } catch(e){}
  localStorage.removeItem('educa_mail_token');
  localStorage.removeItem('educa_cached_identifier');
  location.reload();
}

/* ================= EVENT ATTACHMENTS ================= */
window.addEventListener('DOMContentLoaded', () => {
  enterApp();

  // Navigation Items
  document.querySelectorAll('#sidebarNav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sidebarNav .nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFolder = btn.dataset.folder;
      currentLabel = null;
      document.getElementById('currentFolderTitle').textContent = btn.querySelector('.nav-label').textContent;
      
      // Close mobile sidebar
      document.getElementById('appSidebar')?.classList.remove('mobile-open');
      document.getElementById('sidebarBackdrop')?.classList.add('hidden');
      renderList();
    });
  });

  // Labels
  document.querySelectorAll('#labelsNav .label-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sidebarNav .nav-item, #labelsNav .label-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLabel = btn.dataset.label;
      document.getElementById('currentFolderTitle').textContent = `Label: ${currentLabel}`;
      
      document.getElementById('appSidebar')?.classList.remove('mobile-open');
      document.getElementById('sidebarBackdrop')?.classList.add('hidden');
      renderList();
    });
  });

  // Search Input
  const searchInp = document.getElementById('searchInput');
  const searchClr = document.getElementById('searchClearBtn');
  searchInp?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (searchClr) {
      if (searchQuery) searchClr.classList.remove('hidden');
      else searchClr.classList.add('hidden');
    }
    renderList();
  });
  searchClr?.addEventListener('click', () => {
    searchInp.value = '';
    searchQuery = '';
    searchClr.classList.add('hidden');
    renderList();
  });

  // Message Click Delegation
  document.getElementById('listScroll')?.addEventListener('click', (e) => {
    const item = e.target.closest('.msg-item');
    if (item && item.dataset.id) {
      openThread(item.dataset.id, item);
    }
  });

  // Compose
  document.getElementById('composeBtn')?.addEventListener('click', () => openCompose());
  document.getElementById('mobileFabCompose')?.addEventListener('click', () => openCompose());
  document.getElementById('composeCloseBtn')?.addEventListener('click', closeCompose);
  document.getElementById('composeDiscardBtn')?.addEventListener('click', closeCompose);
  document.getElementById('sendComposeBtn')?.addEventListener('click', sendCompose);

  // Refresh
  document.getElementById('refreshBtn')?.addEventListener('click', loadInbox);

  // Logout Buttons
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('quickLogoutBtn')?.addEventListener('click', logout);
  document.getElementById('mobileQuickLogoutBtn')?.addEventListener('click', logout);

  // Mobile Menu Drawer
  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('appSidebar')?.classList.toggle('mobile-open');
    document.getElementById('sidebarBackdrop')?.classList.toggle('hidden');
  });
  document.getElementById('sidebarBackdrop')?.addEventListener('click', () => {
    document.getElementById('appSidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebarBackdrop')?.classList.add('hidden');
  });

  // Auth Tabs
  document.getElementById('tabLogin')?.addEventListener('click', () => {
    document.getElementById('tabLogin').classList.add('active');
    document.getElementById('tabSignup').classList.remove('active');
    document.getElementById('loginFields').classList.remove('hidden');
    document.getElementById('signupFields').classList.add('hidden');
    document.getElementById('authSubmitBtn').querySelector('span').textContent = 'Continue to Mailbox';
  });
  document.getElementById('tabSignup')?.addEventListener('click', () => {
    document.getElementById('tabSignup').classList.add('active');
    document.getElementById('tabLogin').classList.remove('active');
    document.getElementById('signupFields').classList.remove('hidden');
    document.getElementById('loginFields').classList.add('hidden');
    document.getElementById('authSubmitBtn').querySelector('span').textContent = 'Create Corporate Account';
  });

  // Forgot Password Toggle
  document.getElementById('forgotLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('forgotBox')?.classList.toggle('show');
  });

  // Auth Submit
  document.getElementById('authSubmitBtn')?.addEventListener('click', async () => {
    const isSignup = document.getElementById('tabSignup').classList.contains('active');
    const msgEl = document.getElementById('authMsg');
    msgEl.textContent = '';

    if (!isSignup) {
      const identifier = document.getElementById('authIdentifier').value.trim();
      const password = document.getElementById('authPassword').value;
      if (!identifier || !password) {
        msgEl.textContent = 'Please enter both identifier and password.';
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ identifier, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Authentication failed');
        if (data.token) localStorage.setItem('educa_mail_token', data.token);
        if (data.identifier) localStorage.setItem('educa_cached_identifier', data.identifier);
        await enterApp();
      } catch (err) {
        msgEl.textContent = err.message;
      }
    } else {
      const name = document.getElementById('signupName').value.trim();
      const phone = document.getElementById('signupPhone').value.trim();
      const password = document.getElementById('signupPassword').value;
      if (!name || !password) {
        msgEl.textContent = 'Name and Password (min 8 chars) are required.';
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name, phone, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Account creation failed');
        if (data.token) localStorage.setItem('educa_mail_token', data.token);
        if (data.identifier) localStorage.setItem('educa_cached_identifier', data.identifier);
        const genMsg = document.getElementById('generatedEmailMsg');
        if (genMsg) {
          genMsg.textContent = `Account created: ${data.identifier}`;
        }
        await enterApp();
      } catch (err) {
        msgEl.textContent = err.message;
      }
    }
  });

  // Forgot Password Request
  document.getElementById('requestResetBtn')?.addEventListener('click', async () => {
    const identifier = document.getElementById('forgotIdentifier').value.trim();
    const phone = document.getElementById('forgotPhone').value.trim();
    const fMsg = document.getElementById('forgotMsg');
    if (!identifier) {
      fMsg.style.color = '#dc2626';
      fMsg.textContent = 'Please enter identifier';
      return;
    }
    try {
      await fetch(`${API_BASE}/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, phone })
      });
      fMsg.style.color = '#16a34a';
      fMsg.textContent = 'Recovery request submitted to administrator.';
    } catch (e) {
      fMsg.style.color = '#dc2626';
      fMsg.textContent = 'Request failed.';
    }
  });
});
