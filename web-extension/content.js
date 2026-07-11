(function() {
    // UniGet Pro Content Script

    const messages = {
        tr: {
            download: 'Indir',
            processing: 'Hazirlaniyor...',
            playlist: 'Calma Listesi',
            quick_mode: 'Hizli mod',
            close: 'Kapat',
            completed: 'Tamamlandi!',
            error: 'Hata!',
            start_time: 'Baslangic',
            end_time: 'Bitis (opsiyonel)'
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
            end_time: 'End (optional)'
        }
    };

    const userLang = navigator.language.split('-')[0];
    const t = (key) => (messages[userLang] || messages.en)[key];
    // chrome namespace works callback-style in both Chrome and Firefox;
    // Firefox's `browser` namespace rejects callbacks (promise-only API).
    const myBrowser = typeof chrome !== 'undefined' && chrome.runtime ? chrome : browser;
    const API_BASE = 'http://127.0.0.1:3000';
    const manifestVersion = myBrowser.runtime.getManifest ? myBrowser.runtime.getManifest().version : '1.5.13';

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

    function getStatusUrlFromElement(el) {
        const article = el?.closest?.('article') || document.elementFromPoint(mouseX, mouseY)?.closest?.('article');
        const scope = article || document;
        const anchors = scope.querySelectorAll ? scope.querySelectorAll('a[href*="/status/"]') : [];
        for (const a of anchors) {
            const parsed = safeUrl(a.getAttribute('href'));
            if (!parsed) continue;
            if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(parsed.hostname)) continue;
            const match = parsed.pathname.match(/\/status\/\d+/);
            if (!match) continue;
            parsed.pathname = match[0];
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        }

        const current = safeUrl(window.location.href);
        if (current && /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(current.hostname)) {
            const match = current.pathname.match(/\/status\/\d+/);
            if (match) {
                current.pathname = match[0];
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
        thumbnail.src = info.thumbnail || '';
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

    const titleDiv = document.createElement('div');
    titleDiv.className = 'uniget-title-wrap';
    const nameSpan = document.createElement('span');
    nameSpan.innerText = 'UniGet';
    const verSpan = document.createElement('span');
    verSpan.innerText = `v${manifestVersion}`;
    titleDiv.append(nameSpan, verSpan);

    const infoSection = document.createElement('div');
    infoSection.className = 'uniget-info-wrap';
    const thumbnail = document.createElement('img');
    thumbnail.className = 'uniget-thumb';
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
    optionsRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--uniget-text);';
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
    optionsRow.append(plLbl, quickLbl);

    const trimGrid = document.createElement('div');
    trimGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
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

    const btnRow = document.createElement('div');
    btnRow.className = 'uniget-btn-row';
    const btnStart = document.createElement('button');
    btnStart.className = 'uniget-btn-primary';
    btnStart.innerText = t('download');
    const btnClose = document.createElement('button');
    btnClose.className = 'uniget-btn-secondary';
    btnClose.innerText = t('close');
    btnRow.append(btnStart, btnClose);

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

    popup.append(titleDiv, infoSection, qualitySelect, trimGrid, optionsRow, btnRow, progCont);
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
        btn.title = isAppOnline ? 'UniGet - bagli' : 'UniGet - bagli degil';
        if (!isAppOnline) showOfflineBanner();
        else hideOfflineBanner();
    }

    function showOfflineBanner() {
        if (document.getElementById('uniget-offline-banner')) return;
        const b = document.createElement('div');
        b.id = 'uniget-offline-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#ef4444;color:#fff;text-align:center;padding:10px;z-index:2147483647;font-family:sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,.3);';
        b.innerHTML = `UniGet uygulamasi kapali! <a href="${API_BASE}" style="color:#fff;text-decoration:underline;margin-left:10px;">Ac</a>`;
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
            body: JSON.stringify({ url })
        });
        if (!result || result.error) throw new Error(result?.error || 'Media could not be verified');
        if (result.downloadable === false || result.mediaType === 'image') {
            throw new Error('Bu baglanti video/ses gibi gorunmuyor.');
        }
        return result;
    }

    function openPopup(anchorRect, video = getBestVideo(), forcedUrl = null) {
        targetUrl = forcedUrl || getCanonicalMediaUrl(video);
        setVisible(popup, true);

        const popupH = 360;
        const top = anchorRect ? Math.min(window.innerHeight - popupH - 10, Math.round(anchorRect.bottom + 8)) : 20;
        const left = anchorRect ? Math.max(10, Math.min(window.innerWidth - 360, Math.round(anchorRect.left - 150))) : 'auto';
        popup.style.top = `${top}px`;
        popup.style.left = typeof left === 'number' ? `${left}px` : 'auto';
        popup.style.right = typeof left === 'string' ? '20px' : 'auto';

        loadInfo(video);
        setVisible(btnStart, true);
        btnStart.disabled = false;
        btnStart.innerText = t('download');
        setVisible(progCont, false);
        progBar.style.background = 'var(--uniget-btn)';
        if (pollTimer) clearTimeout(pollTimer);
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
                    progBar.style.background = '#10b981';
                    progSpeed.innerText = t('completed');
                    setTimeout(() => setVisible(popup, false), 1800);
                    return;
                }
                if (status === 'failed' || status.startsWith('error:')) {
                    progSpeed.innerText = (dl.errorDetail || status.replace('error:', '') || t('error')).slice(0, 120);
                    progBar.style.background = '#ef4444';
                    setVisible(btnStart, true);
                    btnStart.disabled = false;
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
        btnStart.innerText = t('processing');

        try {
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

    btnClose.onclick = () => {
        setVisible(popup, false);
        if (pollTimer) clearTimeout(pollTimer);
    };

    btnStart.onclick = () => queueDownload();
    quickChk.addEventListener('change', () => {
        localStorage.setItem('uniget_ext_quick', String(quickChk.checked));
    });

    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== btn) {
            setVisible(popup, false);
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
    }

    requestPositionUpdate();
    startPositionFallback();
    checkAppHealth();
    scheduleHealthCheck();
})();
