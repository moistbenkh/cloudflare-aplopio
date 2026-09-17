document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('instr-grid');
    if (!grid) return; // not on the instrumentals page

    const statusEl = document.getElementById('instr-status');
    const searchInput = document.getElementById('instr-search');
    const genreSelect = document.getElementById('instr-genre');

    // ── Fill in after creating your Gumroad product ──────────────────────
    // Create ONE Gumroad product (e.g. $100, "APLO Audio — Instrumental").
    // Paste its product URL below. Every track's Buy button reuses this
    // same link with ?sample=<id> appended — Gumroad passes that straight
    // through to the Ping webhook (see functions/api/gumroad-ping.js),
    // which looks up the right track and emails the download link. You do
    // NOT need to create a separate Gumroad product per track.
    const GUMROAD_INSTRUMENTAL_URL = 'https://nvsgtech.gumroad.com/l/lwvbd';

    const ICON_PLAY = 'M4 2.5v11l10-5.5z';
    const ICON_STOP = 'M4 4h8v8H4z';

    let allSamples = [];
    let currentAudioEl = null;
    let currentButton = null;

    let currentSampleId = null;
    let currentSampleTitle = null;

    function reportProgress() {
        if (!currentAudioEl || !currentSampleId) return;
        if (window.APLO_TRACK) {
            window.APLO_TRACK.playProgress(currentSampleId, currentSampleTitle, currentAudioEl.currentTime, currentAudioEl.duration);
        }
    }

    function resetCurrentPlayer() {
        reportProgress();
        if (currentButton) {
            currentButton.classList.remove('is-playing');
            const path = currentButton.querySelector('svg path');
            if (path) path.setAttribute('d', ICON_PLAY);
            currentButton.setAttribute('aria-label', 'Play preview');
        }
        currentButton = null;
        currentAudioEl = null;
        currentSampleId = null;
        currentSampleTitle = null;
    }

    function playPreview(id, button, title) {
        const isSameButton = currentButton === button;

        if (currentAudioEl) reportProgress();
        if (currentAudioEl) currentAudioEl.pause();
        resetCurrentPlayer();

        if (isSameButton) return; // clicking the currently-playing button just stops it

        const audio = new Audio(`/api/preview/${encodeURIComponent(id)}`);
        audio.addEventListener('ended', resetCurrentPlayer);
        audio.addEventListener('error', resetCurrentPlayer);
        audio.play().catch(resetCurrentPlayer);

        button.classList.add('is-playing');
        const path = button.querySelector('svg path');
        if (path) path.setAttribute('d', ICON_STOP);
        button.setAttribute('aria-label', 'Stop preview');

        currentAudioEl = audio;
        currentButton = button;
        currentSampleId = id;
        currentSampleTitle = title || null;
        if (window.APLO_TRACK) window.APLO_TRACK.playStart(id, title || null);
    }

    // Best-effort: catch a listen that's cut off by closing the tab rather
    // than clicking stop (pagehide fires reliably where 'unload' doesn't
    // on mobile Safari).
    window.addEventListener('pagehide', reportProgress);

    function buyUrl(sampleId) {
        const sep = GUMROAD_INSTRUMENTAL_URL.includes('?') ? '&' : '?';
        return `${GUMROAD_INSTRUMENTAL_URL}${sep}sample=${encodeURIComponent(sampleId)}`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function renderGrid(samples) {
        if (samples.length === 0) {
            grid.innerHTML = '';
            statusEl.textContent = 'No tracks match your search.';
            return;
        }
        statusEl.textContent = `${samples.length} track${samples.length === 1 ? '' : 's'}`;
        grid.innerHTML = samples.map((s) => {
            const metaParts = [];
            if (s.genre) metaParts.push(escapeHtml(s.genre.toUpperCase()));
            if (s.bpm) metaParts.push(`${s.bpm} BPM`);
            const metaText = metaParts.join(' · ');

            // Cover: use the real uploaded image if the admin has set one;
            // otherwise show a small text-only placeholder with the track
            // name so the card is never blank.
            const coverHtml = s.cover_url
                ? `<img class="instr-cover-img" data-fallback-title="${escapeHtml(s.title)}" src="${s.cover_url}" alt="" loading="lazy">`
                : `<span class="instr-cover-fallback">${escapeHtml(s.title)}</span>`;

            return `
            <div class="instr-card">
                <div class="instr-cover">${coverHtml}</div>
                <div class="instr-title">${escapeHtml(s.title)}</div>
                <div class="instr-meta">${metaText}</div>
                <div class="instr-controls">
                    <button class="instr-play" data-id="${s.id}" data-title="${escapeHtml(s.title)}" aria-label="Play preview">
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="${ICON_PLAY}"/></svg>
                    </button>
                    <span class="instr-note">Preview</span>
                </div>
                <a class="instr-buy" href="${buyUrl(s.id)}" target="_blank" rel="noopener">Buy — $100</a>
            </div>
        `;
        }).join('');

        grid.querySelectorAll('.instr-play').forEach((btn) => {
            btn.addEventListener('click', () => playPreview(btn.dataset.id, btn, btn.dataset.title));
        });

        grid.querySelectorAll('.instr-cover-img').forEach((img) => {
            img.addEventListener('error', () => {
                const span = document.createElement('span');
                span.className = 'instr-cover-fallback';
                span.textContent = img.dataset.fallbackTitle || '';
                img.replaceWith(span);
            }, { once: true });
        });
    }

    function applyFilters() {
        const q = searchInput.value.trim().toLowerCase();
        const genre = genreSelect.value;
        const filtered = allSamples.filter((s) => {
            const matchesQ = !q || s.title.toLowerCase().includes(q) || (s.genre || '').toLowerCase().includes(q);
            const matchesGenre = !genre || s.genre === genre;
            return matchesQ && matchesGenre;
        });
        renderGrid(filtered);
    }

    function populateGenres(samples) {
        const genres = [...new Set(samples.map((s) => s.genre).filter(Boolean))].sort();
        genreSelect.innerHTML = '<option value="">All genres</option>' +
            genres.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    }

    async function loadCatalog() {
        try {
            const res = await fetch('/api/public-samples');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load catalog');
            allSamples = data.samples || [];
            populateGenres(allSamples);
            renderGrid(allSamples);
        } catch (err) {
            console.error('Failed to load instrumentals catalog:', err);
            statusEl.textContent = 'Could not load the catalog. Try refreshing.';
        }
    }

    searchInput.addEventListener('input', applyFilters);
    genreSelect.addEventListener('change', applyFilters);

    loadCatalog();
});
