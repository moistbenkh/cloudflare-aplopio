// Client portal (portal.html) — login, order history, files, revisions.
//
// Reuses the exact same magic-link endpoints as checkout.html's
// returning-client flow (/api/auth/request, /api/auth/verify) and the
// same aplo_client_token localStorage key, so a client who's already
// signed in on checkout.html lands here already authenticated, and vice
// versa — one token, one identity, used everywhere on the site.

document.addEventListener('DOMContentLoaded', () => {
    const CLIENT_TOKEN_KEY = 'aplo_client_token';

    const loginView   = document.getElementById('login-view');
    const ordersView  = document.getElementById('orders-view');
    const emailInput  = document.getElementById('portal-email');
    const sendBtn     = document.getElementById('portal-send-code');
    const codeEntry   = document.getElementById('portal-code-entry');
    const codeInput   = document.getElementById('portal-code');
    const verifyBtn   = document.getElementById('portal-verify-code');
    const resendLink  = document.getElementById('portal-resend');
    const loginMsg    = document.getElementById('portal-login-msg');
    const logoutBtn   = document.getElementById('portal-logout');
    const ordersStatus = document.getElementById('orders-status');
    const ordersList    = document.getElementById('orders-list');

    if (!loginView || !ordersView) return; // not on portal.html

    function getToken() {
        try { return localStorage.getItem(CLIENT_TOKEN_KEY); } catch (e) { return null; }
    }
    function setToken(token) {
        try { localStorage.setItem(CLIENT_TOKEN_KEY, token); } catch (e) {}
    }
    function clearToken() {
        try { localStorage.removeItem(CLIENT_TOKEN_KEY); } catch (e) {}
    }

    function showMsg(text) {
        if (!loginMsg) return;
        loginMsg.textContent = text;
        loginMsg.style.display = 'block';
    }
    function hideMsg() {
        if (loginMsg) loginMsg.style.display = 'none';
    }

    function showLoggedIn() {
        loginView.hidden = true;
        ordersView.hidden = false;
        loadOrders();
    }
    function showLoggedOut() {
        loginView.hidden = false;
        ordersView.hidden = true;
    }

    async function requestCode() {
        const email = (emailInput?.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showMsg('Enter a valid email address.');
            return;
        }
        if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
        hideMsg();
        try {
            const res = await fetch('/api/auth/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showMsg(data.error || `Could not send a code (error ${res.status}).`);
                return;
            }
            if (codeEntry) codeEntry.style.display = 'block';
            showMsg('Code sent — check your email.');
            if (codeInput) codeInput.focus();
        } catch (e) {
            console.error('portal auth/request failed:', e);
            showMsg('Connection error — try again.');
        } finally {
            if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send me a code'; }
        }
    }

    async function verifyCode() {
        const email = (emailInput?.value || '').trim();
        const code = (codeInput?.value || '').trim();
        if (!/^\d{6}$/.test(code)) {
            showMsg('Enter the 6-digit code from your email.');
            return;
        }
        if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…'; }
        hideMsg();
        try {
            const res = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.token) {
                showMsg(data.error || 'That code didn\'t work — try again.');
                return;
            }
            setToken(data.token);
            showLoggedIn();
        } catch (e) {
            console.error('portal auth/verify failed:', e);
            showMsg('Connection error — try again.');
        } finally {
            if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify'; }
        }
    }

    if (sendBtn) sendBtn.addEventListener('click', requestCode);
    if (resendLink) resendLink.addEventListener('click', (e) => { e.preventDefault(); requestCode(); });
    if (verifyBtn) verifyBtn.addEventListener('click', verifyCode);
    if (codeInput) {
        codeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); verifyCode(); }
        });
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            clearToken();
            showLoggedOut();
        });
    }

    const TIER_LABELS = { express: 'AI Express', custom: 'Custom by the Producer' };

    function badgeFor(order) {
        if (order.delivered_at) return { cls: 'badge-delivered', text: 'Delivered' };
        if (order.payment_status === 'paid') return { cls: 'badge-paid', text: 'Paid — in progress' };
        return { cls: 'badge-pending', text: 'Payment pending' };
    }

    function fmtDate(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
        catch (e) { return iso; }
    }

    async function apiGet(path) {
        const token = getToken();
        const res = await fetch(path, { headers: { 'X-Client-Token': token } });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    }

    async function loadOrders() {
        ordersStatus.textContent = 'Loading…';
        ordersList.innerHTML = '';

        const { ok, status, data } = await apiGet('/api/portal/orders');

        if (status === 401) {
            clearToken();
            showLoggedOut();
            return;
        }
        if (!ok) {
            ordersStatus.textContent = data.error || 'Could not load your orders.';
            return;
        }

        const orders = data.orders || [];
        if (orders.length === 0) {
            ordersStatus.textContent = "No orders yet — head to the checkout page to start one.";
            return;
        }
        ordersStatus.textContent = '';

        orders.forEach((order) => renderOrder(order));
    }

    function renderOrder(order) {
        const badge = badgeFor(order);
        const card = document.createElement('div');
        card.className = 'portal-order';
        card.innerHTML = `
          <div class="portal-order-top">
            <div>
              <div class="portal-order-tier">${escapeHtml(TIER_LABELS[order.tier] || order.tier)} — Order #${order.id}</div>
              <div class="portal-order-meta">Placed ${escapeHtml(fmtDate(order.created_at))}${order.brand_name ? ' · ' + escapeHtml(order.brand_name) : ''}</div>
            </div>
            <span class="portal-badge ${badge.cls}">${badge.text}</span>
          </div>
          <div class="portal-files" id="files-${order.id}">
            <p class="hint">Loading files…</p>
          </div>
          ${order.payment_status === 'paid' ? `
          <div class="portal-revision" id="revision-${order.id}">
            <a href="#" class="portal-revision-toggle" data-order="${order.id}">Request a revision</a>
          </div>` : ''}
        `;
        ordersList.appendChild(card);

        loadFiles(order.id);

        const toggle = card.querySelector('.portal-revision-toggle');
        if (toggle) {
            toggle.addEventListener('click', (e) => {
                e.preventDefault();
                renderRevisionForm(order.id);
            });
        }
    }

    async function loadFiles(orderId) {
        const container = document.getElementById(`files-${orderId}`);
        if (!container) return;

        const { ok, data } = await apiGet(`/api/portal/orders/${orderId}/files`);
        if (!ok) {
            container.innerHTML = '<p class="hint">Could not load files.</p>';
            return;
        }

        const files = data.files || [];
        if (files.length === 0) {
            container.innerHTML = '<p class="hint">No files delivered yet — we\'ll email you when they\'re ready.</p>';
            return;
        }

        container.innerHTML = files.map((f) => `
          <div class="portal-file-row">
            <div><span class="portal-file-name">${escapeHtml(f.label || f.filename)}</span>${f.label ? `<span class="portal-file-label">${escapeHtml(f.filename)}</span>` : ''}</div>
            <div class="portal-file-actions">
              <button class="play-file-btn" data-url="${f.play_url}">▶ Play</button>
              <a href="${f.download_url}">Download</a>
            </div>
          </div>
        `).join('');

        let currentAudio = null;
        container.querySelectorAll('.play-file-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (currentAudio) { currentAudio.pause(); currentAudio = null; }
                const isPlaying = btn.dataset.playing === '1';
                container.querySelectorAll('.play-file-btn').forEach((b) => { b.textContent = '▶ Play'; b.dataset.playing = '0'; });
                if (isPlaying) return;
                const audio = new Audio(btn.dataset.url);
                currentAudio = audio;
                btn.textContent = '⏸ Playing…';
                btn.dataset.playing = '1';
                audio.addEventListener('ended', () => { btn.textContent = '▶ Play'; btn.dataset.playing = '0'; });
                audio.play().catch((err) => {
                    console.error('Portal playback failed:', err);
                    btn.textContent = '▶ Play';
                    btn.dataset.playing = '0';
                });
            });
        });
    }

    function renderRevisionForm(orderId) {
        const wrap = document.getElementById(`revision-${orderId}`);
        if (!wrap || wrap.dataset.expanded === '1') return;
        wrap.dataset.expanded = '1';
        wrap.innerHTML = `
          <textarea id="revision-notes-${orderId}" placeholder="What would you like changed?"></textarea>
          <button class="btn btn-primary" id="revision-submit-${orderId}">Send revision request</button>
          <p class="hint" id="revision-msg-${orderId}" style="display:none; margin-top:8px;"></p>
        `;
        const submitBtn = document.getElementById(`revision-submit-${orderId}`);
        const notesEl = document.getElementById(`revision-notes-${orderId}`);
        const msgEl = document.getElementById(`revision-msg-${orderId}`);

        submitBtn.addEventListener('click', async () => {
            const notes = (notesEl.value || '').trim();
            if (!notes) {
                msgEl.textContent = 'Add a note describing the change.';
                msgEl.style.display = 'block';
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending…';
            try {
                const token = getToken();
                const res = await fetch(`/api/portal/orders/${orderId}/revision`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Client-Token': token },
                    body: JSON.stringify({ notes }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    msgEl.textContent = data.error || 'Could not send that. Try again.';
                    msgEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Send revision request';
                    return;
                }
                wrap.innerHTML = '<p class="hint">Revision request sent — we\'ll follow up by email.</p>';
            } catch (e) {
                console.error('revision submit failed:', e);
                msgEl.textContent = 'Connection error — try again.';
                msgEl.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send revision request';
            }
        });
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Boot: if we already have a token, try it — /api/portal/orders
    // returning 401 (handled in loadOrders) falls back to the login view
    // automatically for an expired/invalid token.
    if (getToken()) {
        showLoggedIn();
    } else {
        showLoggedOut();
    }
});
