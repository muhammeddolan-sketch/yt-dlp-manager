(function() {
    // UniGet Pro v1.5.3 Content Script

    const messages = {
        tr: { download: "İndir", quality: "Kalite", processing: "Hazırlanıyor...", playlist: "Çalma Listesi", auto_open: "Klasörü Aç", close: "Kapat", completed: "Tamamlandı!", error: "Hata!", start_time: "Başlangıç", end_time: "Bitiş (opsiyonel)" },
        en: { download: "Download", quality: "Quality", processing: "Processing...", playlist: "Playlist", auto_open: "Open Folder", close: "Close", completed: "Completed!", error: "Error!", start_time: "Start Time", end_time: "End (optional)" }
    };

    const userLang = navigator.language.split('-')[0];
    const t = (key) => (messages[userLang] || messages['en'])[key];
    const myBrowser = typeof browser !== 'undefined' ? browser : chrome;
    let currentVideoInfo = null;

    async function bgFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            myBrowser.runtime.sendMessage({ type: 'fetch', url, options }, response => {
                if (myBrowser.runtime.lastError) reject(myBrowser.runtime.lastError);
                else resolve(response);
            });
        });
    }

    const setVisible = (el, show) => { el.style.display = show ? (el.dataset.display || 'flex') : 'none'; };

    // ─── Floating button ─────────────────────────────────────────
    const btn = document.createElement('div');
    btn.className = 'uniget-mini-btn';
    btn.dataset.display = 'flex';

    const imgElement = document.createElement('img');
    imgElement.src = myBrowser.runtime.getURL('icon.png');
    imgElement.style.cssText = 'width:16px; height:16px; pointer-events:none; display:block;';

    const statusDot = document.createElement('span');
    statusDot.className = 'uniget-status-dot';

    btn.append(imgElement, statusDot);
    document.body.appendChild(btn);

    // ─── Popup ───────────────────────────────────────────────────
    const popup = document.createElement('div');
    popup.className = 'uniget-popup';
    popup.style.display = 'none';

    // Header row: title + version
    const titleDiv = document.createElement('div');
    titleDiv.className = 'uniget-title-wrap';
    const nameSpan = document.createElement('span');
    nameSpan.innerText = 'UniGet';
    const verSpan = document.createElement('span');
    verSpan.innerText = 'v1.5.3';
    titleDiv.append(nameSpan, verSpan);

    // Video info
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

    // Quality select
    const qualitySelect = document.createElement('select');
    [
        { v: 'best',  t: 'Best / Original' },
        { v: '2160',  t: '4K (2160p)' },
        { v: '1440',  t: '2K (1440p)' },
        { v: '1080',  t: 'HD (1080p)' },
        { v: '720',   t: 'SD (720p)' },
        { v: 'audio', t: 'Audio Only (MP3)' }
    ].forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.v; opt.innerText = q.t;
        qualitySelect.appendChild(opt);
    });

    // Options row: playlist checkbox only (auto_open removed — less clutter)
    const optionsRow = document.createElement('div');
    optionsRow.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12px; color:var(--uniget-text);';
    const plLbl = document.createElement('label');
    plLbl.className = 'uniget-opt-lbl';
    const plChk = document.createElement('input');
    plChk.type = 'checkbox'; plChk.id = 'uniget-pl';
    plLbl.append(plChk, document.createTextNode(t('playlist')));
    optionsRow.append(plLbl);

    // Trim inputs
    const trimGrid = document.createElement('div');
    trimGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:8px;';
    const createTimeInput = (placeholder, id) => {
        const inp = document.createElement('input');
        inp.className = 'uniget-input-small';
        inp.placeholder = placeholder;
        inp.title = 'HH:MM:SS';
        inp.id = id;
        return inp;
    };
    const startTimeInp = createTimeInput(t('start_time'), 'uniget-start');
    const endTimeInp   = createTimeInput(t('end_time'),   'uniget-end');
    trimGrid.append(startTimeInp, endTimeInp);

    // Action buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'uniget-btn-row';
    const btnStart = document.createElement('button');
    btnStart.className = 'uniget-btn-primary';
    btnStart.innerText = t('download');
    const btnClose = document.createElement('button');
    btnClose.className = 'uniget-btn-secondary';
    btnClose.innerText = t('close');
    btnRow.append(btnStart, btnClose);

    // Progress
    const progCont = document.createElement('div');
    progCont.className = 'uniget-prog-cont';
    progCont.dataset.display = 'flex';
    const progInfo = document.createElement('div');
    progInfo.className = 'uniget-prog-info';
    const progPct   = document.createElement('span');
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

    // ─── State ───────────────────────────────────────────────────
    let pollTimer      = null;
    let lastUrl        = null;
    let targetUrl      = window.location.href;
    let healthTimer    = null;
    let positionTimer  = null;
    let isAppOnline    = false;
    let lastActivity   = Date.now();
    let mouseX = 0, mouseY = 0;
    let isMouseOverBtn = false;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX; mouseY = e.clientY; lastActivity = Date.now();
    }, { passive: true });
    btn.addEventListener('mouseenter', () => { isMouseOverBtn = true;  lastActivity = Date.now(); });
    btn.addEventListener('mouseleave', () => { isMouseOverBtn = false; });

    // ─── Video detection ─────────────────────────────────────────
    function getBestVideo() {
        if (window.location.hostname.includes('youtube.com')) {
            if (!window.location.pathname.startsWith('/watch') &&
                !window.location.pathname.startsWith('/shorts')) return null;
            const main = document.querySelector('video.html5-main-video');
            if (main && main.isConnected) return main;
        }
        const videos = document.querySelectorAll('video');
        let best = null, maxArea = 0;
        for (const v of videos) {
            if (!v.isConnected) continue;
            const r = v.getBoundingClientRect();
            if (r.top >= window.innerHeight - 20 || r.bottom <= 20 ||
                r.left >= window.innerWidth - 20  || r.right  <= 20) continue;
            const area = r.width * r.height;
            if (area > maxArea && area > 5000) { maxArea = area; best = v; }
        }
        return best;
    }

    // ─── Button positioning ──────────────────────────────────────
    function updatePosition() {
        const video = getBestVideo();
        if (!video) { setVisible(btn, false); return; }

        const rect = video.getBoundingClientRect();
        const isMouseInside = mouseX >= rect.left && mouseX <= rect.right &&
                              mouseY >= rect.top  && mouseY <= rect.bottom;
        const isRecentlyActive = (Date.now() - lastActivity < 2500);
        const isPopupOpen = popup.style.display !== 'none';
        const shouldShow  = (isMouseInside && isRecentlyActive) || isMouseOverBtn || isPopupOpen;

        if (shouldShow) {
            btn.style.top         = Math.round(rect.top + 15) + 'px';
            btn.style.left        = Math.round(rect.left + rect.width / 2 - 16) + 'px';
            btn.style.opacity     = '1';
            btn.style.pointerEvents = 'auto';
            setVisible(btn, true);
        } else {
            btn.style.opacity     = '0';
            btn.style.pointerEvents = 'none';
            setTimeout(() => { if (btn.style.opacity === '0') setVisible(btn, false); }, 200);
        }

        const url = window.location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            plChk.checked = url.includes('&list=');
        }
    }

    function schedulePositionUpdate() {
        clearTimeout(positionTimer);
        positionTimer = setTimeout(() => {
            updatePosition();
            schedulePositionUpdate();
        }, document.hidden ? 1400 : 350);
    }

    // ─── Health check ────────────────────────────────────────────
    async function checkAppHealth() {
        try {
            const result = await Promise.race([
                bgFetch('http://localhost:3000/api/health'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
            ]);
            isAppOnline = !!result && !result.error;
        } catch {
            isAppOnline = false;
        }
        statusDot.classList.toggle('online', isAppOnline);
        btn.title = isAppOnline ? 'UniGet — bağlı' : 'UniGet — bağlı değil';
        if (!isAppOnline) showOfflineBanner(); else hideOfflineBanner();
    }

    function showOfflineBanner() {
        if (document.getElementById('uniget-offline-banner')) return;
        const b = document.createElement('div');
        b.id = 'uniget-offline-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#ef4444;color:#fff;text-align:center;padding:10px;z-index:2147483647;font-family:sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,.3);';
        b.innerHTML = 'UniGet uygulaması kapalı! <a href="http://localhost:3000" style="color:#fff;text-decoration:underline;margin-left:10px;">Aç</a>';
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
        }, document.hidden ? 30000 : 12000);
    }

    // Mark extension active on localhost UI
    if (window.location.host === 'localhost:3000' || window.location.host === '127.0.0.1:3000') {
        document.body.dataset.unigetExtension = 'active';
    }

    schedulePositionUpdate();
    checkAppHealth();
    scheduleHealthCheck();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, { passive: true });
    document.addEventListener('visibilitychange', () => {
        schedulePositionUpdate();
        scheduleHealthCheck();
    });

    // ─── Video info fetch ────────────────────────────────────────
    async function loadInfo() {
        videoTitle.innerText = '...';
        videoSub.innerText   = '';
        thumbnail.src        = '';
        try {
            const data = await bgFetch(`https://noembed.com/embed?url=${encodeURIComponent(targetUrl)}`);
            if (data && data.title) {
                currentVideoInfo = { title: data.title, thumbnail: data.thumbnail_url, author: data.author_name };
                videoTitle.innerText = data.title;
                videoSub.innerText   = data.author_name || new URL(targetUrl).hostname;
                thumbnail.src        = data.thumbnail_url || '';
            } else throw new Error('no data');
        } catch {
            currentVideoInfo = null;
            videoTitle.innerText = document.title || 'Video / Media';
            try { videoSub.innerText = new URL(targetUrl).hostname; } catch { videoSub.innerText = ''; }
        }
    }

    // ─── Popup open ──────────────────────────────────────────────
    function openPopup(anchorRect) {
        setVisible(popup, true);
        // Position below the anchor, keep inside viewport
        const popupH = 360;
        const top  = anchorRect
            ? Math.min(window.innerHeight - popupH - 10, Math.round(anchorRect.bottom + 8))
            : 20;
        const left = anchorRect
            ? Math.max(10, Math.min(window.innerWidth - 360, Math.round(anchorRect.left - 150)))
            : 'auto';
        popup.style.top   = top + 'px';
        popup.style.left  = typeof left === 'number' ? left + 'px' : 'auto';
        popup.style.right = typeof left === 'string' ? '20px' : 'auto';

        loadInfo();
        setVisible(btnStart, true);
        btnStart.disabled = false;
        btnStart.innerText = t('download');
        setVisible(progCont, false);
        progBar.style.background = 'var(--uniget-btn)';
        if (pollTimer) clearInterval(pollTimer);
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        targetUrl = window.location.href;
        openPopup(btn.getBoundingClientRect());
    };

    btnClose.onclick = () => {
        setVisible(popup, false);
        if (pollTimer) clearInterval(pollTimer);
    };

    // Close popup on outside click
    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== btn) {
            setVisible(popup, false);
            if (pollTimer) clearInterval(pollTimer);
        }
    }, true);

    // ─── Download ────────────────────────────────────────────────
    async function queueDownload() {
        btnStart.disabled  = true;
        btnStart.innerText = t('processing');

        try {
            const selectedQuality = qualitySelect.value;
            const res = await bgFetch('http://localhost:3000/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url:       targetUrl,
                    title:     currentVideoInfo ? currentVideoInfo.title : (document.title || 'Video').replace(' - YouTube', ''),
                    quality:   selectedQuality,
                    isPlaylist: plChk.checked,
                    autoOpen:  false,
                    startTime: startTimeInp.value.trim() || null,
                    endTime:   endTimeInp.value.trim()   || null
                })
            });

            if (res && res.id) {
                setVisible(btnStart, false);
                setVisible(progCont, true);
                progBar.style.width = '0%';

                pollTimer = setInterval(async () => {
                    const dl = await bgFetch(`http://localhost:3000/api/status/${res.id}`);
                    if (!dl || dl.error) {
                        clearInterval(pollTimer);
                        setVisible(btnStart, true);
                        btnStart.disabled  = false;
                        btnStart.innerText = t('download');
                        setVisible(progCont, false);
                        return;
                    }
                    const status = String(dl.status || '');
                    if (status === 'completed') {
                        clearInterval(pollTimer);
                        progPct.innerText         = '100%';
                        progBar.style.width       = '100%';
                        progBar.style.background  = '#10b981';
                        progSpeed.innerText       = t('completed');
                        setTimeout(() => setVisible(popup, false), 2000);
                    } else if (status === 'failed' || status.startsWith('error:')) {
                        clearInterval(pollTimer);
                        progSpeed.innerText      = t('error');
                        progBar.style.background = '#ef4444';
                        setVisible(btnStart, true);
                        btnStart.disabled  = false;
                        btnStart.innerText = t('download');
                        setVisible(progCont, false);
                    } else {
                        const p = dl.progress || 0;
                        progPct.innerText   = p + '%';
                        progBar.style.width = p + '%';
                        progSpeed.innerText = dl.speed || t('processing');
                    }
                }, 600);
            } else {
                throw new Error((res && res.error) || 'No download ID');
            }
        } catch (e) {
            alert('UniGet: ' + e.message);
            btnStart.disabled  = false;
            btnStart.innerText = t('download');
        }
    }

    btnStart.onclick = () => queueDownload();

    // ─── Context menu trigger ────────────────────────────────────
    myBrowser.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'trigger_download') {
            targetUrl = msg.url || window.location.href;
            openPopup(null);
        }
    });
})();
