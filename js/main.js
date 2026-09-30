// ── First-party analytics beacon ────────────────────────────────────────
// No cookies, no third-party scripts, no persistent cross-visit identity.
// session_id is a random UUID minted once per tab into sessionStorage —
// it dies when the tab closes and is never read by anything but our own
// /api/track endpoint, purely to count unique sessions and avoid double-
// counting a listen. See functions/api/track.js and schema.sql for what's
// stored server-side. Exposed as window.APLO_TRACK so js/samples.js and
// js/instrumentals.js can log play events without re-implementing this.
window.APLO_TRACK = (function () {
    const SESSION_KEY = 'aplo_session_id';

    function getSessionId() {
        try {
            let id = sessionStorage.getItem(SESSION_KEY);
            if (!id) {
                id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
                sessionStorage.setItem(SESSION_KEY, id);
            }
            return id;
        } catch (e) {
            return null; // sessionStorage unavailable (privacy mode etc.) — track anonymously without one
        }
    }

    function send(payload) {
        try {
            const body = JSON.stringify(payload);
            if (navigator.sendBeacon) {
                const blob = new Blob([body], { type: 'application/json' });
                navigator.sendBeacon('/api/track', blob);
            } else {
                fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
            }
        } catch (e) { /* never let tracking break the page */ }
    }

    function pageview() {
        send({
            event_type: 'pageview',
            path: location.pathname,
            referrer: document.referrer || '',
            session_id: getSessionId(),
        });
    }

    function playStart(sampleId, sampleTitle) {
        send({ event_type: 'play_start', sample_id: sampleId, sample_title: sampleTitle, session_id: getSessionId() });
    }

    function playProgress(sampleId, sampleTitle, secondsPlayed, trackDurationSeconds) {
        if (!secondsPlayed || secondsPlayed < 1) return; // skip accidental/instant clicks
        send({
            event_type: 'play_progress',
            sample_id: sampleId,
            sample_title: sampleTitle,
            seconds_played: secondsPlayed,
            track_duration_seconds: trackDurationSeconds || null,
            session_id: getSessionId(),
        });
    }

    return { pageview, playStart, playProgress };
})();

