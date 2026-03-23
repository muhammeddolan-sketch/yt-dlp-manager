(function() {
    // YT-DLM Pro v1.4.6 Content Script
    // Highly optimized for performance and snappiness
    
    const messages = {
        tr: { download: "İndir", quality: "Kalite", processing: "Hazırlanıyor...", playlist: "Çalma Listesi", auto_open: "Klasörü Aç", speed: "Hız", eta: "Süre", close: "Kapat", completed: "Tamamlandı!", error: "Hata!", start_time: "Başlangıç", end_time: "Bitiş (opsiyonel)" },
        en: { download: "Download", quality: "Quality", processing: "Processing...", playlist: "Playlist", auto_open: "Open Folder", speed: "Speed", eta: "ETA", close: "Close", completed: "Completed!", error: "Error!", start_time: "Start Time", end_time: "End (optional)" }
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

    // Helper for fast style/class management
    const setVisible = (el, show) => { el.style.display = show ? (el.dataset.display || 'flex') : 'none'; };

    // Snappy UI Creation
    const btn = document.createElement('div');
    btn.className = 'yt-dlm-mini-btn';
    btn.dataset.display = 'flex';
    
    const imgElement = document.createElement('img');
    imgElement.src = myBrowser.runtime.getURL('icon.png');
    imgElement.style.cssText = 'width:16px; height:16px; pointer-events:none;';

    const label = document.createElement('span');
    label.innerText = t('download');

    btn.append(imgElement, label);
    document.body.appendChild(btn);

    // Popup Creation
    const popup = document.createElement('div');
    popup.className = 'yt-dlm-popup';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'ytdlm-title-wrap';
    const nameSpan = document.createElement('span');
    nameSpan.innerText = 'YT-DLM Pro';
    const verSpan = document.createElement('span');
    verSpan.innerText = 'v1.4.6';
    titleDiv.append(nameSpan, verSpan);
    
    const infoSection = document.createElement('div');
    infoSection.className = 'ytdlm-info-wrap';
    const thumbnail = document.createElement('img');
    thumbnail.className = 'ytdlm-thumb';
    const infoText = document.createElement('div');
    infoText.style.flex = '1';
    const videoTitle = document.createElement('div');
    videoTitle.className = 'ytdlm-video-title';
    const videoSub = document.createElement('div');
    videoSub.className = 'ytdlm-video-sub';
    
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
    optionsGrid.className = 'ytdlm-opts';
    
    const createCheck = (text, checked, id) => {
        const lbl = document.createElement('label');
        lbl.className = 'ytdlm-opt-lbl';
        const chk = document.createElement('input');
        chk.type = 'checkbox'; chk.checked = checked; chk.id = id;
        lbl.append(chk, document.createTextNode(text));
        return { lbl, chk };
    };

    const { lbl: plLbl, chk: plChk } = createCheck(t('playlist'), false, 'ytdlm-pl');
    const { lbl: autoLbl, chk: autoChk } = createCheck(t('auto_open'), true, 'ytdlm-auto');
    autoLbl.style.fontSize = '11px'; autoLbl.style.color = 'var(--ytdlm-dim)'; autoLbl.style.gridColumn = 'span 2';

    optionsGrid.append(plLbl, autoLbl);

    const btnRow = document.createElement('div');
    btnRow.className = 'ytdlm-btn-row';
    const btnStart = document.createElement('button');
    btnStart.className = 'yt-dlm-btn-primary';
    btnStart.innerText = t('download');
    const btnCancel = document.createElement('button');
    btnCancel.className = 'yt-dlm-btn-secondary';
    btnCancel.innerText = t('close');
    btnRow.append(btnStart, btnCancel);

    const progCont = document.createElement('div');
    progCont.className = 'ytdlm-prog-cont';
    progCont.dataset.display = 'flex';
    const progInfo = document.createElement('div');
    progInfo.className = 'ytdlm-prog-info';
    const progPct = document.createElement('span');
    const progSpeed = document.createElement('span');
    progInfo.append(progPct, progSpeed);
    const progOuter = document.createElement('div');
    progOuter.className = 'ytdlm-prog-outer';
    const progBar = document.createElement('div');
    progBar.className = 'yt-dlm-progress-bar';
    progOuter.appendChild(progBar);
    progCont.append(progInfo, progOuter);

    // Trimming UI
    const trimGrid = document.createElement('div');
    trimGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 5px;';
    
    const createTimeInput = (labelPlaceholder, id) => {
        const inp = document.createElement('input');
        inp.className = 'yt-dlm-input-small';
        inp.placeholder = labelPlaceholder;
        inp.title = 'HH:MM:SS or SS';
        inp.id = id;
        return inp;
    };

    const startTimeInp = createTimeInput(t('start_time'), 'ytdlm-start');
    const endTimeInp = createTimeInput(t('end_time'), 'ytdlm-end');
    trimGrid.append(startTimeInp, endTimeInp);

    popup.append(titleDiv, infoSection, qualitySelect, trimGrid, optionsGrid, btnRow, progCont);
    document.body.appendChild(popup);

    // Logic
    let pollTimer = null;
    let lastUrl = null;
    let targetDownloadUrl = window.location.href;

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
        setVisible(btn, true);
        btn.style.top = Math.round(rect.top + 15) + 'px';
        btn.style.left = Math.round(rect.left + (rect.width / 2) - 50) + 'px';
        btn.style.zIndex = '9999999';

        const url = window.location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            plChk.checked = url.includes('&list=');
        }
    }

    setInterval(updatePosition, 150);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, { passive: true });

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

    btnStart.onclick = async () => {
        btnStart.disabled = true;
        btnStart.innerText = t('processing');

        try {
            const res = await bgFetch(`http://localhost:3000/api/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: targetDownloadUrl,
                    title: currentVideoInfo ? currentVideoInfo.title : (document.title || 'Video Media').replace(' - YouTube', ''),
                    quality: qualitySelect.value,
                    isPlaylist: plChk.checked,
                    autoOpen: autoChk.checked,
                    startTime: startTimeInp.value.trim() || null,
                    endTime: endTimeInp.value.trim() || null
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
    };
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
