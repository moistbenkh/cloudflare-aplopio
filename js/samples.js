document.addEventListener('DOMContentLoaded', () => {
    const gateEl = document.getElementById('sample-gate');
    const contentEl = document.getElementById('sample-content');
    const gateEmail = document.getElementById('gate-email');
    const gateOrder = document.getElementById('gate-order');
    const gateSubmit = document.getElementById('gate-submit');
    const gateStatus = document.getElementById('gate-status');
    const claimBanner = document.getElementById('claim-banner');

    const grid = document.getElementById('sample-grid');
    const statusEl = document.getElementById('sample-status');
    const searchInput = document.getElementById('sample-search');
    const genreSelect = document.getElementById('genre-filter');
    if (!grid) return; // not on the samples page

    // Gumroad product URL for individual instrumentals
    // Each sample's buy button appends ?wanted=true&sample=<title>
    // so Gumroad echoes the sample name back in the ping payload for delivery.
    const GUMROAD_INSTRUMENTAL_URL = 'https://nvsgtech.gumroad.com/l/lwvbd';

    const TOKEN_KEY = 'aplo_sample_token';
    const ICON_PLAY = 'M4 2.5v11l10-5.5z';
    const ICON_STOP = 'M4 4h8v8H4z';

    let allSamples = [];
    let currentTier = null;
    let freeClaimsTotal = 0;
    let freeClaimsUsed = 0;
    let claimedIds = [];
    let currentAudioEl = null;
    let currentButton = null;

    function getToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function setToken(t) {
        try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
    }
    function clearToken() {
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }

    function showGate(message) {
        gateEl.hidden = false;
        contentEl.hidden = true;
        if (message) gateStatus.textContent = message;
    }

    function showContent() {
        gateEl.hidden = true;
        contentEl.hidden = false;
    }

    function renderClaimBanner() {
        if (currentTier !== 'custom') {
            claimBanner.hidden = true;
            return;
        }
        claimBanner.hidden = false;
        const remaining = Math.max(0, freeClaimsTotal - freeClaimsUsed);
        claimBanner.innerHTML = remaining > 0
            ? `<strong>${remaining} free sample${remaining === 1 ? '' : 's'}</strong> left to claim — pick any ${remaining === 1 ? 'one' : 'two'} from the catalog below.`
            : `<strong>Free samples claimed.</strong> You've used both of your free picks from this order.`;
    }

    let currentRafId = null;

    function resetCurrentPlayer() {
        reportProgress();
        if (currentRafId) { cancelAnimationFrame(currentRafId); currentRafId = null; }
        if (currentButton) {
            currentButton.classList.remove('is-playing');
            const path = currentButton.querySelector('svg path');
            if (path) path.setAttribute('d', ICON_PLAY);
            currentButton.setAttribute('aria-label', 'Play sample');
            // Reset meter and time on the card
            const card = currentButton.closest('.strip');
            if (card) {
                const fill = card.querySelector('.meter-fill');
                const time = card.querySelector('.strip-time');
                if (fill) fill.style.width = '0%';
                if (time) time.textContent = '0:00';
            }
        }
        currentButton = null;
        currentAudioEl = null;
        currentSampleId = null;
        currentSampleTitle = null;
    }

    let currentSampleId = null;
    let currentSampleTitle = null;

    function reportProgress() {
        if (!currentAudioEl || !currentSampleId) return;
        if (window.APLO_TRACK) {
            window.APLO_TRACK.playProgress(currentSampleId, currentSampleTitle, currentAudioEl.currentTime, currentAudioEl.duration);
        }
    }

    function playSample(id, button, title) {
        const isSameButton = currentButton === button;

        if (currentAudioEl) reportProgress();
        if (currentAudioEl) currentAudioEl.pause();
        resetCurrentPlayer();

        if (isSameButton) return;

        currentButton = button;
        currentSampleId = id;
        currentSampleTitle = title || null;
        if (window.APLO_TRACK) window.APLO_TRACK.playStart(id, title || null);
        button.classList.add('is-playing');
        const path = button.querySelector('svg path');
        if (path) path.setAttribute('d', ICON_STOP);
        button.setAttribute('aria-label', 'Stop sample');

        // Grab meter + time elements from this card
        const card = button.closest('.strip');
        const meterFill = card ? card.querySelector('.meter-fill') : null;
        const timeEl    = card ? card.querySelector('.strip-time') : null;
        const meter     = card ? card.querySelector('.meter') : null;

        fetch(`/api/samples/${encodeURIComponent(id)}`, {
            headers: { 'X-Sample-Token': getToken() },
        })
            .then((res) => {
                if (!res.ok) throw new Error('Playback request failed');
                return res.blob();
            })
            .then((blob) => {
                if (currentButton !== button) return;
                const url = URL.createObjectURL(blob);
                const el = new Audio(url);
                currentAudioEl = el;

                // Show total duration once metadata loads
                el.addEventListener('loadedmetadata', () => {
                    if (timeEl && el.duration) timeEl.textContent = formatTime(el.duration);
                });

                // Tick: update progress bar + elapsed time
                function tick() {
                    if (currentAudioEl !== el) return;
                    if (meterFill && el.duration) {
                        meterFill.style.width = `${(el.currentTime / el.duration) * 100}%`;
                    }
                    if (timeEl && el.duration) {
                        // Show elapsed / total  e.g. "0:42 / 2:15"
                        timeEl.textContent = `${formatTime(el.currentTime)} / ${formatTime(el.duration)}`;
                    }
                    currentRafId = requestAnimationFrame(tick);
                }

                el.addEventListener('play', () => {
                    if (meter) meter.classList.add('active');
                    currentRafId = requestAnimationFrame(tick);
                });
                el.addEventListener('pause', () => {
                    cancelAnimationFrame(currentRafId);
                });
                el.addEventListener('ended', () => {
                    if (currentAudioEl === el) resetCurrentPlayer();
                    URL.revokeObjectURL(url);
                });

                el.play().catch((err) => {
                    console.error('Sample playback failed:', err);
                    if (currentAudioEl === el) resetCurrentPlayer();
                });
            })
            .catch((err) => {
                console.error('Sample fetch failed:', err);
                if (currentButton === button) resetCurrentPlayer();
            });
    }

    function claimSample(id, btn) {
        btn.disabled = true;
        btn.textContent = 'Claiming…';
        fetch('/api/claim-sample', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Sample-Token': getToken() },
            body: JSON.stringify({ sample_id: id }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Claim failed');
                claimedIds = data.claimed_sample_ids || claimedIds;
                freeClaimsUsed = claimedIds.length;
                renderClaimBanner();
                applyFilters();
            })
            .catch((err) => {
                btn.disabled = false;
                btn.textContent = 'Claim as free sample';
                alert(err.message || 'Could not claim this sample.');
            });
    }

    // Build the Gumroad buy URL for a specific sample.
    // The `sample` param carries the title so gumroad-ping.js can identify
    // which sample was purchased and deliver the correct files.
    function gumroadBuyUrl(sample) {
        const base = GUMROAD_INSTRUMENTAL_URL;
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}wanted=true&sample=${encodeURIComponent(sample.id)}&sample_name=${encodeURIComponent(sample.title)}`;
    }

    function renderSamples(samples) {
        grid.innerHTML = '';
        if (samples.length === 0) {
            grid.innerHTML = '<p class="hint">No samples match.</p>';
            return;
        }
        samples.forEach((sample) => {
            const isClaimed = claimedIds.includes(sample.id);
            const claimsLeft = freeClaimsTotal - freeClaimsUsed;
            const canClaim = currentTier === 'custom' && !isClaimed && claimsLeft > 0;
            const buyUrl = gumroadBuyUrl(sample);

            const card = document.createElement('article');
            card.className = 'strip';

            // Background: full-cover image or placeholder
            const bgHtml = sample.cover_url
                ? `<img class="strip-bg" src="${escapeAttr(sample.cover_url)}"
                        alt="${escapeAttr(sample.title)} cover" loading="lazy">`
                : `<div class="strip-bg-placeholder">
                     <svg viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.5" width="48" height="48">
                       <circle cx="12" cy="12" r="10"/>
                       <path d="M9.5 8.5l7 3.5-7 3.5V8.5z" fill="var(--dim)" stroke="none"/>
                     </svg>
                   </div>`;

            card.innerHTML = `
                ${bgHtml}

                <!-- Play button floats in the clear image area -->
                <div class="strip-play-area">
                    <button class="play-btn" aria-label="Play sample">
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="${ICON_PLAY}"/></svg>
                    </button>
                </div>

                <!-- Frosted glass panel at bottom -->
                <div class="strip-glass">
                    <div class="strip-head">
                        <div style="min-width:0;">
                            <div class="strip-tag">${sample.genre ? sample.genre.toUpperCase() : 'SAMPLE'}</div>
                            <h3 class="strip-title">${escapeHtml(sample.title)}</h3>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
                            ${sample.bpm ? `<div class="strip-bpm">${sample.bpm} BPM</div>` : ''}
                            <div style="font-size:9.5px;letter-spacing:0.08em;font-weight:600;padding:3px 6px;border-radius:4px;white-space:nowrap;
                                background:${sample.revisable ? 'rgba(80,200,100,0.15)' : 'rgba(255,100,60,0.15)'};
                                color:${sample.revisable ? '#50c864' : '#e05c1a'};">
                                ${sample.revisable ? '✓ REVISABLE' : '✕ NO PROJECT FILE'}
                            </div>
                        </div>
                    </div>
                    <div class="player">
                        <div class="meter"><div class="meter-fill"></div></div>
                        <span class="strip-time">0:00</span>
                    </div>
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--dim);letter-spacing:0.08em;">INDIVIDUAL LICENSE</span>
                        <span style="font-family:var(--font-mono);font-size:14px;color:var(--signal);font-weight:700;">$100</span>
                    </div>
                    <a href="${escapeAttr(buyUrl)}" target="_blank" rel="noopener"
                       class="btn btn-primary" style="display:block;text-align:center;padding:8px 0;font-size:12.5px;text-decoration:none;">
                       Buy this instrumental
                    </a>
                    ${currentTier === 'custom' ? `
                    <button class="claim-btn ${isClaimed ? 'is-claimed' : ''}" ${(!canClaim && !isClaimed) ? 'disabled' : ''}
                            style="margin-top:6px;">
                        ${isClaimed ? '✓ Claimed as free sample' : 'Claim as free sample'}
                    </button>` : ''}
                </div>
            `;
            const bgImg = card.querySelector('.strip-bg');
            if (bgImg) {
                bgImg.addEventListener('error', () => {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'strip-bg-placeholder';
                    placeholder.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.5" width="48" height="48">
                       <circle cx="12" cy="12" r="10"/>
                       <path d="M9.5 8.5l7 3.5-7 3.5V8.5z" fill="var(--dim)" stroke="none"/>
                     </svg>`;
                    bgImg.replaceWith(placeholder);
                }, { once: true });
            }

            const button = card.querySelector('.play-btn');
            button.addEventListener('click', () => playSample(sample.id, button, sample.title));

            const claimBtn = card.querySelector('.claim-btn');
            if (claimBtn && !isClaimed) {
                claimBtn.addEventListener('click', () => claimSample(sample.id, claimBtn));
            }
            grid.appendChild(card);
        });
    }

    function formatTime(s) {
        if (!s || isNaN(s) || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }
    function escapeAttr(str) {
        return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function applyFilters() {
        const q = (searchInput.value || '').toLowerCase().trim();
        const genre = genreSelect.value;
        const filtered = allSamples.filter((s) => {
            const matchesQuery = !q || s.title.toLowerCase().includes(q) || (s.genre || '').toLowerCase().includes(q);
            const matchesGenre = !genre || s.genre === genre;
            return matchesQuery && matchesGenre;
        });
        renderSamples(filtered);
    }

    async function loadSamples() {
        statusEl.textContent = 'Loading…';
        try {
            const res = await fetch('/api/sample-list', {
                headers: { 'X-Sample-Token': getToken() },
            });
            if (res.status === 401) {
                clearToken();
                showGate('Your session expired — please unlock the library again.');
                return;
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load samples');

            allSamples = data.samples || [];
            currentTier = data.tier || null;
            freeClaimsTotal = data.free_claims_total || 0;
            freeClaimsUsed = data.free_claims_used || 0;
            claimedIds = data.claimed_sample_ids || [];

            statusEl.textContent = `${allSamples.length} sample${allSamples.length === 1 ? '' : 's'}`;

            genreSelect.querySelectorAll('option:not(:first-child)').forEach((o) => o.remove());
            const genres = [...new Set(allSamples.map((s) => s.genre).filter(Boolean))].sort();
            genres.forEach((g) => {
                const opt = document.createElement('option');
                opt.value = g;
                opt.textContent = g;
                genreSelect.appendChild(opt);
            });

            renderClaimBanner();
            showContent();
            renderSamples(allSamples);
        } catch (err) {
            console.error('Failed to load sample list:', err);
            statusEl.textContent = 'Could not load samples. Try refreshing.';
        }
    }

    async function unlock() {
        const email = gateEmail.value.trim();
        const orderId = gateOrder.value.trim();
        if (!email) { gateStatus.textContent = 'Enter the email you checked out with.'; return; }

        gateSubmit.disabled = true;
        gateStatus.textContent = 'Checking…';
        try {
            const res = await fetch('/api/sample-access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, order_id: orderId || undefined }),
            });
            const data = await res.json();
            if (!res.ok || !data.access) {
                gateStatus.textContent = data.error || 'Could not verify a paid order for that email.';
                gateSubmit.disabled = false;
                return;
            }
            setToken(data.token);
            gateStatus.textContent = '';
            await loadSamples();
        } catch (err) {
            console.error('Unlock failed:', err);
            gateStatus.textContent = 'Connection error — try again.';
        } finally {
            gateSubmit.disabled = false;
        }
    }

    gateSubmit?.addEventListener('click', unlock);
    gateOrder?.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
    gateEmail?.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

    searchInput?.addEventListener('input', applyFilters);
    genreSelect?.addEventListener('change', applyFilters);

    // If we already have a token (e.g. checkout just unlocked it, or a
    // returning visit), skip straight to the library instead of showing
    // the gate.
    if (getToken()) {
        loadSamples();
    } else {
        showGate();
    }

    // Best-effort: catch a listen cut off by closing the tab rather than
    // clicking stop (pagehide is more reliable than 'unload' on mobile).
    window.addEventListener('pagehide', reportProgress);
});