document.addEventListener('DOMContentLoaded', () => {
    window.APLO_TRACK.pageview();

    // Mobile Nav Toggle
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('active');
            navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            navToggle.textContent = isOpen ? '✕' : '☰';
        });
        // Close menu when a nav link is tapped
        navLinks.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => {
                navLinks.classList.remove('active');
                navToggle.setAttribute('aria-expanded', 'false');
                navToggle.textContent = '☰';
            });
        });
    }

    // Audio Player
    let currentAudioEl = null;

    function setFill(meterEl, ratio) {
        if (!meterEl) return;
        const fill = meterEl.querySelector('.meter-fill');
        if (fill) fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    }

    const ICON_PLAY = 'M4 2.5v11l10-5.5z';
    const ICON_STOP = 'M4 4h8v8H4z';

    function setButtonIcon(button, isPlaying) {
        const path = button.querySelector('svg path');
        if (path) path.setAttribute('d', isPlaying ? ICON_STOP : ICON_PLAY);
        button.setAttribute('aria-label', isPlaying ? 'Stop sample' : 'Play sample');
    }

    function resetPlayer(button) {
        button.classList.remove('is-playing');
        setButtonIcon(button, false);
        const meterEl = button.parentElement?.querySelector('.meter');
        if (meterEl) {
            meterEl.classList.remove('active');
            setFill(meterEl, 0);
        }
    }

    // Homepage samples are 30-second previews. The full files are served by
    // /api/stream, so the cap is enforced here in time (not bytes), with a
    // short fade-out so the cut never clicks or glitches.
    const PREVIEW_SECONDS = 30;
    const FADE_SECONDS = 0.8;

    function fmtTime(sec) {
        const s = Math.max(0, Math.floor(sec));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function setTimeLabel(button, text) {
        const label = button.closest('.strip-glass')?.querySelector('.strip-time');
        if (label) label.textContent = text;
    }

    const playButtons = document.querySelectorAll('.player .play-btn');
    const cardLabelDefault = fmtTime(PREVIEW_SECONDS);

    function resetAll() {
        playButtons.forEach(b => { resetPlayer(b); setTimeLabel(b, cardLabelDefault); });
        if (currentAudioEl) {
            currentAudioEl.pause();
            currentAudioEl = null;
        }
    }

    // The large centre button on each card just drives that card's player.
    document.querySelectorAll('.strip-play-area .play-btn').forEach(big => {
        big.addEventListener('click', () => {
            big.closest('.strip')?.querySelector('.player .play-btn')?.click();
        });
    });

    playButtons.forEach(button => {
        button.addEventListener('click', () => {
            const isPlaying = button.classList.contains('is-playing');

            resetAll();
            if (isPlaying) return;

            button.classList.add('is-playing');
            setButtonIcon(button, true);

            const meterEl = button.parentElement?.querySelector('.meter');
            meterEl?.classList.add('active');

            const playerEl = button.closest('.player');
            const rawSrc = playerEl?.dataset.src || '';
            // encodeURI handles the space and parentheses in filenames like
            // "S.OS (Cover).mp3" so the browser requests the right URL.
            const audioPath = encodeURI(rawSrc);
            const audioEl = new Audio(audioPath);
            currentAudioEl = audioEl;

            const finish = () => {
                audioEl.pause();
                if (currentAudioEl === audioEl) currentAudioEl = null;
                resetPlayer(button);
                setTimeLabel(button, cardLabelDefault);
            };

            audioEl.addEventListener('timeupdate', () => {
                if (currentAudioEl !== audioEl) return;
                // Cap at 30s, or the real length if the track is shorter
                const cap = audioEl.duration
                    ? Math.min(PREVIEW_SECONDS, audioEl.duration)
                    : PREVIEW_SECONDS;
                const t = audioEl.currentTime;

                setFill(meterEl, t / cap);
                setTimeLabel(button, `${fmtTime(t)} / ${fmtTime(cap)}`);

                // Fade out over the last moments (volume is read-only on iOS,
                // where the fade is skipped and the stop is simply immediate)
                const left = cap - t;
                if (left < FADE_SECONDS) audioEl.volume = Math.max(0, left / FADE_SECONDS);

                if (t >= cap) finish();
            });
            audioEl.addEventListener('ended', finish);

            audioEl.play().catch((err) => {
                if (currentAudioEl !== audioEl) return;
                console.error('Audio playback failed:', audioPath, err);
                finish();
            });
        });
    });

    // Magic-link client auth (checkout auto-fill)
    //
    // A returning client's token lives in localStorage as
    // aplo_client_token. On load, if a token is present, we call
    // /api/client-profile with it — if it comes back found, we collapse
    // name/brand behind a one-line summary and pre-select their last tier,
    // leaving the vibe field empty for them to fill in fresh. If there's
    // no token (or the lookup finds nothing), the form behaves exactly
    // like a first-time buyer's: plain email field, no code prompt until
    // they choose to send one.
    const CLIENT_TOKEN_KEY = 'aplo_client_token';
    const emailInput      = document.getElementById('client-email');
    const sendCodeRow     = document.getElementById('send-code-row');
    const sendCodeBtn     = document.getElementById('send-code-btn');
    const codeEntry       = document.getElementById('code-entry');
    const authCodeInput   = document.getElementById('auth-code');
    const verifyCodeBtn   = document.getElementById('verify-code-btn');
    const resendCodeLink  = document.getElementById('resend-code-link');
    const authMsg         = document.getElementById('auth-msg');
    const rcSummary        = document.getElementById('returning-client-summary');
    const rcName            = document.getElementById('rc-name');
    const rcBrand           = document.getElementById('rc-brand');
    const rcEdit             = document.getElementById('rc-edit');
    const rcNotYou           = document.getElementById('rc-not-you');
    const detailFields      = document.getElementById('detail-fields');
    const nameInput         = document.getElementById('client-name');
    const brandInput        = document.getElementById('brand-name');
    const tierSelectEl      = document.getElementById('tier-select');

    if (emailInput) {
        function getClientToken() {
            try { return localStorage.getItem(CLIENT_TOKEN_KEY); } catch (e) { return null; }
        }
        function setClientToken(token) {
            try { localStorage.setItem(CLIENT_TOKEN_KEY, token); } catch (e) {}
        }
        function clearClientToken() {
            try { localStorage.removeItem(CLIENT_TOKEN_KEY); } catch (e) {}
        }

        function showAuthMsg(text) {
            if (!authMsg) return;
            authMsg.textContent = text;
            authMsg.style.display = 'block';
        }
        function hideAuthMsg() {
            if (authMsg) authMsg.style.display = 'none';
        }

        function showReturningClient({ name, brand, tier }) {
            if (name && nameInput) nameInput.value = name;
            if (brand && brandInput) brandInput.value = brand;
            if (tier && tierSelectEl) tierSelectEl.value = tier;

            if (rcName) rcName.textContent = name || 'there';
            if (rcBrand) rcBrand.textContent = brand || 'your brand on file';
            if (rcSummary) rcSummary.style.display = 'block';
            if (detailFields) detailFields.style.display = 'none';
            if (sendCodeRow) sendCodeRow.style.display = 'none';
            if (codeEntry) codeEntry.style.display = 'none';
        }

        function hideReturningClient() {
            if (rcSummary) rcSummary.style.display = 'none';
            if (detailFields) detailFields.style.display = '';
        }

        async function fetchProfileWithToken(token) {
            try {
                const res = await fetch('/api/client-profile', {
                    headers: { 'X-Client-Token': token },
                });
                const data = await res.json();
                return data;
            } catch (e) {
                console.error('client-profile lookup failed:', e);
                return { found: false };
            }
        }

        // Restore returning-client state on load if we already have a token.
        (async function restoreClientAuth() {
            const token = getClientToken();
            if (!token) return;
            const profile = await fetchProfileWithToken(token);
            if (profile.found) {
                showReturningClient(profile);
            }
            // An invalid/expired token just means we fall back to the
            // first-time-buyer flow silently — no need to clear it here,
            // since the auth endpoints will simply issue a new one if the
            // client goes through the code flow again.
        })();

        // Reveal "Send me a code" once the client has typed a plausible
        // email — not on every keystroke, just once they leave the field.
        emailInput.addEventListener('blur', () => {
            if (rcSummary && rcSummary.style.display === 'block') return; // already resolved
            const val = emailInput.value.trim();
            const looksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
            if (sendCodeRow) sendCodeRow.style.display = looksValid ? 'block' : 'none';
        });

        async function requestCode() {
            const email = emailInput.value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

            if (sendCodeBtn) { sendCodeBtn.disabled = true; sendCodeBtn.textContent = 'Sending…'; }
            hideAuthMsg();

            try {
                const res = await fetch('/api/auth/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok) {
                    showAuthMsg(data.error || `Could not send a code (error ${res.status}).`);
                    return;
                }

                if (codeEntry) codeEntry.style.display = 'block';
                if (sendCodeRow) sendCodeRow.style.display = 'none';
                showAuthMsg('Code sent — check your email.');
                if (authCodeInput) authCodeInput.focus();
            } catch (e) {
                console.error('auth/request failed:', e);
                showAuthMsg('Could not send a code right now. You can still fill in the form below.');
            } finally {
                if (sendCodeBtn) { sendCodeBtn.disabled = false; sendCodeBtn.textContent = 'Send me a code'; }
            }
        }

        if (sendCodeBtn) sendCodeBtn.addEventListener('click', requestCode);
        if (resendCodeLink) {
            resendCodeLink.addEventListener('click', (e) => {
                e.preventDefault();
                requestCode();
            });
        }

        async function verifyCode() {
            const email = emailInput.value.trim();
            const code = (authCodeInput?.value || '').trim();
            if (!/^\d{6}$/.test(code)) {
                showAuthMsg('Enter the 6-digit code from your email.');
                return;
            }

            if (verifyCodeBtn) { verifyCodeBtn.disabled = true; verifyCodeBtn.textContent = 'Verifying…'; }
            hideAuthMsg();

            try {
                const res = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code }),
                });
                const data = await res.json();

                if (!res.ok || !data.token) {
                    showAuthMsg(data.error || 'That code didn\'t work — try again.');
                    return;
                }

                setClientToken(data.token);
                const profile = await fetchProfileWithToken(data.token);
                if (profile.found) {
                    showReturningClient(profile);
                } else {
                    // First-time client — verified, but no order on file yet.
                    // Just tuck the code UI away; they fill the form fresh.
                    if (codeEntry) codeEntry.style.display = 'none';
                    if (sendCodeRow) sendCodeRow.style.display = 'none';
                }
            } catch (e) {
                console.error('auth/verify failed:', e);
                showAuthMsg('Connection error — try again.');
            } finally {
                if (verifyCodeBtn) { verifyCodeBtn.disabled = false; verifyCodeBtn.textContent = 'Verify'; }
            }
        }

        if (verifyCodeBtn) verifyCodeBtn.addEventListener('click', verifyCode);
        if (authCodeInput) {
            authCodeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); verifyCode(); }
            });
        }

        if (rcEdit) {
            rcEdit.addEventListener('click', (e) => {
                e.preventDefault();
                hideReturningClient();
            });
        }

        if (rcNotYou) {
            rcNotYou.addEventListener('click', (e) => {
                e.preventDefault();
                clearClientToken();
                hideReturningClient();
                if (nameInput) nameInput.value = '';
                if (brandInput) brandInput.value = '';
                emailInput.value = '';
                if (sendCodeRow) sendCodeRow.style.display = 'none';
                if (codeEntry) codeEntry.style.display = 'none';
                emailInput.focus();
            });
        }
    }

    // Checkout Form Brief Capture & Payment Logic
    //
    // The order lives in localStorage (not just sessionStorage) so that a
    // refresh — or closing and reopening the tab — doesn't strand the client
    // on a blank form after they've already paid or are mid-payment. On load
    // we check for a pending order and, if one exists, restore the payment
    // panel and kick off a background check immediately.
    const checkoutForm = document.getElementById('checkout-form');
    if (checkoutForm) {
        const PENDING_ORDER_KEY = 'aplo_pending_order';
        const PENDING_ORDER_TTL_MS = 24 * 60 * 60 * 1000; // 24h — after this, treat as stale
        const BACKGROUND_POLL_MS = 5000;

        const payBlock       = document.getElementById('pay-block');
        const gumroadBtn     = document.getElementById('gumroad-pay-btn');
        const confirmWrap    = document.getElementById('confirm-paid-wrap');
        const confirmBtn     = document.getElementById('confirm-paid-btn');
        const confirmMsg     = document.getElementById('confirm-paid-msg');
        const statusMsg      = document.getElementById('payment-status-msg');
        const resumeBanner   = document.getElementById('resume-banner');
        const resumeReset    = document.getElementById('resume-reset');
        const summaryTotal   = document.getElementById('summary-total');
        const summaryVibe    = document.getElementById('summary-vibe');

        const TIER_PRICES = { express: '$50', custom: '$200' };

        let backgroundTimer = null;
        let resolved = false; // guards against the manual check and background poll both firing

        function savePendingOrder(order) {
            try {
                localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ ...order, savedAt: Date.now() }));
            } catch (e) { /* storage unavailable — payment check still works, just no resume-on-refresh */ }
        }

        function loadPendingOrder() {
            try {
                const raw = localStorage.getItem(PENDING_ORDER_KEY);
                if (!raw) return null;
                const order = JSON.parse(raw);
                if (!order.savedAt || (Date.now() - order.savedAt) > PENDING_ORDER_TTL_MS) {
                    localStorage.removeItem(PENDING_ORDER_KEY);
                    return null;
                }
                return order;
            } catch (e) { return null; }
        }

        function clearPendingOrder() {
            try { localStorage.removeItem(PENDING_ORDER_KEY); } catch (e) {}
            try { sessionStorage.removeItem('aplo_email'); } catch (e) {}
        }

        function stopBackgroundPoll() {
            if (backgroundTimer) { clearTimeout(backgroundTimer); backgroundTimer = null; }
        }

        async function checkPaymentOnce(email, orderId) {
            let url = '/api/check-payment?email=' + encodeURIComponent(email);
            if (orderId) url += '&order_id=' + encodeURIComponent(orderId);
            const res = await fetch(url);
            const data = await res.json();
            return !!data.paid;
        }

        // Unlocks the sample library for this buyer before redirecting, so
        // they land on thank-you.html already able to open samples.html
        // without re-entering their email. Best-effort: if this fails for
        // any reason, the gate on samples.html still lets them unlock
        // manually with their email, so we never block the redirect on it.
        async function unlockSampleLibrary(email, orderId) {
            try {
                const res = await fetch('/api/sample-access', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, order_id: orderId || undefined }),
                });
                const data = await res.json();
                if (res.ok && data.access && data.token) {
                    localStorage.setItem('aplo_sample_token', data.token);
                }
            } catch (e) {
                console.error('Sample library unlock failed (non-blocking):', e);
            }
        }

        async function goToThankYou(email, orderId) {
            if (resolved) return;
            resolved = true;
            stopBackgroundPoll();
            if (email) await unlockSampleLibrary(email, orderId);
            clearPendingOrder();
            window.location.href = 'thank-you.html';
        }

        // Polls /api/check-payment until this specific order is confirmed paid.
        // Always pass orderId so a past paid order for the same email cannot
        // trigger confirmation for a new, unpaid one (the repeat-buyer bug).
        function startBackgroundPoll(email, orderId) {
            stopBackgroundPoll();
            async function tick() {
                if (resolved) return;
                try {
                    if (await checkPaymentOnce(email, orderId)) { goToThankYou(email, orderId); return; }
                } catch (e) {
                    console.error('Background payment check failed:', e);
                }
                if (!resolved) backgroundTimer = setTimeout(tick, BACKGROUND_POLL_MS);
            }
            tick();
        }

        function showPayBlock({ redirectUrl, email, orderId, revealConfirm, statusText, startPoll }) {
            payBlock?.removeAttribute('hidden');
            if (gumroadBtn && redirectUrl) gumroadBtn.href = redirectUrl;
            if (gumroadBtn) {
                // Only start polling once the user has clicked through to Gumroad.
                // This prevents a repeat buyer's old paid order from auto-confirming
                // a new unpaid one the moment the page loads.
                gumroadBtn.addEventListener('click', function () {
                    if (confirmWrap) confirmWrap.style.display = 'block';
                    // Record that Gumroad was clicked so a refresh knows to
                    // resume polling instead of waiting for the button again.
                    try {
                        const raw = localStorage.getItem('aplo_pending_order');
                        if (raw) {
                            const stored = JSON.parse(raw);
                            stored.gumroad_clicked = true;
                            localStorage.setItem('aplo_pending_order', JSON.stringify(stored));
                        }
                    } catch (e) {}
                    if (!startPoll) startBackgroundPoll(email, orderId);
                }, { once: true });
            }
            if (revealConfirm && confirmWrap) confirmWrap.style.display = 'block';
            if (statusText && statusMsg) {
                statusMsg.textContent = statusText;
                statusMsg.style.display = 'block';
            }
            // startPoll=true only when Gumroad was already visited in a prior
            // session (the confirm button was already visible on restore).
            if (startPoll) startBackgroundPoll(email, orderId);
        }

        // "I've paid" button — does an immediate tighter-interval check for
        // fast feedback; the background poll above keeps running in parallel
        // in case this tab-level check misses (both funnel into goToThankYou,
        // which is idempotent).
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async function () {
                const pending = loadPendingOrder();
                const email = pending?.email || sessionStorage.getItem('aplo_email');
                const orderId = pending?.order_id || null;
                if (!email) {
                    if (confirmMsg) { confirmMsg.textContent = 'Session expired — please refresh and try again.'; confirmMsg.style.display = 'block'; }
                    return;
                }
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Checking payment…';
                if (confirmMsg) confirmMsg.style.display = 'none';
                if (statusMsg) statusMsg.style.display = 'none';

                const MAX_ATTEMPTS = 20; // ~60s at 3s intervals
                let attempts = 0;
                async function check() {
                    attempts++;
                    try {
                        if (await checkPaymentOnce(email, orderId)) { goToThankYou(email, orderId); return; }
                    } catch (e) {
                        console.error('Payment check error:', e);
                    }
                    if (resolved) return;
                    if (attempts < MAX_ATTEMPTS) {
                        confirmBtn.textContent = 'Checking payment… (' + attempts + ')';
                        setTimeout(check, 3000);
                    } else {
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = "✓ I've paid — confirm my order";
                        if (confirmMsg) {
                            confirmMsg.textContent = "Payment not confirmed yet. This page will keep checking in the background — feel free to wait, or contact us if you've already paid.";
                            confirmMsg.style.display = 'block';
                        }
                    }
                }
                check();
            });
        }

        if (resumeReset) {
            resumeReset.addEventListener('click', function (e) {
                e.preventDefault();
                resolved = true;
                stopBackgroundPoll();
                clearPendingOrder();
                window.location.reload();
            });
        }

        // Restore a pending order on page load (fresh visit, refresh, or
        // reopened tab) so the client gets feedback instead of a blank form.
        (function restoreOnLoad() {
            const pending = loadPendingOrder();
            if (!pending || !pending.email) return;

            if (resumeBanner) resumeBanner.style.display = 'block';
            if (summaryTotal) summaryTotal.textContent = TIER_PRICES[pending.tier] || 'See tier';
            if (summaryVibe) summaryVibe.textContent = 'Saved with your order';
            const tierSelect = document.getElementById('tier-select');
            if (tierSelect && pending.tier) tierSelect.value = pending.tier;

            // revealConfirm: was Gumroad already clicked in the prior session?
            // startPoll: only poll immediately if confirm was already visible —
            // meaning the user had already visited Gumroad before refreshing.
            // If they hadn't clicked Gumroad yet, polling starts only after they do,
            // which prevents a repeat buyer's old paid order from matching instantly.
            const gumroadWasClicked = !!pending.gumroad_clicked;
            showPayBlock({
                redirectUrl:   pending.redirect_url,
                email:         pending.email,
                orderId:       pending.order_id || null,
                revealConfirm: gumroadWasClicked,
                startPoll:     gumroadWasClicked,
                statusText:    gumroadWasClicked ? 'Checking your payment status…' : null,
            });
        })();

        checkoutForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = checkoutForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            const formData = {
                tier: document.getElementById('tier-select')?.value || 'express',
                name: document.getElementById('client-name')?.value || '',
                email: document.getElementById('client-email')?.value || '',
                brand: document.getElementById('brand-name')?.value || '',
                vibe: document.getElementById('vibe-notes')?.value || ''
            };

            try {
                const response = await fetch('/api/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();

                if (!response.ok) {
                    alert(result.error || 'Failed to save your brief. Please try again.');
                    if (submitBtn) submitBtn.disabled = false;
                    return;
                }

                // Brief is saved server-side before any money moves — reflect
                // the summary panel and reveal payment options.
                if (summaryVibe) summaryVibe.textContent = formData.vibe.slice(0, 60) + (formData.vibe.length > 60 ? '…' : '');

                const email = formData.email.toLowerCase().trim();

                // Persist enough to resume this order across a refresh or a
                // closed tab — not just the email, but the tier and payment
                // link so the pay block can be rebuilt without the DB.
                savePendingOrder({
                    email,
                    tier: formData.tier,
                    redirect_url: result.redirect_url,
                    order_id: result.order_id ?? null
                });
                sessionStorage.setItem('aplo_email', email); // kept for back-compat

                if (submitBtn) submitBtn.disabled = false;

                showPayBlock({ redirectUrl: result.redirect_url, email, orderId: result.order_id ?? null });
            } catch (err) {
                console.error('Checkout error:', err);
                alert('Connection error. Please try again.');
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
});