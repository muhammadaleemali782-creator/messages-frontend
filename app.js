// EDUCA Mail · Google Gmail Engine Architecture v4.0 (Enterprise Shimmer + Strict Deduplication + 2-Stage Trash + Global Directory)
// API_BASE is declared in config.js

let ME = null;
let currentFolder = 'inbox';
let currentCategory = 'all';
let currentLabel = null;
let currentInbox = [];
let searchQuery = '';
let activeSelectedMessage = null;

// Persistent User State Sets
const starredIds = new Set(JSON.parse(localStorage.getItem('educa_starred_ids') || '[]'));
const trashedIds = new Set(JSON.parse(localStorage.getItem('educa_trashed_ids') || '[]'));
const permanentlyDeletedIds = new Set(JSON.parse(localStorage.getItem('educa_perm_deleted_ids') || '[]'));
const archivedIds = new Set(JSON.parse(localStorage.getItem('educa_archived_ids') || '[]'));
const spamIds = new Set(JSON.parse(localStorage.getItem('educa_spam_ids') || '[]'));

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW notice:', err));
  });
}

// Online/Offline detection
window.addEventListener('online', () => {
  document.getElementById('offlineBanner')?.classList.add('hidden');
  loadInbox();
});
window.addEventListener('offline', () => {
  document.getElementById('offlineBanner')?.classList.remove('hidden');
});

