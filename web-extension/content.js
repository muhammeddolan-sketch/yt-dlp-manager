(function() {
    // UniGet Pro Content Script

    const messages = {
        tr: {
            download: 'İndir',
            processing: 'Hazırlanıyor...',
            playlist: 'Çalma Listesi',
            quick_mode: 'Hızlı mod',
            close: 'Kapat',
            completed: 'Tamamlandı!',
            error: 'Hata!',
            start_time: 'Başlangıç',
            end_time: 'Bitiş (opsiyonel)',
            subs: 'Altyazı',
            offline: 'UniGet uygulaması kapalı',
            open_link: 'Aç'
        },
        en: {
            download: 'Download',
            processing: 'Processing...',
            playlist: 'Playlist',
            quick_mode: 'Quick mode',
            close: 'Close',
            completed: 'Completed!',
            error: 'Error!',
            start_time: 'Start Time',
            end_time: 'End (optional)',
            subs: 'Subtitles',
            offline: 'UniGet app is closed',
            open_link: 'Open'
        }
    };

    const userLang = navigator.language.split('-')[0];
    const t = (key) => (messages[userLang] || messages.en)[key];
    // chrome namespace works callback-style in both Chrome and Firefox;
    // Firefox's `browser` namespace rejects callbacks (promise-only API).
    const myBrowser = typeof chrome !== 'undefined' && chrome.runtime ? chrome : browser;
    const API_BASE = 'http://127.0.0.1:3000';

    let currentVideoInfo = null;
    let pollTimer = null;
    let healthTimer = null;
    let positionRaf = null;
    let positionFallbackTimer = null;
    let cachedVideo = null;
    let cachedVideoAt = 0;
    let lastUrl = '';
    let targetUrl = window.location.href;
    let isAppOnline = false;
    let lastActivity = Date.now();
    let mouseX = 0;
    let mouseY = 0;
    let isMouseOverBtn = false;
    let isQueueing = false;

    function bgFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            myBrowser.runtime.sendMessage({ type: 'fetch', url, options }, response => {
                if (myBrowser.runtime.lastError) reject(myBrowser.runtime.lastError);
                else resolve(response);
            });
        });
    }

    function setVisible(el, show) {
        el.style.display = show ? (el.dataset.display || 'flex') : 'none';
    }

    function safeUrl(value) {
        try { return new URL(value, window.location.href); } catch { return null; }
    }

    // yt-dlp's X/Twitter extractor needs a segment before /status/, i.e.
    // /<user>/status/<id> (or /i/status/<id>). Matching only "/status/<id>"
    // drops the username and yields an "Unsupported URL" error, so preserve
    // the segment that precedes /status/ and fall back to /i/status/<id>.
    function normalizeStatusPath(pathname) {
        let m = pathname.match(/\/([^/]+)\/status\/(\d+)/);
        if (m) return `/${m[1]}/status/${m[2]}`;
        m = pathname.match(/\/status\/(\d+)/);
        if (m) return `/i/status/${m[1]}`;
        return null;
    }

    function getStatusUrlFromElement(el) {
        const article = el?.closest?.('article') || document.elementFromPoint(mouseX, mouseY)?.closest?.('article');
        const scope = article || document;
        const anchors = scope.querySelectorAll ? scope.querySelectorAll('a[href*="/status/"]') : [];
        for (const a of anchors) {
            const parsed = safeUrl(a.getAttribute('href'));
            if (!parsed) continue;
            if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(parsed.hostname)) continue;
            const normalized = normalizeStatusPath(parsed.pathname);
            if (!normalized) continue;
            parsed.pathname = normalized;
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        }

        const current = safeUrl(window.location.href);
        if (current && /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(current.hostname)) {
            const normalized = normalizeStatusPath(current.pathname);
            if (normalized) {
                current.pathname = normalized;
                current.search = '';
                current.hash = '';
                return current.toString();
            }
        }
        return null;
    }

    function getCanonicalMediaUrl(video) {
        const host = window.location.hostname;
        if (host.includes('youtube.com') || host === 'youtu.be') return window.location.href;
        if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
            return getStatusUrlFromElement(video) || window.location.href;
        }
        return window.location.href;
    }

    function getFastInfo(video) {
        const host = (() => {
            try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return ''; }
        })();
        const article = video?.closest?.('article');
        const articleText = article?.innerText?.split('\n').filter(Boolean).slice(0, 3).join(' - ');
        const title = (articleText || document.title || 'Video / Media').replace(/\s+/g, ' ').trim();
        const metaImage = document.querySelector('meta[property="og:image"]')?.content || '';
        return {
            title,
            thumbnail: video?.poster || metaImage,
            author: host
        };
    }

    function applyInfo(info) {
        currentVideoInfo = info;
        videoTitle.innerText = info.title || 'Video / Media';
        videoSub.innerText = info.author || '';
        thumbnail.classList.add('skeleton');
        thumbnail.src = info.thumbnail || '';
    }

    function hidePopup() {
        if (popup.style.display === 'none') return;
        popup.classList.add('closing');
        setTimeout(() => {
            popup.classList.remove('closing', 'visible');
            setVisible(popup, false);
        }, 160);
    }

    function getBestVideo() {
        const now = Date.now();
        if (cachedVideo && cachedVideo.isConnected && now - cachedVideoAt < 700) return cachedVideo;

        let best = null;
        let maxArea = 0;
        if (window.location.hostname.includes('youtube.com')) {
            best = document.querySelector('video.html5-main-video');
            if (best && best.isConnected) {
                cachedVideo = best;
                cachedVideoAt = now;
                return best;
            }
        }

        for (const v of document.querySelectorAll('video')) {
            if (!v.isConnected) continue;
            const r = v.getBoundingClientRect();
            if (r.top >= window.innerHeight - 20 || r.bottom <= 20 ||
                r.left >= window.innerWidth - 20 || r.right <= 20) continue;
            const area = r.width * r.height;
            if (area > maxArea && area > 5000) {
                maxArea = area;
                best = v;
            }
        }
        cachedVideo = best;
        cachedVideoAt = now;
        return best;
    }

    const btn = document.createElement('div');
    btn.className = 'uniget-mini-btn';
    btn.dataset.display = 'flex';

    const imgElement = document.createElement('img');
    imgElement.src = myBrowser.runtime.getURL('icon.png');
    imgElement.style.cssText = 'width:16px;height:16px;pointer-events:none;display:block;';

    const statusDot = document.createElement('span');
    statusDot.className = 'uniget-status-dot';
    btn.append(imgElement, statusDot);
    document.body.appendChild(btn);

    const popup = document.createElement('div');
    popup.className = 'uniget-popup';
    popup.style.display = 'none';


    const infoSection = document.createElement('div');
    infoSection.className = 'uniget-info-wrap';
    const thumbnail = document.createElement('img');
    thumbnail.className = 'uniget-thumb';
    // Skeleton shimmer while the real thumbnail loads
    const THUMB_FALLBACK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    thumbnail.addEventListener('load', () => thumbnail.classList.remove('skeleton'));
    thumbnail.addEventListener('error', () => {
        // Replace the broken-image glyph with a quiet placeholder
        if (thumbnail.src !== THUMB_FALLBACK) thumbnail.src = THUMB_FALLBACK;
    });
    const infoText = document.createElement('div');
    infoText.style.flex = '1';
    const videoTitle = document.createElement('div');
    videoTitle.className = 'uniget-video-title';
    const videoSub = document.createElement('div');
    videoSub.className = 'uniget-video-sub';
    infoText.append(videoTitle, videoSub);
    infoSection.append(thumbnail, infoText);

    const qualitySelect = document.createElement('select');
    [
        { v: 'best', t: 'Best / Original' },
        { v: '2160', t: '4K (2160p)' },
        { v: '1440', t: '2K (1440p)' },
        { v: '1080', t: 'HD (1080p)' },
        { v: '720', t: 'SD (720p)' },
        { v: 'audio', t: 'Audio Only (MP3)' }
    ].forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.v;
        opt.innerText = q.t;
        qualitySelect.appendChild(opt);
    });

    const optionsRow = document.createElement('div');
    optionsRow.className = 'uniget-opts';
    const plLbl = document.createElement('label');
    plLbl.className = 'uniget-opt-lbl';
    const plChk = document.createElement('input');
    plChk.type = 'checkbox';
    plChk.id = 'uniget-pl';
    plLbl.append(plChk, document.createTextNode(t('playlist')));
    const quickLbl = document.createElement('label');
    quickLbl.className = 'uniget-opt-lbl';
    const quickChk = document.createElement('input');
    quickChk.type = 'checkbox';
    quickChk.id = 'uniget-quick';
    quickChk.checked = localStorage.getItem('uniget_ext_quick') === 'true';
    quickLbl.append(quickChk, document.createTextNode(t('quick_mode')));

    const subsLbl = document.createElement('label');
    subsLbl.className = 'uniget-opt-lbl';
    const subsChk = document.createElement('input');
    subsChk.type = 'checkbox';
    subsChk.id = 'uniget-subs';
    subsChk.checked = localStorage.getItem('uniget_ext_subs') === 'true';
    subsLbl.append(subsChk, document.createTextNode(t('subs')));
    optionsRow.append(plLbl, quickLbl, subsLbl);

    const trimGrid = document.createElement('div');
    trimGrid.className = 'uniget-trim-grid';
    const createTimeInput = (placeholder, id) => {
        const inp = document.createElement('input');
        inp.className = 'uniget-input-small';
        inp.placeholder = placeholder;
        inp.title = 'HH:MM:SS';
        inp.id = id;
        return inp;
    };
    const startTimeInp = createTimeInput(t('start_time'), 'uniget-start');
    const endTimeInp = createTimeInput(t('end_time'), 'uniget-end');
    trimGrid.append(startTimeInp, endTimeInp);

    const btnStart = document.createElement('button');
    btnStart.className = 'uniget-btn-primary';
    btnStart.innerText = t('download');

    const progCont = document.createElement('div');
    progCont.className = 'uniget-prog-cont';
    progCont.dataset.display = 'flex';
    const progInfo = document.createElement('div');
    progInfo.className = 'uniget-prog-info';
    const progPct = document.createElement('span');
    const progSpeed = document.createElement('span');
    progInfo.append(progPct, progSpeed);
    const progOuter = document.createElement('div');
    progOuter.className = 'uniget-prog-outer';
    const progBar = document.createElement('div');
    progBar.className = 'uniget-progress-bar';
    progOuter.appendChild(progBar);
    progCont.append(progInfo, progOuter);

    popup.append(infoSection, qualitySelect, trimGrid, optionsRow, btnStart, progCont);
    document.body.appendChild(popup);

    function updatePosition() {
        positionRaf = null;
        const video = getBestVideo();
        if (!video) {
            setVisible(btn, false);
            return;
        }

        const rect = video.getBoundingClientRect();
        const isMouseInside = mouseX >= rect.left && mouseX <= rect.right &&
            mouseY >= rect.top && mouseY <= rect.bottom;
        const shouldShow = (isMouseInside && Date.now() - lastActivity < 2500) ||
            isMouseOverBtn || popup.style.display !== 'none';

        if (shouldShow) {
            btn.style.top = `${Math.round(rect.top + 15)}px`;
            btn.style.left = `${Math.round(rect.left + rect.width / 2 - 16)}px`;
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            setVisible(btn, true);
        } else {
            btn.style.opacity = '0';
            btn.style.pointerEvents = 'none';
            setTimeout(() => { if (btn.style.opacity === '0') setVisible(btn, false); }, 200);
        }

        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            plChk.checked = lastUrl.includes('&list=');
        }
    }

    function requestPositionUpdate() {
        if (document.hidden || positionRaf) return;
        positionRaf = requestAnimationFrame(updatePosition);
    }

    function startPositionFallback() {
        clearInterval(positionFallbackTimer);
        positionFallbackTimer = setInterval(requestPositionUpdate, document.hidden ? 5000 : 1800);
    }

    async function checkAppHealth() {
        try {
            const result = await bgFetch(`${API_BASE}/api/health`);
            isAppOnline = !!result && !result.error;
        } catch {
            isAppOnline = false;
        }
        statusDot.classList.toggle('online', isAppOnline);
        btn.title = isAppOnline ? 'UniGet - bağlı' : 'UniGet - bağlı değil';
        if (!isAppOnline) showOfflineBanner();
        else hideOfflineBanner();
    }

    function showOfflineBanner() {
        if (document.getElementById('uniget-offline-banner')) return;
        const b = document.createElement('div');
        b.id = 'uniget-offline-banner';
        b.className = 'uniget-offline-pill';
        b.append(
            Object.assign(document.createElement('span'), { className: 'uniget-pill-dot' }),
            document.createTextNode(`${t('offline')} `)
        );
        const link = document.createElement('a');
        link.href = API_BASE;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.innerText = t('open_link');
        b.appendChild(link);
        document.body.appendChild(b);
    }

    function hideOfflineBanner() {
        document.getElementById('uniget-offline-banner')?.remove();
    }

    function scheduleHealthCheck() {
        clearTimeout(healthTimer);
        healthTimer = setTimeout(async () => {
            await checkAppHealth();
            scheduleHealthCheck();
        }, document.hidden ? 45000 : 15000);
    }

    async function loadInfo(video) {
        applyInfo(getFastInfo(video));
        const host = (() => {
            try { return new URL(targetUrl).hostname; } catch { return ''; }
        })();
        if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return;

        try {
            const data = await bgFetch(`https://noembed.com/embed?url=${encodeURIComponent(targetUrl)}`);
            if (data && data.title) {
                applyInfo({
                    title: data.title,
                    thumbnail: data.thumbnail_url || currentVideoInfo?.thumbnail || '',
                    author: data.author_name || currentVideoInfo?.author || ''
                });
            }
        } catch {}
    }

    async function validateMediaBeforeDownload(url) {
        const result = await bgFetch(`${API_BASE}/api/validate-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            timeout: 25000
        });
        if (!result || result.error) throw new Error(result?.error || 'Media could not be verified');
        if (result.downloadable === false || result.mediaType === 'image') {
            throw new Error('Bu baglanti video/ses gibi gorunmuyor.');
        }
        return result;
    }

    function openPopup(anchorRect, video = getBestVideo(), forcedUrl = null) {
        targetUrl = forcedUrl || getCanonicalMediaUrl(video);
        popup.classList.remove('closing');
        setVisible(popup, true);
        popup.classList.add('visible');

        const popupH = 360;
        const top = anchorRect ? Math.min(window.innerHeight - popupH - 10, Math.round(anchorRect.bottom + 8)) : 20;
        const left = anchorRect ? Math.max(10, Math.min(window.innerWidth - 360, Math.round(anchorRect.left - 150))) : 'auto';
        popup.style.top = `${top}px`;
        popup.style.left = typeof left === 'number' ? `${left}px` : 'auto';
        popup.style.right = typeof left === 'string' ? '20px' : 'auto';

        loadInfo(video);
        setVisible(btnStart, true);
        btnStart.disabled = false;
        btnStart.classList.remove('uniget-btn-loading');
        btnStart.innerText = t('download');
        setVisible(progCont, false);
        progBar.style.background = 'var(--uniget-accent)';
        if (pollTimer) clearTimeout(pollTimer);
        qualitySelect.focus({ preventScroll: true });
    }

    function pollDownload(id) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(async () => {
            try {
                const dl = await bgFetch(`${API_BASE}/api/status/${id}`);
                if (!dl || dl.error) throw new Error(dl?.error || 'status unavailable');
                const status = String(dl.status || '');
                if (status === 'completed') {
                    progPct.innerText = '100%';
                    progBar.style.width = '100%';
                    progBar.style.background = 'var(--uniget-accent)';
                    progSpeed.innerText = t('completed');
                    setTimeout(hidePopup, 1800);
                    return;
                }
                if (status === 'failed' || status.startsWith('error:')) {
                    progSpeed.innerText = (dl.errorDetail || status.replace('error:', '') || t('error')).slice(0, 120);
                    progBar.style.background = 'var(--uniget-danger)';
                    setVisible(btnStart, true);
                    btnStart.disabled = false;
                    btnStart.classList.remove('uniget-btn-loading');
                    btnStart.innerText = t('download');
                    setVisible(progCont, false);
                    return;
                }
                const p = dl.progress || 0;
                progPct.innerText = `${p}%`;
                progBar.style.width = `${p}%`;
                progSpeed.innerText = dl.speed || t('processing');
                pollDownload(id);
            } catch {
                setVisible(btnStart, true);
                btnStart.disabled = false;
                btnStart.innerText = t('download');
                setVisible(progCont, false);
            }
        }, 500);
    }

    async function queueDownload() {
        if (isQueueing) return;
        isQueueing = true;
        btnStart.disabled = true;
        btnStart.classList.add('uniget-btn-loading');
        btnStart.innerText = t('processing');

        try {
            if (!isAppOnline) throw new Error(t('offline'));
            await validateMediaBeforeDownload(targetUrl);
            const res = await bgFetch(`${API_BASE}/api/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: targetUrl,
                    title: currentVideoInfo ? currentVideoInfo.title : (document.title || 'Video').replace(' - YouTube', ''),
                    thumbnail: currentVideoInfo?.thumbnail || null,
                    quality: qualitySelect.value,
                    isPlaylist: plChk.checked,
                    autoOpen: false,
                    subtitles: subsChk.checked,
                    startTime: startTimeInp.value.trim() || null,
                    endTime: endTimeInp.value.trim() || null
                })
            });

            if (!res || !res.id) throw new Error((res && res.error) || 'No download ID');
            setVisible(btnStart, false);
            setVisible(progCont, true);
            progBar.style.width = '0%';
            pollDownload(res.id);
        } catch (e) {
            alert(`UniGet: ${e.message}`);
            btnStart.disabled = false;
            btnStart.classList.remove('uniget-btn-loading');
            btnStart.innerText = t('download');
        } finally {
            isQueueing = false;
        }
    }

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        lastActivity = Date.now();
        requestPositionUpdate();
    }, { passive: true });

    btn.addEventListener('mouseenter', () => {
        isMouseOverBtn = true;
        lastActivity = Date.now();
        requestPositionUpdate();
    });
    btn.addEventListener('mouseleave', () => {
        isMouseOverBtn = false;
        requestPositionUpdate();
    });

    btn.onclick = (e) => {
        e.stopPropagation();
        const video = getBestVideo();
        targetUrl = getCanonicalMediaUrl(video);
        if (quickChk.checked) {
            applyInfo(getFastInfo(video));
            queueDownload();
            return;
        }
        openPopup(btn.getBoundingClientRect(), video, targetUrl);
    };

    btnStart.onclick = () => queueDownload();

    // Enter anywhere in the panel starts the download, like a dialog
    [qualitySelect, startTimeInp, endTimeInp].forEach((el) => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnStart.disabled ? null : queueDownload();
            }
        });
    });

    quickChk.addEventListener('change', () => {
        localStorage.setItem('uniget_ext_quick', String(quickChk.checked));
    });
    subsChk.addEventListener('change', () => {
        localStorage.setItem('uniget_ext_subs', String(subsChk.checked));
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popup.style.display !== 'none') {
            hidePopup();
            if (pollTimer) clearTimeout(pollTimer);
        }
    });

    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            hidePopup();
            if (pollTimer) clearTimeout(pollTimer);
        }
    }, true);

    window.addEventListener('resize', requestPositionUpdate);
    window.addEventListener('scroll', requestPositionUpdate, { passive: true });
    document.addEventListener('visibilitychange', () => {
        cachedVideo = null;
        startPositionFallback();
        scheduleHealthCheck();
        requestPositionUpdate();
    });

    myBrowser.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'trigger_download') {
            const video = getBestVideo();
            openPopup(null, video, msg.url || getCanonicalMediaUrl(video));
        }
    });

    if (window.location.host === 'localhost:3000' || window.location.host === '127.0.0.1:3000') {
        document.body.dataset.unigetExtension = 'active';
        try {
            document.body.dataset.unigetExtensionVersion = myBrowser.runtime.getManifest().version;
        } catch (e) { /* version unavailable */ }
    }

    requestPositionUpdate();
    startPositionFallback();
    checkAppHealth();
    scheduleHealthCheck();
})();
