document.addEventListener('DOMContentLoaded', () => {
    const keyGate = document.getElementById('key-gate');
    const keyInput = document.getElementById('key-input');
    const keySubmit = document.getElementById('key-submit');
    const adminContent = document.getElementById('admin-content');
    const statusEl = document.getElementById('order-status');
    const listEl = document.getElementById('order-list');
    const logoutBtn = document.getElementById('logout-btn');

    let allOrders = [];
    let orderFilter = 'all';
    let ordersLoaded = false;

    // Key is kept in sessionStorage only — cleared when the tab closes, not
    // written to localStorage, so it doesn't linger indefinitely on a shared
    // or public machine.
    function getStoredKey() {
        return sessionStorage.getItem('admin_key') || '';
    }
    function setStoredKey(key) {
        sessionStorage.setItem('admin_key', key);
    }
    function clearStoredKey() {
        sessionStorage.removeItem('admin_key');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }
    function escapeAttr(str) {
        return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function badgeFor(order) {
        if (order.delivered_at) return { cls: 'badge-delivered', label: 'Delivered' };
        if (order.payment_status === 'paid') return { cls: 'badge-paid', label: 'Paid' };
        return { cls: 'badge-pending', label: 'Pending payment' };
    }

    function renderOrders(orders) {
        if (orders.length === 0) {
            listEl.innerHTML = '<p class="hint">No orders yet.</p>';
            return;
        }
        listEl.innerHTML = '';
        orders.forEach((order) => {
            const badge = badgeFor(order);
            const card = document.createElement('div');
            card.className = 'order-card';
            card.innerHTML = `
                <div class="order-top">
                    <div>
                        <strong>${escapeHtml(order.brand || order.name)}</strong>
                        <div class="order-field">${escapeHtml(order.name)} · <a href="mailto:${escapeHtml(order.email)}">${escapeHtml(order.email)}</a></div>
                    </div>
                    <span class="order-badge ${badge.cls}">${badge.label}</span>
                </div>
                <div class="order-field"><b>Tier:</b> ${escapeHtml(order.tier)}${order.ad_length ? ' · ' + escapeHtml(order.ad_length) : ''}</div>
                <div class="order-field"><b>Vibe:</b> ${escapeHtml(order.vibe || '—')}</div>
                <div class="order-field"><b>Submitted:</b> ${escapeHtml(order.created_at)}</div>
                <div class="order-actions">
                    <button data-action="paid" data-id="${order.id}" ${order.payment_status === 'paid' ? 'disabled' : ''}>Mark Paid</button>
                    <button data-action="delivered" data-id="${order.id}" ${order.delivered_at ? 'disabled' : ''}>Mark Delivered</button>
                </div>
                <div class="order-files">
                    <div class="order-files-title">Deliverable files</div>
                    <div class="order-files-list">${renderFileList(order.id, order.files || [])}</div>
                    <div class="file-upload-row">
                        <input type="text" class="file-label-input" data-order="${order.id}" placeholder="Label (e.g. Final Mix)">
                        <input type="file" class="file-input" data-order="${order.id}">
                        <button class="file-upload-btn" data-order="${order.id}">Upload &amp; send to client</button>
                    </div>
                    <p class="file-upload-status" data-order="${order.id}"></p>
                </div>
                <div class="order-license">
                    <div class="order-files-title">License</div>
                    ${renderLicenseStatus(order.license)}
                    <button class="generate-license-btn" data-order="${order.id}" ${order.payment_status !== 'paid' ? 'disabled title="Mark order paid first"' : ''}>
                        ${order.license ? 'Resend license &amp; files' : 'Generate license'}
                    </button>
                    <p class="license-status" data-order="${order.id}"></p>
                </div>
            `;
            listEl.appendChild(card);
        });

        listEl.querySelectorAll('button[data-action]').forEach((btn) => {
            btn.addEventListener('click', () => updateOrderStatus(btn.dataset.id, btn.dataset.action));
        });

        listEl.querySelectorAll('.file-upload-btn').forEach((btn) => {
            btn.addEventListener('click', () => uploadOrderFile(btn.dataset.order));
        });

        listEl.querySelectorAll('.order-file-remove').forEach((btn) => {
            btn.addEventListener('click', () => removeOrderFile(btn.dataset.order, btn.dataset.file));
        });

        listEl.querySelectorAll('.generate-license-btn').forEach((btn) => {
            btn.addEventListener('click', () => generateLicense(btn.dataset.order));
        });
    }

    function renderLicenseStatus(license) {
        if (!license) return '<p class="hint" style="margin:0 0 4px;">No license issued yet.</p>';
        const issued = license.issued_at ? new Date(license.issued_at).toLocaleDateString() : '';
        return `<p class="hint" style="margin:0 0 4px;">${escapeHtml(license.license_number)}${issued ? ' · issued ' + escapeHtml(issued) : ''} — <a href="/api/license/${escapeAttr(license.id)}" target="_blank" rel="noopener">view</a></p>`;
    }

    async function generateLicense(orderId) {
        const btn = document.querySelector(`.generate-license-btn[data-order="${orderId}"]`);
        const statusEl = document.querySelector(`.license-status[data-order="${orderId}"]`);
        const key = getStoredKey();
        btn.disabled = true;
        statusEl.textContent = 'Generating and emailing client…';

        try {
            const res = await fetch(`/api/admin/orders/${orderId}/generate-license`, {
                method: 'POST',
                headers: { 'X-Admin-Key': key },
            });
            const data = await res.json();
            if (!res.ok) {
                statusEl.textContent = `Error: ${data.error || 'Could not generate license'}`;
                btn.disabled = false;
                return;
            }
            statusEl.textContent = data.emailed
                ? '✓ License ready — client emailed.'
                : `✓ License ready, but email failed to send${data.email_error ? ': ' + data.email_error : ''}.`;
            loadOrders();
        } catch (err) {
            console.error('Generate license failed:', err);
            statusEl.textContent = 'Connection error.';
            btn.disabled = false;
        }
    }

    function renderFileList(orderId, files) {
        if (!files.length) return '<p class="hint" style="margin:0 0 4px;">No files delivered yet.</p>';
        return files.map((f) => `
            <div class="order-file-row">
                <span><span class="fname">${escapeHtml(f.filename)}</span>${f.label ? `<span class="flabel">${escapeHtml(f.label)}</span>` : ''}</span>
                <button class="order-file-remove" data-order="${orderId}" data-file="${f.id}">Remove</button>
            </div>
        `).join('');
    }

    async function uploadOrderFile(orderId) {
        const labelInput = document.querySelector(`.file-label-input[data-order="${orderId}"]`);
        const fileInput = document.querySelector(`.file-input[data-order="${orderId}"]`);
        const btn = document.querySelector(`.file-upload-btn[data-order="${orderId}"]`);
        const statusEl = document.querySelector(`.file-upload-status[data-order="${orderId}"]`);
        const file = fileInput?.files[0] || null;
        const label = (labelInput?.value || '').trim();

        if (!file) { statusEl.textContent = 'Choose a file first.'; return; }

        const key = getStoredKey();
        btn.disabled = true;
        statusEl.textContent = 'Uploading and emailing client…';

        try {
            const form = new FormData();
            form.append('file', file);
            if (label) form.append('label', label);

            const res = await fetch(`/api/admin/orders/${orderId}/upload`, {
                method: 'POST',
                headers: { 'X-Admin-Key': key },
                body: form,
            });
            const data = await res.json();
            if (!res.ok) {
                statusEl.textContent = `Error: ${data.error || 'Upload failed'}`;
                btn.disabled = false;
                return;
            }
            statusEl.textContent = data.emailed
                ? '✓ Uploaded — client emailed.'
                : `✓ Uploaded, but email failed to send${data.email_error ? ': ' + data.email_error : ''}.`;
            if (fileInput) fileInput.value = '';
            if (labelInput) labelInput.value = '';
            loadOrders();
        } catch (err) {
            console.error('Order file upload failed:', err);
            statusEl.textContent = 'Connection error.';
            btn.disabled = false;
        }
    }

    async function removeOrderFile(orderId, fileId) {
        if (!confirm('Remove this file from the order? (It stays in R2; this just stops future delivery emails from including it.)')) return;
        const key = getStoredKey();
        try {
            const res = await fetch(`/api/admin/orders/${orderId}/files?file=${encodeURIComponent(fileId)}`, {
                method: 'DELETE',
                headers: { 'X-Admin-Key': key },
            });
            if (res.ok) loadOrders();
            else alert('Could not remove file.');
        } catch (err) {
            console.error('Remove file failed:', err);
            alert('Connection error.');
        }
    }

    async function loadOrders() {
        const key = getStoredKey();
        statusEl.textContent = 'Loading…';
        try {
            const res = await fetch('/api/orders', {
                headers: { 'X-Admin-Key': key }
            });
            if (res.status === 401) {
                clearStoredKey();
                showKeyGate('Key rejected — try again.');
                return;
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load orders');

            allOrders = data.orders;
            ordersLoaded = true;
            applyOrderView();
        } catch (err) {
            console.error('Failed to load orders:', err);
            statusEl.textContent = 'Could not load orders. Try refreshing.';
        }
    }

    function orderStatusOf(order) {
        if (order.delivered_at) return 'delivered';
        if (order.payment_status === 'paid') return 'paid';
        return 'pending';
    }

    function applyOrderView() {
        const q = (document.getElementById('order-search')?.value || '').trim().toLowerCase();
        const filtered = allOrders.filter((o) => {
            const matchesFilter = orderFilter === 'all' || orderStatusOf(o) === orderFilter;
            if (!matchesFilter) return false;
            if (!q) return true;
            return [o.name, o.brand, o.email].some((v) => (v || '').toLowerCase().includes(q));
        });
        statusEl.textContent = `${filtered.length} order${filtered.length === 1 ? '' : 's'}${orderFilter !== 'all' ? ' · ' + orderFilter : ''}`;
        renderOrders(filtered);
    }

    async function updateOrderStatus(id, status) {
        const key = getStoredKey();
        try {
            const res = await fetch(`/api/orders/${id}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.error || 'Update failed');
                return;
            }
            loadOrders();
        } catch (err) {
            console.error('Status update failed:', err);
            alert('Connection error — try again.');
        }
    }

    function showKeyGate(message) {
        keyGate.hidden = false;
        adminContent.hidden = true;
        if (message) {
            let hint = keyGate.querySelector('.hint');
            hint.textContent = message;
        }
        keyInput.value = '';
        keyInput.focus();
    }

    function showAdminContent() {
        keyGate.hidden = true;
        adminContent.hidden = false;
        loadDashboard();
    }

    keySubmit.addEventListener('click', () => {
        const key = keyInput.value.trim();
        if (!key) return;
        setStoredKey(key);
        showAdminContent();
    });
    keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') keySubmit.click();
    });
    logoutBtn.addEventListener('click', () => {
        clearStoredKey();
        showKeyGate();
    });

    // Top-level tab switching (Dashboard / Orders / Sample Library) — scoped
    // to just the top tab bar so it doesn't also react to the order-status
    // filter pills below, which reuse the same .admin-tab class for styling.
    document.querySelectorAll('#main-tabs > .admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#main-tabs > .admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
            if (tab.dataset.tab === 'samples') loadSampleAdmin();
            if (tab.dataset.tab === 'orders' && !ordersLoaded) loadOrders();
            if (tab.dataset.tab === 'dashboard') loadDashboard();
        });
    });

    // Order status filter pills + search box
    document.getElementById('order-filter-tabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        document.querySelectorAll('#order-filter-tabs .filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        orderFilter = btn.dataset.filter;
        applyOrderView();
    });
    document.getElementById('order-search')?.addEventListener('input', applyOrderView);

    // ── Dashboard ────────────────────────────────────────────────────────────

    let dashDays = 30;
    const money = (n) => `$${n.toLocaleString()}`;
    const TIER_PRICES = { express: 50, custom: 200 }; // must match checkout.html / js/main.js TIER_PRICES

    function fmtDuration(sec) {
        if (sec == null) return '—';
        const m = Math.floor(sec / 60), s = Math.round(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function escapeAttrLocal(str) {
        return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function loadDashboard() {
        const key = getStoredKey();

        // Orders need to be loaded regardless of which sub-tab is active,
        // since the dashboard's own stat cards summarize them.
        if (!ordersLoaded) await loadOrders();
        renderOrderStats();
        renderAttentionList();

        const trafficEls = [
            document.getElementById('dash-traffic-stats'),
            document.getElementById('dash-chart'),
            document.getElementById('dash-top-pages'),
            document.getElementById('dash-instrumentals'),
            document.getElementById('dash-referrers'),
        ];

        try {
            const res = await fetch(`/api/admin/analytics?days=${dashDays}`, { headers: { 'X-Admin-Key': key } });
            if (res.status === 401) { clearStoredKey(); showKeyGate('Key rejected — try again.'); return; }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load analytics');
            renderTrafficStats(data);
            renderChart(data.views_by_day);
            renderRankList('dash-top-pages', data.top_pages, (r) => r.path, (r) => r.views);
            renderRankList('dash-referrers', data.top_referrers, (r) => r.referrer, (r) => r.n);
            renderInstrumentals(data.top_instrumentals);
        } catch (err) {
            console.error('Failed to load analytics:', err);
            trafficEls.forEach((el) => { if (el) el.innerHTML = '<p class="dash-empty">Could not load analytics.</p>'; });
        }
    }

    function renderOrderStats() {
        const el = document.getElementById('dash-order-stats');
        if (!el) return;
        const pending = allOrders.filter(o => orderStatusOf(o) === 'pending').length;
        const paid = allOrders.filter(o => orderStatusOf(o) === 'paid').length;
        const delivered = allOrders.filter(o => orderStatusOf(o) === 'delivered').length;
        // payment_amount stores the payment provider's sale id, not a dollar
        // figure — revenue is derived from tier pricing on paid+ orders instead.
        const revenue = allOrders
            .filter(o => o.payment_status === 'paid')
            .reduce((sum, o) => sum + (TIER_PRICES[o.tier] || 0), 0);

        el.innerHTML = `
            <div class="stat-card"><div class="stat-value">${allOrders.length}</div><div class="stat-label">Total orders</div></div>
            <div class="stat-card"><div class="stat-value">${pending}</div><div class="stat-label">Pending payment</div></div>
            <div class="stat-card"><div class="stat-value">${paid}</div><div class="stat-label">Paid — to deliver</div></div>
            <div class="stat-card"><div class="stat-value">${delivered}</div><div class="stat-label">Delivered</div></div>
            <div class="stat-card accent"><div class="stat-value">${money(revenue)}</div><div class="stat-label">Revenue (paid orders)</div></div>
        `;
    }

    function renderAttentionList() {
        const el = document.getElementById('dash-attention');
        if (!el) return;
        const needsAttention = allOrders.filter(o => orderStatusOf(o) === 'paid'); // paid but not yet delivered
        if (!needsAttention.length) {
            el.innerHTML = '<li class="dash-empty">Nothing pending — all paid orders are delivered.</li>';
            return;
        }
        el.innerHTML = needsAttention.slice(0, 8).map((o) => `
            <li><span class="rank-label">${escapeHtml(o.brand || o.name)} · ${escapeHtml(o.tier)}</span>
                <span class="rank-value">${escapeHtml((o.created_at || '').slice(0, 10))}</span></li>
        `).join('');
    }

    function renderTrafficStats(data) {
        const el = document.getElementById('dash-traffic-stats');
        if (!el) return;
        el.innerHTML = `
            <div class="stat-card accent-2"><div class="stat-value">${data.unique_sessions.toLocaleString()}</div><div class="stat-label">Visitors (${data.days}d)</div></div>
            <div class="stat-card"><div class="stat-value">${data.pageviews_total.toLocaleString()}</div><div class="stat-label">Pageviews (${data.days}d)</div></div>
            <div class="stat-card"><div class="stat-value">${data.plays_total.toLocaleString()}</div><div class="stat-label">Instrumental plays (${data.days}d)</div></div>
        `;
    }

    function renderChart(rows) {
        const el = document.getElementById('dash-chart');
        if (!el) return;
        if (!rows || !rows.length) { el.innerHTML = '<p class="dash-empty">No traffic recorded yet for this range.</p>'; return; }
        const max = Math.max(...rows.map(r => r.views), 1);
        const bars = rows.map(r => {
            const pct = Math.max(2, Math.round((r.views / max) * 100));
            const d = new Date(r.day + 'T00:00:00');
            const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return `<div class="bar" style="height:${pct}%" data-tip="${escapeAttrLocal(label)}: ${r.views}"></div>`;
        }).join('');
        const first = rows[0].day, last = rows[rows.length - 1].day;
        el.innerHTML = `<div class="bar-chart">${bars}</div><div class="bar-chart-labels"><span>${escapeHtml(first)}</span><span>${escapeHtml(last)}</span></div>`;
    }

    function renderRankList(elId, rows, labelFn, valueFn) {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!rows || !rows.length) { el.innerHTML = '<li class="dash-empty">No data yet.</li>'; return; }
        el.innerHTML = rows.map((r, i) => `
            <li><span class="rank-n">${i + 1}</span>
                <span class="rank-label" title="${escapeAttrLocal(labelFn(r))}">${escapeHtml(labelFn(r))}</span>
                <span class="rank-value">${valueFn(r).toLocaleString()}</span></li>
        `).join('');
    }

    function renderInstrumentals(rows) {
        const el = document.getElementById('dash-instrumentals');
        if (!el) return;
        if (!rows || !rows.length) { el.innerHTML = '<p class="dash-empty">No plays recorded yet for this range.</p>'; return; }
        el.innerHTML = `
            <table class="instr-table">
                <thead><tr><th>Track</th><th>Plays</th><th>Avg. listen</th><th>Completion</th></tr></thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${escapeHtml(r.sample_title || r.sample_id)}</td>
                            <td>${r.plays.toLocaleString()}</td>
                            <td>${fmtDuration(r.avg_seconds_played)}${r.track_duration_seconds ? ` / ${fmtDuration(r.track_duration_seconds)}` : ''}</td>
                            <td>${r.completion_rate != null
                                ? `<span class="completion-track"><span class="completion-fill" style="width:${Math.round(r.completion_rate * 100)}%"></span></span>${Math.round(r.completion_rate * 100)}%`
                                : '—'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    document.getElementById('dash-range')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-days]');
        if (!btn) return;
        document.querySelectorAll('#dash-range button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dashDays = parseInt(btn.dataset.days, 10);
        loadDashboard();
    });

    const GUMROAD_INSTRUMENTAL_URL = 'https://nvsgtech.gumroad.com/l/lwvbd';

    function instrumentalBuyUrl(sampleId) {
        const sep = GUMROAD_INSTRUMENTAL_URL.includes('?') ? '&' : '?';
        return `${GUMROAD_INSTRUMENTAL_URL}${sep}sample=${encodeURIComponent(sampleId)}`;
    }

    window.copyBuyLink = function(id, btn) {
        const url = instrumentalBuyUrl(id);
        navigator.clipboard.writeText(url).then(() => {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = original; }, 1500);
        }).catch(() => {
            prompt('Copy this link:', url);
        });
    };

    // ── Sample admin ──────────────────────────────────────────────────────────

    let sampleAdminData = []; // cached list for edit modal

    async function loadSampleAdmin() {
        const listEl = document.getElementById('sample-admin-list');
        listEl.innerHTML = '<p class="hint">Loading…</p>';
        const key = getStoredKey();
        try {
            const res = await fetch('/api/sample-list', { headers: { 'X-Admin-Key': key } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load samples');
            const samples = data.samples || [];
            sampleAdminData = samples;
            if (samples.length === 0) {
                listEl.innerHTML = '<p class="hint">No samples registered yet.</p>';
                return;
            }
            listEl.innerHTML = samples.map(s => `
                <div class="sample-row" id="sample-row-${s.id}">
                    ${s.cover_url
                        ? `<img src="${escapeAttr(s.cover_url)}" alt="cover" style="width:54px;height:54px;object-fit:cover;border-radius:6px;flex-shrink:0;">`
                        : `<div style="width:54px;height:54px;background:var(--panel-2);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                             <svg viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.5" width="22" height="22">
                               <circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l7 3.5-7 3.5V8.5z" fill="var(--dim)" stroke="none"/>
                             </svg>
                           </div>`}
                    <div class="sample-row-info" style="flex:1;min-width:0;">
                        <div class="sample-row-title">${escapeHtml(s.title)}</div>
                        <div class="sample-row-meta">
                            ${s.genre ? s.genre.toUpperCase() + ' · ' : ''}
                            ${s.bpm ? s.bpm + ' BPM · ' : ''}
                            <span style="color:${s.revisable ? '#50c864' : '#e05c1a'}">${s.revisable ? '✓ Revisable' : '✕ No project file'}</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                        <button onclick="openEditModal('${s.id}')" class="sa-btn sa-btn-dim">Edit</button>
                        <button onclick="copyBuyLink('${s.id}', this)" class="sa-btn sa-btn-signal">Copy buy link</button>
                        <button onclick="deleteSample('${s.id}', this)" class="sa-btn sa-btn-dim">Remove</button>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            listEl.innerHTML = '<p class="hint">Failed to load samples.</p>';
        }
    }

    window.deleteSample = async function(id, btn) {
        if (!confirm('Remove this sample from the library? (File stays in R2)')) return;
        btn.textContent = 'Removing…';
        const key = getStoredKey();
        try {
            const res = await fetch(`/api/admin/samples?id=${id}`, { method: 'DELETE', headers: { 'X-Admin-Key': key } });
            if (res.ok) loadSampleAdmin();
            else btn.textContent = 'Error';
        } catch { btn.textContent = 'Error'; }
    };

    // ── Edit modal ────────────────────────────────────────────────────────────

    window.openEditModal = async function(id) {
        const sample = sampleAdminData.find(s => s.id === id);
        if (!sample) return;

        const modal = document.getElementById('edit-modal');
        document.getElementById('edit-sample-id').value = id;
        document.getElementById('edit-title').value = sample.title || '';
        document.getElementById('edit-genre').value = sample.genre || '';
        document.getElementById('edit-bpm').value = sample.bpm || '';
        document.getElementById('edit-revisable').value = sample.revisable ? '1' : '0';
        document.getElementById('edit-status').textContent = '';
        document.getElementById('edit-cover-status').textContent = '';
        document.getElementById('edit-stem-status').textContent = '';
        document.getElementById('edit-cover').value = '';
        document.getElementById('edit-stem-file').value = '';
        document.getElementById('edit-stem-label').value = '';

        const coverPreview = document.getElementById('edit-cover-preview');
        if (coverPreview) {
            if (sample.cover_url) {
                coverPreview.src = sample.cover_url;
                coverPreview.style.display = 'block';
            } else {
                coverPreview.removeAttribute('src');
                coverPreview.style.display = 'none';
            }
        }

        // Load stems
        await loadStems(id);

        modal.hidden = false;
        modal.style.display = 'flex';
    };

    async function loadStems(sampleId) {
        const key = getStoredKey();
        const stemList = document.getElementById('edit-stem-list');
        stemList.innerHTML = '<span style="font-size:12px;color:var(--dim);">Loading stems…</span>';
        try {
            const res = await fetch(`/api/admin/samples/${sampleId}/stems`, { headers: { 'X-Admin-Key': key } });
            const data = await res.json();
            const stems = data.stems || [];
            if (stems.length === 0) {
                stemList.innerHTML = '<span style="font-size:12px;color:var(--dim);">No stems uploaded yet.</span>';
                return;
            }
            stemList.innerHTML = stems.map(stem => `
                <div class="order-file-row" style="margin-bottom:4px;">
                    <span>
                        <span class="flabel" style="color:var(--signal);margin-right:6px;">${escapeHtml(stem.label)}</span>
                        <span class="fname">${escapeHtml(stem.filename)}</span>
                        ${stem.size_bytes ? `<span style="font-size:11px;color:var(--dim);margin-left:6px;">${(stem.size_bytes/1024/1024).toFixed(1)}MB</span>` : ''}
                    </span>
                    <button onclick="deleteStem('${stem.id}', '${sampleId}', this)" style="background:none;border:none;color:var(--dim);font-size:12px;cursor:pointer;">Remove</button>
                </div>
            `).join('');
        } catch {
            stemList.innerHTML = '<span style="font-size:12px;color:var(--dim);">Failed to load stems.</span>';
        }
    }

    window.deleteStem = async function(stemId, sampleId, btn) {
        if (!confirm('Remove this stem? (File stays in R2)')) return;
        btn.textContent = '…';
        const key = getStoredKey();
        try {
            const res = await fetch(`/api/admin/samples/stems/${stemId}`, { method: 'DELETE', headers: { 'X-Admin-Key': key } });
            if (res.ok) await loadStems(sampleId);
            else btn.textContent = 'Error';
        } catch { btn.textContent = 'Error'; }
    };

    document.getElementById('edit-modal-close')?.addEventListener('click', () => {
        const modal = document.getElementById('edit-modal');
        modal.hidden = true;
        modal.style.display = 'none';
        loadSampleAdmin();
    });

    // Close on backdrop click
    document.getElementById('edit-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            e.currentTarget.hidden = true;
            e.currentTarget.style.display = 'none';
            loadSampleAdmin();
        }
    });

    // Save metadata
    document.getElementById('edit-save')?.addEventListener('click', async () => {
        const id = document.getElementById('edit-sample-id').value;
        const statusEl = document.getElementById('edit-status');
        const key = getStoredKey();
        statusEl.textContent = 'Saving…';
        try {
            const res = await fetch(`/api/admin/samples/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
                body: JSON.stringify({
                    title: document.getElementById('edit-title').value.trim(),
                    genre: document.getElementById('edit-genre').value.trim(),
                    bpm: document.getElementById('edit-bpm').value.trim(),
                    revisable: document.getElementById('edit-revisable').value === '1',
                }),
            });
            const data = await res.json();
            statusEl.textContent = res.ok ? '✓ Saved.' : `Error: ${data.error}`;
        } catch { statusEl.textContent = 'Connection error.'; }
    });

    // Upload cover image
    document.getElementById('edit-cover-upload')?.addEventListener('click', async () => {
        const id = document.getElementById('edit-sample-id').value;
        const coverFile = document.getElementById('edit-cover').files[0];
        const statusEl = document.getElementById('edit-cover-status');
        const key = getStoredKey();
        if (!coverFile) { statusEl.textContent = 'Choose an image first.'; return; }
        statusEl.textContent = 'Uploading cover…';
        const form = new FormData();
        form.append('cover', coverFile);
        form.append('sample_id', id);
        try {
            const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'X-Admin-Key': key }, body: form });
            const data = await res.json();
            statusEl.textContent = res.ok ? '✓ Cover updated.' : `Error: ${data.error}`;
            if (res.ok) {
                document.getElementById('edit-cover').value = '';
                const preview = document.getElementById('edit-cover-preview');
                if (preview) {
                    preview.src = `/api/cover/${id}?t=${Date.now()}`;
                    preview.style.display = 'block';
                }
            }
        } catch { statusEl.textContent = 'Connection error.'; }
    });

    // Generate a simple text-only cover (track name over a brand gradient)
    // so the card isn't blank while a real cover hasn't been uploaded yet.
    document.getElementById('edit-cover-generate')?.addEventListener('click', async () => {
        const id = document.getElementById('edit-sample-id').value;
        const statusEl = document.getElementById('edit-cover-status');
        const key = getStoredKey();
        statusEl.textContent = 'Generating cover…';
        try {
            const res = await fetch('/api/admin/generate-cover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
                body: JSON.stringify({ sample_id: id }),
            });
            const data = await res.json();
            statusEl.textContent = res.ok ? '✓ Cover generated.' : `Error: ${data.error}`;
            if (res.ok) {
                const preview = document.getElementById('edit-cover-preview');
                if (preview) {
                    preview.src = `/api/cover/${id}?t=${Date.now()}`;
                    preview.style.display = 'block';
                }
            }
        } catch { statusEl.textContent = 'Connection error.'; }
    });

    // Upload stem
    document.getElementById('edit-stem-upload')?.addEventListener('click', async () => {
        const id = document.getElementById('edit-sample-id').value;
        const stemFile = document.getElementById('edit-stem-file').files[0];
        const stemLabel = document.getElementById('edit-stem-label').value.trim();
        const statusEl = document.getElementById('edit-stem-status');
        const key = getStoredKey();
        if (!stemFile) { statusEl.textContent = 'Choose a stem file first.'; return; }
        if (!stemLabel) { statusEl.textContent = 'Enter a label for this stem (e.g. Drums).'; return; }
        statusEl.textContent = 'Uploading stem…';
        const form = new FormData();
        form.append('stem', stemFile);
        form.append('stem_label', stemLabel);
        form.append('sample_id', id);
        try {
            const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'X-Admin-Key': key }, body: form });
            const data = await res.json();
            statusEl.textContent = res.ok ? '✓ Stem added.' : `Error: ${data.error}`;
            if (res.ok) {
                document.getElementById('edit-stem-file').value = '';
                document.getElementById('edit-stem-label').value = '';
                await loadStems(id);
            }
        } catch { statusEl.textContent = 'Connection error.'; }
    });

    // ── New sample form ───────────────────────────────────────────────────────

    function resetSampleForm() {
        document.getElementById('s-file').value = '';
        document.getElementById('s-title').value = '';
        document.getElementById('s-genre').value = '';
        document.getElementById('s-bpm').value = '';
        document.getElementById('s-r2key').value = '';
    }

    document.getElementById('s-submit')?.addEventListener('click', async () => {
        const statusEl = document.getElementById('s-status');
        const fileInput = document.getElementById('s-file');
        const file    = fileInput.files[0] || null;
        const title   = document.getElementById('s-title').value.trim();
        const genre   = document.getElementById('s-genre').value.trim();
        const bpm     = document.getElementById('s-bpm').value.trim();
        const r2key   = document.getElementById('s-r2key').value.trim();
        const revisable = document.getElementById('s-revisable').value === '1';
        const key = getStoredKey();

        if (!title) { statusEl.textContent = 'Title is required.'; return; }
        if (!file && !r2key) { statusEl.textContent = 'Choose a file to upload, or enter an R2 key for a file already in the bucket.'; return; }

        try {
            if (file) {
                statusEl.textContent = 'Uploading to R2…';
                const form = new FormData();
                form.append('file', file);
                form.append('title', title);
                form.append('genre', genre);
                form.append('bpm', bpm);
                form.append('revisable', revisable ? '1' : '0');

                const res = await fetch('/api/admin/upload', {
                    method: 'POST',
                    headers: { 'X-Admin-Key': key },
                    body: form,
                });
                const data = await res.json();
                if (res.ok) {
                    statusEl.textContent = `✓ Uploaded and registered — ID: ${data.id}`;
                    resetSampleForm();
                    loadSampleAdmin();
                } else {
                    statusEl.textContent = `Error: ${data.error}`;
                }
            } else {
                statusEl.textContent = 'Registering…';
                const res = await fetch('/api/admin/samples', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
                    body: JSON.stringify({ title, genre: genre || null, bpm: bpm ? parseInt(bpm) : null, r2_key: r2key, revisable }),
                });
                const data = await res.json();
                if (res.ok) {
                    statusEl.textContent = `✓ Registered — ID: ${data.id}`;
                    resetSampleForm();
                    loadSampleAdmin();
                } else {
                    statusEl.textContent = `Error: ${data.error}`;
                }
            }
        } catch (e) {
            statusEl.textContent = 'Connection error.';
        }
    });

    // If a key's already stored for this tab session, skip straight to the list.
    if (getStoredKey()) {
        showAdminContent();
    }
});
