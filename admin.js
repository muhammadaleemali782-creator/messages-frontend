// admin.js
// Same principles as app.js: no inline handlers, external file, escapes all
// server-returned text before rendering. Talks to /admin/* routes only,
// which use a completely separate cookie (admin_session) from the regular
// user session - opening this page never gives access to any user account.

function esc(str){
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
function fmtTime(ts){ return new Date(ts*1000).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }

async function adminLogin(){
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value;
  const msgEl = document.getElementById('adminAuthMsg');
  msgEl.textContent = '';
  try{
    const res = await fetch(`${API_BASE}/admin/login`, {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Login failed');
    await enterAdminPanel();
  }catch(e){ msgEl.textContent = e.message; }
}

async function adminLogout(){
  await fetch(`${API_BASE}/admin/logout`, { method:'POST', credentials:'include' });
  location.reload();
}

async function enterAdminPanel(){
  const meRes = await fetch(`${API_BASE}/admin/me`, { credentials:'include' });
  if(!meRes.ok) return;
  document.getElementById('adminAuthScreen').classList.add('hidden');
  document.getElementById('adminPanel').classList.remove('hidden');
  await loadRequests();
}

async function loadRequests(){
  const wrap = document.getElementById('requestList');
  wrap.innerHTML = '<p>Loading...</p>';
  try{
    const res = await fetch(`${API_BASE}/admin/requests`, { credentials:'include' });
    if(!res.ok) throw new Error('session expired');
    const requests = await res.json();
    if(requests.length === 0){
      wrap.innerHTML = '<p style="color:var(--text-faint);">Koi pending request nahi hai.</p>';
      return;
    }
    wrap.innerHTML = requests.map(r => `
      <div class="req-card" data-id="${esc(r.id)}">
        <div class="row"><span class="label">Product</span><span>${esc(r.product)}</span></div>
        <div class="row"><span class="label">Identifier</span><span>${esc(r.identifier)}</span></div>
        <div class="row"><span class="label">Contact</span><span>${esc(r.contact || '-')}</span></div>
        <div class="row"><span class="label">Requested</span><span>${esc(fmtTime(r.createdAt))}</span></div>
        <input class="auth-input req-newpass" placeholder="Naya password (khaali chhodo to auto-generate hoga)">
        <button type="button" class="send-btn full req-resolve-btn">Password Reset Karein</button>
        <div class="req-result"></div>
      </div>
    `).join('');
  }catch(e){
    wrap.innerHTML = '<p style="color:var(--accent-red);">Session expire ho gayi, dobara login karein.</p>';
  }
}

async function resolveRequest(card){
  const id = card.dataset.id;
  const newPassword = card.querySelector('.req-newpass').value.trim();
  const resultEl = card.querySelector('.req-result');
  resultEl.textContent = 'Processing...';
  try{
    const res = await fetch(`${API_BASE}/admin/requests/${encodeURIComponent(id)}/resolve`, {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify(newPassword ? { newPassword } : {})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed');
    resultEl.innerHTML = `
      <div class="result-box">
        Naya password: <span class="pw">${esc(data.newPassword)}</span><br>
        Ye ${esc(data.identifier)} ke liye hai. Contact: ${esc(data.contact || 'diya nahi gaya')}.<br>
        Ise ab WhatsApp/call se manually bhej dein - dobara yahan nahi dikhega.
      </div>`;
    card.querySelector('.req-resolve-btn').disabled = true;
    card.querySelector('.req-newpass').disabled = true;
  }catch(e){
    resultEl.textContent = 'Error: ' + e.message;
  }
}

document.getElementById('adminLoginBtn').addEventListener('click', adminLogin);
document.getElementById('adminLogoutBtn').addEventListener('click', adminLogout);
['adminUsername','adminPassword'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') adminLogin(); });
});

// event delegation for dynamically rendered request cards
document.getElementById('requestList').addEventListener('click', (e) => {
  if (e.target.classList.contains('req-resolve-btn')) {
    resolveRequest(e.target.closest('.req-card'));
  }
});

enterAdminPanel();