function esc(str){
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

function initial(name){
  if (!name) return 'M';
  const clean = name.replace(/^[^a-zA-Z0-9]+/, '');
  return (clean[0] || 'M').toUpperCase();
}

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

function formatMessageBody(text) {
  if (!text) return '<span style="color:#94a3b8; font-style:italic;">(No message content)</span>';
  let escaped = esc(text);

  // Detect 6-digit OTP code and render modern Tech Emerald copyable card
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

window.copyOtpCode = function(code, btn) {
  navigator.clipboard.writeText(code).then(() => {
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.background = '#15803d';
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

/* ================= 1. SHIMMER / SKELETON PLACEHOLDER ================= */
function renderSkeletonList() {
  const wrap = document.getElementById('listScroll');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="skeleton-item">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-80"></div>
        <div class="skeleton-line w-60"></div>
      </div>
    </div>
    <div class="skeleton-item">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-80"></div>
        <div class="skeleton-line w-60"></div>
      </div>
    </div>
    <div class="skeleton-item">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-80"></div>
        <div class="skeleton-line w-60"></div>
      </div>
    </div>
  `;
}

/* ================= 2. BOOT & AUTH ================= */
async function enterApp(){
  const authEl = document.getElementById('authScreen');
  const mainEl = document.getElementById('mainApp');

  const token = localStorage.getItem('educa_mail_token');
  const cachedId = localStorage.getItem('educa_cached_identifier') || 'Admin';

  if (!token) {
    authEl.classList.remove('hidden');
    mainEl.classList.add('hidden');
    return;
  }

  authEl.classList.add('hidden');
  mainEl.classList.remove('hidden');
  updateProfileUI(cachedId);
  renderSkeletonList();

  try {
    const meRes = await fetch(`${API_BASE}/auth/me`, { 
      headers: getAuthHeaders(),
      credentials: 'include' 
    });

    if (!meRes.ok) { 
      localStorage.removeItem('educa_mail_token');
      authEl.classList.remove('hidden');
      mainEl.classList.add('hidden');
      return; 
    }

    ME = await meRes.json();
    localStorage.setItem('educa_cached_identifier', ME.identifier);
    updateProfileUI(ME.identifier);
    await loadInbox();
  } catch(e) {
    await loadInbox();
  }
}

function updateProfileUI(id) {
  const name = (id.split('@')[0] || 'User').toUpperCase();
  const initLetter = initial(name);

  const acctAvatar = document.getElementById('acctAvatar');
  if (acctAvatar) acctAvatar.textContent = initLetter;

  const modalAvatar = document.getElementById('modalAcctAvatar');
  if (modalAvatar) modalAvatar.textContent = initLetter;

  const modalName = document.getElementById('modalAcctName');
  if (modalName) modalName.textContent = name;

  const modalEmail = document.getElementById('modalAcctEmail');
  if (modalEmail) modalEmail.textContent = id.includes('@') ? id : `${id}@educaveda.com`;

  const composeFrom = document.getElementById('composeFromEmail');
  if (composeFrom) composeFrom.textContent = id.includes('@') ? id : `${id}@educaveda.com`;
}

/* ================= 3. LOAD INBOX WITH STRICT DEDUPLICATION ================= */
async function loadInbox(){
  renderSkeletonList();
  try{
    if (!navigator.onLine) throw new Error('Offline');
    const res = await fetch(`${API_BASE}/messages`, { 
      headers: getAuthHeaders(),
      credentials:'include' 
    });
    if(!res.ok) throw new Error('session expired');
    const data = await res.json();
    
    // Strict Deduplication: filter by unique ID and unique content signature
    const rawList = Array.isArray(data) ? data : [];
    const seenIds = new Set();
    const seenContent = new Set();
    const cleanList = [];

    for (const m of rawList) {
      const id = String(m.id);
      if (seenIds.has(id)) continue;
      
      const timeKey = Math.floor(new Date(m.ts * 1000).getTime() / 3000);
      const signature = `${timeKey}_${m.from}_${m.subject}_${m.body}`;
      if (seenContent.has(signature)) continue;

      seenIds.add(id);
      seenContent.add(signature);
      cleanList.push(m);
    }

    currentInbox = cleanList;
    localStorage.setItem('educa_offline_inbox', JSON.stringify(currentInbox));
    renderList();
  } catch(e){
    const offlineData = localStorage.getItem('educa_offline_inbox');
    if (offlineData) {
      try {
        currentInbox = JSON.parse(offlineData);
        renderList();
        document.getElementById('offlineBanner')?.classList.remove('hidden');
        return;
      } catch (err) {}
    }
    document.getElementById('listScroll').innerHTML = `<div class="empty-state">No messages loaded. Click 🔄 to refresh.</div>`;
  }
}

/* ================= 4. FILTERING & LIST RENDERING ================= */
function getFilteredMessages(){
  const nowSec = Math.floor(Date.now() / 1000);
  const THREE_HOURS_SEC = 3 * 3600;

  return currentInbox.filter(m => {
    const id = String(m.id);
    
    // Permanently deleted check
    if (permanentlyDeletedIds.has(id)) return false;

    // 3-hour auto-expire
    if (m.ts && (nowSec - m.ts > THREE_HOURS_SEC)) return false;

    // Trash folder handling (Two-Stage Delete)
    if (currentFolder === 'trash') {
      return trashedIds.has(id);
    }
    if (trashedIds.has(id)) return false; // Trashed items don't appear in other folders

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

    // Inbox
    if (currentFolder === 'inbox') {
      if (trashedIds.has(id) || archivedIds.has(id) || spamIds.has(id)) return false;
    }

    // Category filter
    if (currentCategory !== 'all') {
      const text = `${m.subject || ''} ${m.body || ''}`.toLowerCase();
      if (currentCategory === 'updates' && !text.includes('otp') && !text.includes('security') && !text.includes('update')) return false;
      if (currentCategory === 'social' && !text.includes('social') && !text.includes('network') && !text.includes('team')) return false;
      if (currentCategory === 'promotions' && !text.includes('promo') && !text.includes('order') && !text.includes('sale')) return false;
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
  const unreadCount = currentInbox.filter(m => !m.read && !trashedIds.has(String(m.id)) && !archivedIds.has(String(m.id))).length;
  
  const inboxBadge = document.getElementById('inboxCount');
  if (inboxBadge) inboxBadge.textContent = unreadCount ? String(unreadCount) : '';
  
  const bBadge = document.getElementById('bottomNavBadge');
  if (bBadge) {
    if (unreadCount) {
      bBadge.textContent = unreadCount;
      bBadge.classList.remove('hidden');
    } else {
      bBadge.classList.add('hidden');
    }
  }

  
  // Dynamic Category Unread Badges (Only show if new mails exist)
  const updatesUnread = currentInbox.filter(m => !m.read && !trashedIds.has(String(m.id)) && `${m.subject || ''} ${m.body || ''}`.toLowerCase().match(/(otp|security|update)/)).length;
  const socialUnread = currentInbox.filter(m => !m.read && !trashedIds.has(String(m.id)) && `${m.subject || ''} ${m.body || ''}`.toLowerCase().match(/(social|network|team)/)).length;
  const promoUnread = currentInbox.filter(m => !m.read && !trashedIds.has(String(m.id)) && `${m.subject || ''} ${m.body || ''}`.toLowerCase().match(/(promo|order|sale)/)).length;

  const uBadge = document.getElementById('updatesBadge');
  if (uBadge) {
    if (updatesUnread > 0) {
      uBadge.textContent = `${updatesUnread} new`;
      uBadge.classList.remove('hidden');
    } else {
      uBadge.classList.add('hidden');
    }
  }

  const sBadge = document.getElementById('socialBadge');
  if (sBadge) {
    if (socialUnread > 0) {
      sBadge.textContent = `${socialUnread} new`;
      sBadge.classList.remove('hidden');
    } else {
      sBadge.classList.add('hidden');
    }
  }

  const pBadge = document.getElementById('promotionsBadge');
  if (pBadge) {
    if (promoUnread > 0) {
      pBadge.textContent = `${promoUnread} new`;
      pBadge.classList.remove('hidden');
    } else {
      pBadge.classList.add('hidden');
    }
  }

  const starredBadge = document.getElementById('starredCount');
  if (starredBadge) starredBadge.textContent = starredIds.size ? String(starredIds.size) : '';

  const wrap = document.getElementById('listScroll');

  let trashBannerHtml = '';
  if (currentFolder === 'trash' && filtered.length > 0) {
    trashBannerHtml = `
      <div class="trash-header-banner">
        <span>🗑️ Messages in Trash will be cleared automatically.</span>
        <button id="emptyTrashBtn" type="button" class="btn-empty-trash">Empty Trash Now</button>
      </div>
    `;
  }

  if(filtered.length === 0){ 
    wrap.innerHTML = trashBannerHtml + `<div class="empty-state">No messages in ${currentFolder}.</div>`; 
    return; 
  }

  wrap.innerHTML = trashBannerHtml + filtered.map((m) => {
    const isStarred = starredIds.has(String(m.id));
    const isSelected = activeSelectedMessage === m.id;
    const isUnread = !m.read;

    return `
    <div class="email-row-item ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''}" data-id="${esc(m.id)}">
      <div class="email-avatar">${esc(initial(m.from))}</div>
      <div class="email-main-body">
        <div class="email-header-line">
          <span class="email-sender">${esc(m.from.split('@')[0])}</span>
          <div class="email-date-wrap">
            ${isUnread ? '<span class="unread-dot"></span>' : ''}
            <span class="email-date">${esc(fmtTime(m.ts))}</span>
          </div>
        </div>
        <div class="email-subject">${esc(m.subject || 'No Subject')}</div>
        <div class="email-snippet-row">
          <span class="email-snippet">${esc(m.body ? m.body.slice(0, 65) + '...' : '')}</span>
          <button type="button" class="star-btn ${isStarred ? 'starred' : ''}" data-star-id="${esc(m.id)}">
            ${isStarred ? '★' : '☆'}
          </button>
        </div>
      </div>
    </div>
  `}).join('');

  document.getElementById('emptyTrashBtn')?.addEventListener('click', () => {
    if (confirm('Permanently delete all messages in Trash?')) {
      filtered.forEach(m => permanentlyDeletedIds.add(String(m.id)));
      localStorage.setItem('educa_perm_deleted_ids', JSON.stringify([...permanentlyDeletedIds]));
      trashedIds.clear();
      localStorage.setItem('educa_trashed_ids', JSON.stringify([]));
      renderList();
    }
  });
}

/* ================= 5. OPEN THREAD WITH 2-STAGE TRASH ================= */
async function openThread(id, clickedEl){
  activeSelectedMessage = id;
  document.querySelectorAll('.email-row-item').forEach(el=>el.classList.remove('selected'));
  if (clickedEl) clickedEl.classList.add('selected');
  
  document.getElementById('readPane')?.classList.add('mobile-active');

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
    document.getElementById('readPane').innerHTML = `<div class="no-selection-state"><h3>Message could not be loaded</h3></div>`; 
    return; 
  }

  msg.read = true;
  const isStarred = starredIds.has(String(id));
  const isArchived = archivedIds.has(String(id));
  const isTrashed = trashedIds.has(String(id));

  document.getElementById('readPane').innerHTML = `
    <div class="read-toolbar">
      <button id="mobileBackBtn" class="toolbar-btn" type="button">← Back</button>
      <button id="replyBtn" class="toolbar-btn" type="button">↩ Reply</button>
      <button id="forwardBtn" class="toolbar-btn" type="button">↪ Forward</button>
      <button id="starBtn" class="toolbar-btn ${isStarred ? 'active-star' : ''}" type="button">${isStarred ? '★ Starred' : '☆ Star'}</button>
      <button id="archiveBtn" class="toolbar-btn" type="button">${isArchived ? '📥 Unarchive' : '📦 Archive'}</button>
      ${isTrashed ? `
        <button id="restoreBtn" class="toolbar-btn" type="button">↩ Restore to Inbox</button>
        <button id="permDeleteBtn" class="toolbar-btn text-danger" type="button">🗑️ Delete Forever</button>
      ` : `
        <button id="trashBtn" class="toolbar-btn text-danger" type="button">🗑️ Move to Trash</button>
      `}
      <div class="spacer"></div>
      <span class="thread-time">${esc(fmtTime(msg.ts))}</span>
    </div>
    <div class="read-scroll">
      <div class="subject-banner">
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

  document.getElementById('mobileBackBtn')?.addEventListener('click', () => {
    document.getElementById('readPane')?.classList.remove('mobile-active');
  });

  document.getElementById('replyBtn')?.addEventListener('click', () => {
    openCompose(msg.from, `Re: ${msg.subject}`, `\n\n--- Original Message from ${msg.from} ---\n${msg.body}`);
  });

  document.getElementById('forwardBtn')?.addEventListener('click', () => {
    openCompose('', `Fwd: ${msg.subject}`, `\n\n--- Forwarded Message ---\nFrom: ${msg.from}\nDate: ${fmtTime(msg.ts)}\nSubject: ${msg.subject}\n\n${msg.body}`);
  });

  document.getElementById('starBtn')?.addEventListener('click', () => {
    if (starredIds.has(String(id))) starredIds.delete(String(id));
    else starredIds.add(String(id));
    localStorage.setItem('educa_starred_ids', JSON.stringify([...starredIds]));
    renderList();
    openThread(id, clickedEl);
  });

  document.getElementById('archiveBtn')?.addEventListener('click', () => {
    if (archivedIds.has(String(id))) archivedIds.delete(String(id));
    else archivedIds.add(String(id));
    localStorage.setItem('educa_archived_ids', JSON.stringify([...archivedIds]));
    renderList();
    openThread(id, clickedEl);
  });

  // Stage 1 Delete: Move to Trash
  document.getElementById('trashBtn')?.addEventListener('click', () => {
    trashedIds.add(String(id));
    localStorage.setItem('educa_trashed_ids', JSON.stringify([...trashedIds]));
    renderList();
    document.getElementById('readPane').innerHTML = `<div class="no-selection-state"><h3>Message moved to Trash 🗑️</h3></div>`;
    document.getElementById('readPane')?.classList.remove('mobile-active');
  });

  // Restore from Trash
  document.getElementById('restoreBtn')?.addEventListener('click', () => {
    trashedIds.delete(String(id));
    localStorage.setItem('educa_trashed_ids', JSON.stringify([...trashedIds]));
    renderList();
    openThread(id, clickedEl);
  });

  // Stage 2 Delete: Permanent Delete Forever
  document.getElementById('permDeleteBtn')?.addEventListener('click', async () => {
    if (confirm('Permanently delete this email? It cannot be recovered.')) {
      permanentlyDeletedIds.add(String(id));
      trashedIds.delete(String(id));
      localStorage.setItem('educa_perm_deleted_ids', JSON.stringify([...permanentlyDeletedIds]));
      localStorage.setItem('educa_trashed_ids', JSON.stringify([...trashedIds]));
      try {
        await fetch(`${API_BASE}/message/${encodeURIComponent(id)}/permanent`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
      } catch (e) {}
      renderList();
      document.getElementById('readPane').innerHTML = `<div class="no-selection-state"><h3>Message permanently deleted.</h3></div>`;
      document.getElementById('readPane')?.classList.remove('mobile-active');
    }
  });
}

/* ================= 6. COMPOSE EMAIL WITH USER DIRECTORY AUTOCOMPLETE ================= */
function openCompose(to='', subj='', body=''){
  document.getElementById('cTo').value = to;
  document.getElementById('cSubject').value = subj;
  document.getElementById('cBody').value = body;
  document.getElementById('composeMsg').textContent = '';
  document.getElementById('userSuggestionsDropdown')?.classList.add('hidden');
  document.getElementById('composeOverlay').classList.remove('hidden');
}

function closeCompose(){
  document.getElementById('composeOverlay').classList.add('hidden');
}

// User Directory Autocomplete Search
let suggTimeout = null;
async function searchUsersDirectory(query) {
  const drop = document.getElementById('userSuggestionsDropdown');
  if (!drop) return;
  if (!query || query.length < 1) {
    drop.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/directory?q=${encodeURIComponent(query)}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return;
    const users = await res.json();

    if (!Array.isArray(users) || users.length === 0) {
      drop.classList.add('hidden');
      return;
    }

    drop.innerHTML = users.map(u => `
      <div class="user-suggestion-row" data-id="${esc(u.email || u.identifier)}">
        <div class="user-sugg-avatar">${esc(initial(u.name))}</div>
        <div class="user-sugg-info">
          <span class="user-sugg-name">${esc(u.name)}</span>
          <span class="user-sugg-email">${esc(u.email || u.identifier)}</span>
        </div>
        <span class="user-sugg-role">${esc(u.role)}</span>
      </div>
    `).join('');

    drop.classList.remove('hidden');

    drop.querySelectorAll('.user-suggestion-row').forEach(row => {
      row.addEventListener('click', () => {
        document.getElementById('cTo').value = row.dataset.id;
        drop.classList.add('hidden');
      });
    });
  } catch (e) {
    drop.classList.add('hidden');
  }
}

async function sendCompose(){
  const to = document.getElementById('cTo').value.trim();
  const subject = document.getElementById('cSubject').value.trim();
  const body = document.getElementById('cBody').value.trim();
  const msgEl = document.getElementById('composeMsg');

  if(!to || !subject){
    msgEl.style.color = '#dc2626';
    msgEl.textContent = 'Recipient and Subject required';
    return;
  }

  try {
    msgEl.style.color = '#2563eb';
    msgEl.textContent = 'Sending email...';
    const res = await fetch(`${API_BASE}/mail/send`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ to, subject, body })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed to send');
    msgEl.style.color = '#16a34a';
    msgEl.textContent = '✓ Message sent!';
    setTimeout(() => {
      closeCompose();
      loadInbox();
    }, 900);
  } catch(e) {
    msgEl.style.color = '#dc2626';
    msgEl.textContent = e.message;
  }
}

/* ================= 7. GUARANTEED 1-CLICK LOGOUT ================= */
function logout(){
  localStorage.removeItem('educa_mail_token');
  localStorage.removeItem('educa_cached_identifier');
  localStorage.removeItem('educa_offline_inbox');
  try {
    fetch(`${API_BASE}/auth/logout`, { method:'POST', credentials: 'include' });
  } catch(e){}
  window.location.reload();
}

/* ================= 8. EVENT LISTENERS ================= */
window.addEventListener('DOMContentLoaded', () => {
  enterApp();

  // Navigation Items (with instant shimmer feedback)
  document.querySelectorAll('#sidebarNav .drawer-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sidebarNav .drawer-item, #labelsNav .drawer-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFolder = btn.dataset.folder;
      currentLabel = null;
      document.getElementById('appSidebar')?.classList.remove('mobile-open');
      document.getElementById('sidebarBackdrop')?.classList.add('hidden');
      
      renderSkeletonList();
      setTimeout(renderList, 180);
    });
  });

  // Labels
  document.querySelectorAll('#labelsNav .drawer-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sidebarNav .drawer-item, #labelsNav .drawer-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLabel = btn.dataset.label;
      document.getElementById('appSidebar')?.classList.remove('mobile-open');
      document.getElementById('sidebarBackdrop')?.classList.add('hidden');
      
      renderSkeletonList();
      setTimeout(renderList, 180);
    });
  });

  // Category Tabs
  document.querySelectorAll('.category-tabs-row .cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.category-tabs-row .cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategory = tab.dataset.cat;
      renderSkeletonList();
      setTimeout(renderList, 150);
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
    renderSkeletonList();
    setTimeout(renderList, 120);
  });
  searchClr?.addEventListener('click', () => {
    searchInp.value = '';
    searchQuery = '';
    searchClr.classList.add('hidden');
    renderList();
  });

  // Autocomplete on Compose 'To' field
  const toInput = document.getElementById('cTo');
  toInput?.addEventListener('input', (e) => {
    clearTimeout(suggTimeout);
    suggTimeout = setTimeout(() => {
      searchUsersDirectory(e.target.value.trim());
    }, 250);
  });

  // Star and Message Clicks
  document.getElementById('listScroll')?.addEventListener('click', (e) => {
    const starBtn = e.target.closest('.star-btn');
    if (starBtn && starBtn.dataset.starId) {
      e.stopPropagation();
      const sId = starBtn.dataset.starId;
      if (starredIds.has(sId)) starredIds.delete(sId);
      else starredIds.add(sId);
      localStorage.setItem('educa_starred_ids', JSON.stringify([...starredIds]));
      renderList();
      return;
    }

    const row = e.target.closest('.email-row-item');
    if (row && row.dataset.id) {
      openThread(row.dataset.id, row);
    }
  });

  // Account Switcher Dialog
  document.getElementById('profileAvatarBtn')?.addEventListener('click', () => {
    document.getElementById('accountModalOverlay')?.classList.remove('hidden');
  });
  document.getElementById('closeAccountModalBtn')?.addEventListener('click', () => {
    document.getElementById('accountModalOverlay')?.classList.add('hidden');
  });
  document.getElementById('accountModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'accountModalOverlay') {
      document.getElementById('accountModalOverlay')?.classList.add('hidden');
    }
  });

  // Mobile Menu Drawer Toggle
  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('appSidebar')?.classList.toggle('mobile-open');
    document.getElementById('sidebarBackdrop')?.classList.toggle('hidden');
  });
  document.getElementById('sidebarBackdrop')?.addEventListener('click', () => {
    document.getElementById('appSidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebarBackdrop')?.classList.add('hidden');
  });

  // Compose Buttons
  document.getElementById('composeBtn')?.addEventListener('click', () => openCompose());
  document.getElementById('mobileFabCompose')?.addEventListener('click', () => openCompose());
  document.getElementById('composeCloseBtn')?.addEventListener('click', closeCompose);
  document.getElementById('composeDiscardBtn')?.addEventListener('click', closeCompose);
  document.getElementById('sendComposeBtn')?.addEventListener('click', sendCompose);

  // Logout Buttons
  document.getElementById('dialogLogoutBtn')?.addEventListener('click', logout);
  document.getElementById('sidebarLogoutBtn')?.addEventListener('click', logout);
  document.getElementById('bNavLogout')?.addEventListener('click', logout);

  // Auth Tabs
  document.getElementById('tabLogin')?.addEventListener('click', () => {
    document.getElementById('tabLogin').classList.add('active');
    document.getElementById('tabSignup').classList.remove('active');
    document.getElementById('loginFields').classList.remove('hidden');
    document.getElementById('signupFields').classList.add('hidden');
  });
  document.getElementById('tabSignup')?.addEventListener('click', () => {
    document.getElementById('tabSignup').classList.add('active');
    document.getElementById('tabLogin').classList.remove('active');
    document.getElementById('signupFields').classList.remove('hidden');
    document.getElementById('loginFields').classList.add('hidden');
  });

  // Forgot password
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
        msgEl.textContent = 'Please enter identifier and password';
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
        if (!res.ok) throw new Error(data.error || 'Login failed');
        if (data.token) localStorage.setItem('educa_mail_token', data.token);
        if (data.identifier) localStorage.setItem('educa_cached_identifier', data.identifier);
        enterApp();
      } catch (err) {
        msgEl.textContent = err.message;
      }
    } else {
      const name = document.getElementById('signupName').value.trim();
      const phone = document.getElementById('signupPhone').value.trim();
      const password = document.getElementById('signupPassword').value;
      if (!name || !password) {
        msgEl.textContent = 'Name and Password (min 8 chars) required';
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
        if (!res.ok) throw new Error(data.error || 'Signup failed');
        if (data.token) localStorage.setItem('educa_mail_token', data.token);
        if (data.identifier) localStorage.setItem('educa_cached_identifier', data.identifier);
        enterApp();
      } catch (err) {
        msgEl.textContent = err.message;
      }
    }
  });
});
