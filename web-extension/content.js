(function() {
    // UniGet Pro v1.5.1 Content Script
    // Highly optimized for performance and snappiness
    
    const messages = {
        tr: { download: "İndir", quality: "Kalite", processing: "Hazırlanıyor...", playlist: "Çalma Listesi", auto_open: "Klasörü Aç", speed: "Hız", eta: "Süre", close: "Kapat", completed: "Tamamlandı!", error: "Hata!", start_time: "Başlangıç", end_time: "Bitiş (opsiyonel)" },
        en: { download: "Download", quality: "Quality", processing: "Processing...", playlist: "Playlist", auto_open: "Open Folder", speed: "Speed", eta: "ETA", close: "Close", completed: "Completed!", error: "Error!", start_time: "Start Time", end_time: "End (optional)" }
    };

    const userLang = navigator.language.split('-')[0];
    const t = (key) => (messages[userLang] || messages['en'])[key];
    const myBrowser = typeof browser !== 'undefined' ? browser : chrome;
    let currentVideoInfo = null;
    const storage = (myBrowser.storage && myBrowser.storage.local) ? myBrowser.storage.local : null;

    async function bgFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            myBrowser.runtime.sendMessage({ type: 'fetch', url, options }, response => {
                if (myBrowser.runtime.lastError) reject(myBrowser.runtime.lastError);
                else resolve(response);
            });
        });
    }

    function getStorageValue(key, fallback = null) {
        return new Promise((resolve) => {
            if (!storage) return resolve(fallback);
            storage.get([key], (result) => {
                if (myBrowser.runtime.lastError) return resolve(fallback);
                resolve(typeof result[key] === 'undefined' ? fallback : result[key]);
            });
        });
    }

    function setStorageValue(key, value) {
        if (!storage) return;
        storage.set({ [key]: value });
    }

    // Helper for fast style/class management
    const setVisible = (el, show) => { el.style.display = show ? (el.dataset.display || 'flex') : 'none'; };

    // Snappy UI Creation
    const btn = document.createElement('div');
    btn.className = 'uniget-mini-btn';
    btn.dataset.display = 'flex';
    
    const imgElement = document.createElement('img');
    imgElement.src = myBrowser.runtime.getURL('icon.png');
    imgElement.style.cssText = 'width:16px; height:16px; pointer-events:none;';

    const label = document.createElement('span');
    label.innerText = t('download');
    const statusDot = document.createElement('span');
    statusDot.className = 'uniget-status-dot';

    btn.append(imgElement, label, statusDot);
    document.body.appendChild(btn);

    // Popup Creation
    const popup = document.createElement('div');
    popup.className = 'uniget-popup';
    popup.style.display = 'none';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'uniget-title-wrap';
    const nameSpan = document.createElement('span');
    nameSpan.innerText = 'UniGet Pro';
    const verSpan = document.createElement('span');
    verSpan.innerText = 'v1.5.1';
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
        {v: 'best', t: 'Best / Original'},
        {v: '2160', t: '4K (2160p)'},
        {v: '1440', t: '2K (1440p)'},
        {v: '1080', t: 'HD (1080p)'},
        {v: '720', t: 'SD (720p)'},
        {v: 'audio', t: 'Audio Only (MP3)'}
    ].forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.v; opt.innerText = q.t;
        qualitySelect.appendChild(opt);
    });

    const optionsGrid = document.createElement('div');
    optionsGrid.className = 'uniget-opts';
    
    const createCheck = (text, checked, id) => {
        const lbl = document.createElement('label');
        lbl.className = 'uniget-opt-lbl';
        const chk = document.createElement('input');
        chk.type = 'checkbox'; chk.checked = checked; chk.id = id;
        lbl.append(chk, document.createTextNode(text));
        return { lbl, chk };
    };

    const { lbl: plLbl, chk: plChk } = createCheck(t('playlist'), false, 'uniget-pl');
    const { lbl: autoLbl, chk: autoChk } = createCheck(t('auto_open'), true, 'uniget-auto');
    autoLbl.style.fontSize = '11px'; autoLbl.style.color = 'var(--uniget-dim)'; autoLbl.style.gridColumn = 'span 2';

    optionsGrid.append(plLbl, autoLbl);

    const btnRow = document.createElement('div');
    btnRow.className = 'uniget-btn-row';
    const btnStart = document.createElement('button');
    btnStart.className = 'uniget-btn-primary';
    btnStart.innerText = t('download');
    const btnQuick = document.createElement('button');
    btnQuick.className = 'uniget-btn-secondary';
    btnQuick.innerText = 'Sessiz Indir';
    const btnCancel = document.createElement('button');
    btnCancel.className = 'uniget-btn-secondary';
    btnCancel.innerText = t('close');
    btnRow.append(btnStart, btnQuick, btnCancel);

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

    // Trimming UI
    const trimGrid = document.createElement('div');
    trimGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 5px;';
    
    const createTimeInput = (labelPlaceholder, id) => {
        const inp = document.createElement('input');
        inp.className = 'uniget-input-small';
        inp.placeholder = labelPlaceholder;
        inp.title = 'HH:MM:SS or SS';
        inp.id = id;
        return inp;
    };

    const startTimeInp = createTimeInput(t('start_time'), 'uniget-start');
    const endTimeInp = createTimeInput(t('end_time'), 'uniget-end');
    trimGrid.append(startTimeInp, endTimeInp);

    popup.append(titleDiv, infoSection, qualitySelect, trimGrid, optionsGrid, btnRow, progCont);
    document.body.appendChild(popup);

    // Logic
    let pollTimer = null;
    let lastUrl = null;
    let targetDownloadUrl = window.location.href;
    let healthTimer = null;
    let positionTimer = null;
    let isAppOnline = false;
    let lastActivity = Date.now();
    let mouseX = 0, mouseY = 0;
    let isMouseOverBtn = false;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        lastActivity = Date.now();
    }, { passive: true });

    btn.addEventListener('mouseenter', () => { isMouseOverBtn = true; lastActivity = Date.now(); });
    btn.addEventListener('mouseleave', () => { isMouseOverBtn = false; });

    function getBestVideo() {
        if (window.location.hostname.includes('youtube.com')) {
            if (!window.location.pathname.startsWith('/watch') && !window.location.pathname.startsWith('/shorts')) {
                return null;
            }
            const mainVideo = document.querySelector('video.html5-main-video');
            if (mainVideo && mainVideo.isConnected) return mainVideo;
        }

        const videos = document.querySelectorAll('video');
        let best = null, maxArea = 0;
        for (let v of videos) {
            if (!v.isConnected) continue;
            const rect = v.getBoundingClientRect();
            // Skip if almost entirely offscreen
            if (rect.top >= window.innerHeight - 20 || rect.bottom <= 20 || rect.left >= window.innerWidth - 20 || rect.right <= 20) continue;
            const area = rect.width * rect.height;
            if (area > maxArea && area > 5000) { 
                maxArea = area;
                best = v;
            }
        }
        return best;
    }

    function updatePosition() {
        const video = getBestVideo();
        if (!video) {
            setVisible(btn, false);
            return;
        }

        const rect = video.getBoundingClientRect();
        
        // Hide logic: Check if mouse is inside video bounds and active
        const isMouseInside = mouseX >= rect.left && mouseX <= rect.right && 
                              mouseY >= rect.top && mouseY <= rect.bottom;
        const now = Date.now();
        const isRecentlyActive = (now - lastActivity < 2500);
        const isPopupOpen = popup.style.display !== 'none';
        
        const shouldBeVisible = (isMouseInside && isRecentlyActive) || isMouseOverBtn || isPopupOpen;

        if (shouldBeVisible) {
            btn.style.top = Math.round(rect.top + 15) + 'px';
            btn.style.left = Math.round(rect.left + (rect.width / 2) - 50) + 'px';
            btn.style.zIndex = '9999999';
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            setVisible(btn, true);
        } else {
            btn.style.opacity = '0';
            btn.style.pointerEvents = 'none';
            // Delay display none for fade out effect if CSS supports it
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
        const delay = document.hidden ? 1400 : 350;
        positionTimer = setTimeout(() => {
            updatePosition();
            schedulePositionUpdate();
        }, delay);
    }

    async function checkAppHealth() {
        try {
            const result = await Promise.race([
                bgFetch('http://localhost:3000/api/settings'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
            ]);
            isAppOnline = !!result && !result.error;
            if (!isAppOnline) showOfflineBanner();
            else hideOfflineBanner();
        } catch (e) {
            isAppOnline = false;
            showOfflineBanner();
        }
        statusDot.classList.toggle('online', isAppOnline);
        btn.title = isAppOnline ? 'UniGet app bagli' : 'UniGet app offline';
    }

    function showOfflineBanner() {
        if (document.getElementById('uniget-offline-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'uniget-offline-banner';
        banner.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; background: #ef4444; color: white;
            text-align: center; padding: 10px; z-index: 2147483647; font-family: sans-serif;
            font-size: 14px; font-weight: 600; box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        banner.innerHTML = `UniGet Masaüstü uygulaması kapalı veya kurulu değil! <a href="http://localhost:3000" style="color: white; text-decoration: underline; margin-left: 10px;">Uygulamayı Aç / İndir</a>`;
        document.body.appendChild(banner);
    }

    function hideOfflineBanner() {
        const banner = document.getElementById('uniget-offline-banner');
        if (banner) banner.remove();
    }

    // Mark extension as active on localhost
    if (window.location.host === 'localhost:3000' || window.location.host === '127.0.0.1:3000') {
        document.body.dataset.unigetExtension = "active";
    }

    function scheduleHealthCheck() {
        clearTimeout(healthTimer);
        const delay = document.hidden ? 30000 : 12000;
        healthTimer = setTimeout(async () => {
            await checkAppHealth();
            scheduleHealthCheck();
        }, delay);
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

    async function loadInfo() {
        try {
            const data = await bgFetch(`https://noembed.com/embed?url=${encodeURIComponent(targetDownloadUrl)}`);
            if (data.title) {
                currentVideoInfo = { title: data.title, thumbnail: data.thumbnail_url, author: data.author_name };
                videoTitle.innerText = data.title;
                try { videoSub.innerText = data.author_name || new URL(targetDownloadUrl).hostname; } catch(e) { videoSub.innerText = 'Media'; }
                thumbnail.src = data.thumbnail_url || '';
            } else {
                throw new Error("No data");
            }
        } catch(e) {
            currentVideoInfo = null;
            videoTitle.innerText = document.title || 'Video / Media';
            try { videoSub.innerText = new URL(targetDownloadUrl).hostname; } catch(err) { videoSub.innerText = 'Unknown Site'; }
            thumbnail.src = ''; 
        }
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        targetDownloadUrl = window.location.href;
        const rect = btn.getBoundingClientRect();
        setVisible(popup, true);
        popup.style.top = Math.min(window.innerHeight - 360, Math.round(rect.top + 40)) + 'px';
        popup.style.left = Math.max(10, Math.round(rect.left - 200)) + 'px';
        
        loadInfo();
        setVisible(btnStart, true);
        btnStart.disabled = false;
        btnStart.innerText = t('download');
        setVisible(progCont, false);
        if (pollTimer) clearInterval(pollTimer);
    };

    btnCancel.onclick = () => { setVisible(popup, false); if (pollTimer) clearInterval(pollTimer); };

    async function queueDownload({ silent = false, useLastProfile = false } = {}) {
        btnStart.disabled = true;
        btnStart.innerText = t('processing');

        try {
            let selectedQuality = qualitySelect.value;
            if (useLastProfile) {
                selectedQuality = await getStorageValue('uniget_last_quality', selectedQuality);
                qualitySelect.value = selectedQuality;
            }
            const res = await bgFetch(`http://localhost:3000/api/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: targetDownloadUrl,
                    title: currentVideoInfo ? currentVideoInfo.title : (document.title || 'Video Media').replace(' - YouTube', ''),
                    quality: selectedQuality,
                    isPlaylist: plChk.checked,
                    autoOpen: autoChk.checked,
                    startTime: startTimeInp.value.trim() || null,
                    endTime: endTimeInp.value.trim() || null
                })
            });

            if (res && res.id) {
                setStorageValue('uniget_last_quality', selectedQuality);
                if (silent) {
                    btnStart.disabled = false;
                    btnStart.innerText = t('download');
                    setVisible(popup, false);
                    return;
                }
                setVisible(btnStart, false);
                setVisible(progCont, true);
                progBar.style.width = '0%';
                
                pollTimer = setInterval(async () => {
                    const dl = await bgFetch(`http://localhost:3000/api/status/${res.id}`);
                    if (!dl || dl.error) { 
                        clearInterval(pollTimer); 
                        btnStart.disabled = false;
                        setVisible(btnStart, true);
                        setVisible(progCont, false);
                        return; 
                    }
                    
                    if (dl.status === 'completed') {
                        clearInterval(pollTimer);
                        progPct.innerText = '100%';
                        progBar.style.width = '100%';
                        progBar.style.background = '#10b981';
                        progSpeed.innerText = t('completed');
                        setTimeout(() => setVisible(popup, false), 2000);
                    } else if (dl.status && (dl.status.toLowerCase().includes('hata') || dl.status === 'failed')) {
                        clearInterval(pollTimer);
                        progSpeed.innerText = t('error');
                        progBar.style.background = '#ef4444';
                        btnStart.disabled = false;
                        btnStart.innerText = t('download');
                        setVisible(btnStart, true);
                        setVisible(progCont, false);
                    } else {
                        const p = dl.progress || 0;
                        progPct.innerText = p + '%';
                        progBar.style.width = p + '%';
                        progSpeed.innerText = dl.speed || t('processing');
                    }
                }, 600);
            } else {
                alert("Error: " + ((res && res.error) || "Download ID not received. Check server connection."));
                btnStart.disabled = false;
                btnStart.innerText = t('download');
            }
        } catch(e) {
            alert("Error: " + e.message);
            btnStart.disabled = false;
            btnStart.innerText = t('download');
        }
    }

    btnStart.onclick = () => queueDownload({ silent: false, useLastProfile: false });
    btnQuick.onclick = () => queueDownload({ silent: true, useLastProfile: true });
    myBrowser.runtime.onMessage.addListener((msg) => {
        if (msg.action === "trigger_download") {
            targetDownloadUrl = msg.url || window.location.href;
            setVisible(popup, true);
            
            // Always show it center-ish when triggered from context menu
            popup.style.top = '20px';
            popup.style.right = '20px';
            popup.style.left = 'auto';
            
            loadInfo();
            setVisible(btnStart, true);
            btnStart.disabled = false;
            setVisible(progCont, false);
            if (pollTimer) clearInterval(pollTimer);
        }
    });
})();
