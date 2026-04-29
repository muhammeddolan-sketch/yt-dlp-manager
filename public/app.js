// UniGet Pro v1.5.1 - Core Application Logic
window.addEventListener('load', () => {
    const socket = typeof io !== 'undefined' ? io({ transports: ['websocket'] }) : null;
    const urlInput = document.getElementById('urlInput');
    const addBtn = document.getElementById('addBtn');
    const downloadList = document.getElementById('downloadList');
    const infoModal = document.getElementById('infoModal');
    const closeModal = document.querySelector('.close-modal');
    const confirmDownload = document.getElementById('confirmDownload');
    const qualityOption = document.getElementById('qualityOption');
    const isPlaylistCheck = document.getElementById('isPlaylistCheck');
    const modalPlaylistCheck = document.getElementById('modalPlaylistCheck');
    const modalAutoOpenCheck = document.getElementById('modalAutoOpenCheck');
    const openFolderGlobal = document.getElementById('openFolderGlobal') || document.getElementById('openFolderBtn');
    const clearCompletedBtn = document.getElementById('clearCompletedBtn') || document.getElementById('clearListBtn');
    const navItems = document.querySelectorAll('.nav-item[data-view], .sidebar-item[data-view]');
    const langSelect = document.getElementById('langSelect');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.querySelector('.close-settings');
    const powerModeSelect = document.getElementById('powerModeSelect');
    const rateLimitInput = document.getElementById('rateLimitInput');
    const smartRetryCheck = document.getElementById('smartRetryCheck');
    const lowNoiseNotificationCheck = document.getElementById('lowNoiseNotificationCheck');
    const profileOption = document.getElementById('profileOption');
    const setupModal = document.getElementById('setupModal');
    const openSetupBtn = document.getElementById('openSetupBtn');
    const closeSetup = document.querySelector('.close-setup');
    const closeSetupBtn = document.getElementById('closeSetupBtn');

    let currentVideoInfo = null;
    let activeDownloads = {};
    let currentView = 'all';
    let activeDetailsId = null;
    let lastNotifyById = {};

    // Theme Initialization
    const savedTheme = localStorage.getItem('uniget_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
        themeToggleBtn.innerHTML = savedTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        themeToggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const nextTheme = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', nextTheme);
            localStorage.setItem('uniget_theme', nextTheme);
            themeToggleBtn.innerHTML = nextTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            if (activeDetailsId && activeDownloads[activeDetailsId]) drawChart(activeDownloads[activeDetailsId]);
        });
    }

    // Language Initialization
    if (langSelect) {
        if (typeof currentLang !== 'undefined') langSelect.value = currentLang;
        langSelect.addEventListener('change', (e) => {
            if (typeof setLanguage === 'function') setLanguage(e.target.value);
        });
        
        window.onLangChange = (lang) => {
            try {
                const { ipcRenderer } = require('electron');
                if (ipcRenderer) ipcRenderer.send('change-lang', lang);
            } catch(e) { /* Non-Electron environment */ }
        };
        
        if (typeof updateUI === 'function') updateUI(); 
    }

    // Autostart Status
    const autostartCheck = document.getElementById('autostartCheck');
    if (autostartCheck) {
        fetch('/api/autostart/status').then(r => r.json()).then(data => {
            autostartCheck.checked = data.enabled;
        }).catch(e => console.warn('Autostart error:', e));

        autostartCheck.addEventListener('change', async () => {
            await fetch('/api/autostart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: autostartCheck.checked })
            }).catch(e => console.error(e));
        });
    }

    // Download Directory Settings
    const downloadDirInput = document.getElementById('downloadDirInput');
    const saveDirBtn = document.getElementById('saveDirBtn');
    const selectDirBtn = document.getElementById('selectDirBtn');

    if (downloadDirInput && saveDirBtn) {
        fetch('/api/settings').then(r => r.json()).then(data => {
            if (data.downloadDir) downloadDirInput.value = data.downloadDir;
            if (powerModeSelect && data.powerMode) powerModeSelect.value = data.powerMode;
            if (rateLimitInput && typeof data.rateLimitKbps !== 'undefined') rateLimitInput.value = data.rateLimitKbps;
            if (smartRetryCheck) smartRetryCheck.checked = data.smartRetry !== false;
            if (lowNoiseNotificationCheck) lowNoiseNotificationCheck.checked = data.lowNoiseNotifications !== false;
        });

        if (selectDirBtn) {
            selectDirBtn.addEventListener('click', async () => {
                try {
                    const { ipcRenderer } = require('electron');
                    const selectedPath = await ipcRenderer.invoke('select-folder');
                    if (selectedPath) {
                        downloadDirInput.value = selectedPath;
                        saveDirBtn.style.display = 'block';
                    }
                } catch (e) { console.error('Folder selection error:', e); }
            });
        }

        downloadDirInput.addEventListener('input', () => {
            saveDirBtn.style.display = 'block';
        });

        saveDirBtn.addEventListener('click', async () => {
            saveDirBtn.disabled = true;
            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        downloadDir: downloadDirInput.value.trim(),
                        powerMode: powerModeSelect ? powerModeSelect.value : 'auto',
                        rateLimitKbps: rateLimitInput ? Number(rateLimitInput.value || 0) : 0,
                        smartRetry: smartRetryCheck ? smartRetryCheck.checked : true,
                        lowNoiseNotifications: lowNoiseNotificationCheck ? lowNoiseNotificationCheck.checked : true
                    })
                });
                const data = await res.json();
                if (data.success) {
                    saveDirBtn.style.display = 'none';
                }
            } catch (e) {
                console.error('Settings save error:', e);
            } finally {
                saveDirBtn.disabled = false;
            }
        });

        [powerModeSelect, rateLimitInput, smartRetryCheck, lowNoiseNotificationCheck].forEach((el) => {
            if (!el) return;
            el.addEventListener('change', () => {
                saveDirBtn.style.display = 'block';
            });
        });
    }

    // Modal Controls
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            if (infoModal) infoModal.style.display = 'none';
        });
    }

    // Details Modal
    const detailsModal = document.getElementById('detailsModal');
    const closeDetails = document.querySelector('.close-details');
    if (closeDetails) {
        closeDetails.addEventListener('click', () => {
            if (detailsModal) detailsModal.style.display = 'none';
            activeDetailsId = null;
        });
    }
    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener('click', () => {
            settingsModal.style.display = 'flex';
        });
    }
    if (closeSettings && settingsModal) {
        closeSettings.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }
    if (openSetupBtn && setupModal) {
        openSetupBtn.addEventListener('click', () => {
            setupModal.style.display = 'flex';
        });
    }
    if (closeSetup && setupModal) {
        closeSetup.addEventListener('click', () => {
            setupModal.style.display = 'none';
        });
    }
    if (closeSetupBtn && setupModal) {
        closeSetupBtn.addEventListener('click', () => {
            setupModal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target == detailsModal) {
            detailsModal.style.display = 'none';
            activeDetailsId = null;
        }
        if (e.target == infoModal) {
            infoModal.style.display = 'none';
        }
        if (e.target == settingsModal) {
            settingsModal.style.display = 'none';
        }
        if (e.target == setupModal) {
            setupModal.style.display = 'none';
        }
    });

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            currentView = item.getAttribute('data-view');
            renderList();
        });
    });

    // Global Actions
    if (openFolderGlobal) {
        openFolderGlobal.addEventListener('click', () => {
            fetch('/api/open-folder', { method: 'POST' }).catch(e => console.error(e));
        });
    }

    if (clearCompletedBtn) {
        clearCompletedBtn.addEventListener('click', () => {
            fetch('/api/clear-completed', { method: 'POST' }).catch(e => console.error(e));
        });
    }

    // Event Delegation for action buttons to avoid performance issues
    if (downloadList) {
        downloadList.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-icon');
            if (!btn) return;
            const card = e.target.closest('.download-card');
            if (!card) return;
            const dlId = card.id.replace('dl-', '');

            if (btn.classList.contains('pause-btn')) {
                fetch('/api/action', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: dlId, action: 'pause'}) });
            } else if (btn.classList.contains('resume-btn')) {
                fetch('/api/action', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: dlId, action: 'resume'}) });
            } else if (btn.classList.contains('details-btn')) {
                activeDetailsId = dlId;
                if (detailsModal) detailsModal.style.display = 'block';
                if (activeDownloads[dlId]) updateDetailsModal(activeDownloads[dlId]);
            } else if (btn.classList.contains('open-btn')) {
                fetch('/api/open-folder', { method: 'POST' });
            }
        });
    }

    // Network request deduplication cache
    let isFetchingInfo = false;

    // Main Download Trigger
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const url = urlInput ? urlInput.value.trim() : '';
            if (!url || isFetchingInfo) return;

            isFetchingInfo = true;
            addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                
                const res = await fetch('/api/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                const info = await res.json();
                if (info.error) throw new Error(info.error);
                
                const isQuickMode = localStorage.getItem('uniget_quick_mode') === 'true';
                if (isQuickMode) {
                    const selectedQuality = localStorage.getItem('uniget_last_quality') || 'best';
                    const battery = navigator.getBattery ? await navigator.getBattery().catch(() => null) : null;
                    const isOnBattery = battery ? !battery.charging : false;
                    
                    await fetch('/api/download', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            url: info.url,
                            title: info.title,
                            quality: selectedQuality,
                            isPlaylist: isPlaylistCheck ? isPlaylistCheck.checked : false,
                            autoOpen: localStorage.getItem('uniget_auto_open') === 'true',
                            startTime: null,
                            endTime: null,
                            isOnBattery,
                            profile: 'custom'
                        })
                    });
                    if (urlInput) urlInput.value = '';
                } else {
                    currentVideoInfo = { ...info, url };
                    if (modalPlaylistCheck && isPlaylistCheck) modalPlaylistCheck.checked = isPlaylistCheck.checked;
                    showModal(info);
                }
            } catch (e) {
                const errMsg = e.name === 'AbortError' ? 'Timeout fetching video info' : e.message;
                alert((typeof t === 'function' ? t('error') : 'Error') + ': ' + errMsg);
            } finally {
                isFetchingInfo = false;
                addBtn.innerHTML = '<i class="fas fa-plus"></i>';
            }
        });
    }

    // Confirm Download in Modal
    if (confirmDownload) {
        confirmDownload.addEventListener('click', async () => {
            if (!currentVideoInfo) return;

            try {
                const battery = (navigator.getBattery ? await navigator.getBattery().catch(() => null) : null);
                const isOnBattery = battery ? !battery.charging : false;
                const selectedProfile = profileOption ? profileOption.value : 'custom';
                let selectedQuality = qualityOption ? qualityOption.value : 'best';
                if (selectedProfile === 'fast_720') selectedQuality = '720';
                if (selectedProfile === 'archive_1080') selectedQuality = '1080';
                if (selectedProfile === 'podcast_audio') selectedQuality = 'audio';

                await fetch('/api/download', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        url: currentVideoInfo.url,
                        title: currentVideoInfo.title,
                        quality: selectedQuality,
                        isPlaylist: modalPlaylistCheck ? modalPlaylistCheck.checked : (isPlaylistCheck ? isPlaylistCheck.checked : false),
                        autoOpen: modalAutoOpenCheck ? modalAutoOpenCheck.checked : true,
                        startTime: document.getElementById('modalStartTime') ? document.getElementById('modalStartTime').value.trim() : null,
                        endTime: document.getElementById('modalEndTime') ? document.getElementById('modalEndTime').value.trim() : null,
                        isOnBattery,
                        profile: selectedProfile
                    })
                });
                
                if (qualityOption) localStorage.setItem('uniget_last_quality', selectedQuality);
                if (modalAutoOpenCheck) localStorage.setItem('uniget_auto_open', modalAutoOpenCheck.checked);
                
                if (infoModal) infoModal.style.display = 'none';
                if (urlInput) urlInput.value = '';
            } catch(e) {
                console.error('Download Trigger Error:', e);
            }
        });
    }

    // Socket.IO Events
    if (socket) {
        console.log('Socket initialized.');
        socket.on('initial-state', (data) => {
            activeDownloads = data;
            renderList();
        });

        socket.on('progress', (data) => {
            if (!activeDownloads[data.id]) activeDownloads[data.id] = data;
            else Object.assign(activeDownloads[data.id], data);
            
            let dl = activeDownloads[data.id];
            if (!dl.speedHistory) dl.speedHistory = [];
            
            let val = 0;
            if (data.speed && typeof data.speed === 'string') {
                val = parseFloat(data.speed) || 0;
                if (data.speed.includes('MiB/s')) val *= 1024;
                if (data.speed.includes('GiB/s')) val *= 1024 * 1024;
            }
            dl.speedHistory.push(val);
            if (dl.speedHistory.length > 70) dl.speedHistory.shift();

            // Optimised DOM updates using requestAnimationFrame
            window.requestAnimationFrame(() => {
                updateCard(dl);
                if (activeDetailsId === dl.id) updateDetailsModal(dl);
                maybeNotify(dl);
            });
        });
    }

    function maybeNotify(dl) {
        if (!lowNoiseNotificationCheck || !lowNoiseNotificationCheck.checked) return;
        const status = dl.status;
        if (!['completed', 'failed'].includes(status) && !(String(status).toLowerCase().includes('hata'))) return;
        const cacheKey = `${dl.id}:${status}`;
        if (lastNotifyById[cacheKey]) return;
        lastNotifyById[cacheKey] = true;
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                new Notification(`UniGet - ${status}`, { body: dl.title || 'Download task' });
                return;
            }
            if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((perm) => {
                    if (perm === 'granted') new Notification(`UniGet - ${status}`, { body: dl.title || 'Download task' });
                }).catch(() => {});
            }
        }
    }

    function showModal(info) {
        if (!infoModal) return;
        const thumb = document.getElementById('modalThumbnail');
        const title = document.getElementById('modalTitle');
        const uploader = document.getElementById('modalUploader');
        const duration = document.getElementById('modalDuration');
        
        if (thumb) thumb.src = info.thumbnail || 'icon.png';
        if (title) title.innerText = info.title;
        if (uploader) uploader.innerText = info.uploader || (typeof t === 'function' ? t('loading') : 'Loading...');
        if (duration) duration.innerText = (typeof t === 'function' ? t('duration') : 'Duration') + ': ' + (info.duration || '--:--');
        
        const lastQual = localStorage.getItem('uniget_last_quality');
        if (lastQual && qualityOption) qualityOption.value = lastQual;
        
        const autoOpen = localStorage.getItem('uniget_auto_open') === 'true';
        if (modalAutoOpenCheck) modalAutoOpenCheck.checked = autoOpen;

        // Clear trim inputs
        const startInp = document.getElementById('modalStartTime');
        const endInp = document.getElementById('modalEndTime');
        if (startInp) startInp.value = '';
        if (endInp) endInp.value = '';

        infoModal.style.display = 'block';
    }

    function renderList() {
        if (!downloadList) return;
        let dlArray = Object.values(activeDownloads).reverse();
        
        dlArray = dlArray.filter(dl => {
            if (currentView === 'all') return true;
            if (currentView === 'completed') return dl.status === 'completed';
            if (currentView === 'downloading') {
                return dl.status !== 'completed' && !dl.status.toLowerCase().includes('hata') && dl.status !== 'failed';
            }
            return true;
        });

        if (dlArray.length === 0) {
            downloadList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-cloud-download-alt"></i>
                    <p>${typeof t === 'function' ? t('no_downloads') : 'No downloads yet.'}</p>
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();
        downloadList.innerHTML = '';
        dlArray.forEach(dl => {
            fragment.appendChild(createCard(dl));
        });
        downloadList.appendChild(fragment);
    }

    function updateCard(dl) {
        let card = document.getElementById(`dl-${dl.id}`);
        if (!card) {
            const emptyState = downloadList.querySelector('.empty-state');
            if (emptyState) emptyState.remove();
            card = createCard(dl);
            downloadList.prepend(card);
            return;
        }

        const progressBar = card.querySelector('.progress-bar');
        const meta = card.querySelector('.card-meta');
        const icon = card.querySelector('.card-icon i');
        const actions = card.querySelector('.card-actions');

        if (progressBar) progressBar.style.width = `${dl.progress || 0}%`;
        let statusText = dl.status === 'completed' ? (typeof t === 'function' ? t('completed_status') : 'Completed') : (dl.status === 'paused' ? (typeof t === 'function' ? t('paused_status') : 'Paused') : dl.status);

        if (meta) {
            meta.innerHTML = `
                <span><i class="fas fa-percent"></i> ${dl.progress || 0}%</span>
                <span><i class="fas fa-tachometer-alt"></i> ${dl.speed || '--'}</span>
                <span><i class="fas fa-clock"></i> ${dl.eta || '--:--'}</span>
                <span class="status-badge" style="text-transform: capitalize;">${statusText}</span>
            `;
        }

        card.classList.remove('completed', 'failed', 'paused', 'downloading');
        if (icon) {
            if (dl.status === 'completed') {
                icon.className = 'fas fa-check';
                card.classList.add('completed');
            } else if (dl.status.toLowerCase().includes('hata') || dl.status === 'failed') {
                icon.className = 'fas fa-exclamation-triangle';
                card.classList.add('failed');
            } else if (dl.status === 'paused') {
                icon.className = 'fas fa-pause';
                card.classList.add('paused');
            } else {
                icon.className = 'fas fa-arrow-down';
                card.classList.add('downloading');
            }
        }

        if (actions) {
            const isDownloading = ['downloading', 'starting', 'queued'].includes(dl.status);
            const isPausedOrFailed = ['paused', 'failed'].includes(dl.status);
            
            let actionButtons = '';
            if (isDownloading) {
                actionButtons += `<button class="btn-icon pause-btn" title="${typeof t === 'function' ? t('pause') : 'Pause'}"><i class="fas fa-pause"></i></button>`;
            } else if (isPausedOrFailed) {
                actionButtons += `<button class="btn-icon resume-btn" title="${typeof t === 'function' ? t('resume') : 'Resume'}"><i class="fas fa-play"></i></button>`;
            }
            actionButtons += `<button class="btn-icon details-btn" title="${typeof t === 'function' ? t('details_btn') : 'Details'}"><i class="fas fa-chart-line"></i></button>`;
            actionButtons += `<button class="btn-icon open-btn" title="${typeof t === 'function' ? t('open_folder') : 'Open'}"><i class="fas fa-folder-open"></i></button>`;
            
            if (actions.innerHTML !== actionButtons) {
                actions.innerHTML = actionButtons;
            }
        }
    }

    function updateDetailsModal(dl) {
        const title = document.getElementById('detailsTitle');
        const speed = document.getElementById('detailsSpeed');
        const eta = document.getElementById('detailsEta');
        const prog = document.getElementById('detailsProg');
        
        if (title) title.innerText = dl.title;
        if (speed) speed.innerText = dl.speed || '--';
        if (eta) eta.innerText = dl.eta || '--:--';
        if (prog) prog.innerText = `%${dl.progress || 0}`;
        
        window.requestAnimationFrame(() => drawChart(dl));
    }

    let chartCtx = null;
    let chartCanvas = null;

    function drawChart(dl) {
        if (!chartCanvas) {
            chartCanvas = document.getElementById('speedChart');
            if (!chartCanvas) return;
            chartCtx = chartCanvas.getContext('2d', { alpha: false });
        }
        
        if (chartCanvas.width !== chartCanvas.clientWidth) chartCanvas.width = chartCanvas.clientWidth;
        if (chartCanvas.height !== chartCanvas.clientHeight) chartCanvas.height = chartCanvas.clientHeight;
        
        const w = chartCanvas.width;
        const h = chartCanvas.height;
        
        const bgCol = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-bg').trim() || '#f4f4f5';
        chartCtx.fillStyle = bgCol;
        chartCtx.fillRect(0, 0, w, h);
        
        const history = dl.speedHistory || [];
        if (history.length < 2) return;
        
        const maxSpeed = Math.max(...history, 100); 
        chartCtx.beginPath();
        chartCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim() || '#18181b';
        chartCtx.lineWidth = 2;
        chartCtx.lineJoin = 'round';
        const step = w / 70; 
        for (let i = 0; i < history.length; i++) {
            const x = i * step;
            const y = h - (history[i] / maxSpeed) * h * 0.9; 
            if (i === 0) chartCtx.moveTo(x, y);
            else chartCtx.lineTo(x, y);
        }
        chartCtx.stroke();
    }

    function createCard(dl) {
        const card = document.createElement('div');
        card.className = 'download-card';
        card.id = `dl-${dl.id}`;
        card.innerHTML = `
            <div class="card-icon"><i class="fas fa-arrow-down"></i></div>
            <div class="card-details">
                <div class="card-title" title="${dl.title}">${(typeof t === 'function' ? (t(dl.title) || dl.title) : dl.title)} ${dl.isPlaylist ? ' [' + (typeof t === 'function' ? t('playlist') : 'PL') + ']' : ''}</div>
                <div class="progress-container">
                    <div class="progress-bar" style="width: 0%"></div>
                </div>
                <div class="card-meta"></div>
            </div>
            <div class="card-actions" style="display:flex; gap: 5px;"></div>
        `;
        window.requestAnimationFrame(() => updateCard(dl));
        return card;
    }

    // Electron Clipboard Integration
    let electronClipboard = null;
    try {
        const { clipboard } = require('electron');
        if (clipboard) electronClipboard = clipboard;
    } catch (e) {}

    let lastClipboardText = '';
    if (electronClipboard) {
        setInterval(() => {
            if (document.hidden) return;
            try {
                const text = electronClipboard.readText().trim();
                if (text && text !== lastClipboardText && (text.includes('youtube.com/') || text.includes('youtu.be/'))) {
                    lastClipboardText = text;
                    if (urlInput) urlInput.value = text;
                    if (addBtn) addBtn.click();
                }
            } catch (e) {}
        }, 3000);
    }

    // Final Support Button
    const donateBtn = document.getElementById('donateBtn');
    if (donateBtn) {
        donateBtn.addEventListener('click', () => {
            const url = 'https://donate.bynogame.com/muhammeddolan';
            try {
                require('electron').shell.openExternal(url);
            } catch(e) {
                window.open(url, '_blank');
            }
        });
    }

    // Pin Window (Always on Top)
    const pinWindowBtn = document.getElementById('pinWindowBtn');
    let isAlwaysOnTop = false;
    if (pinWindowBtn) {
        pinWindowBtn.addEventListener('click', () => {
            isAlwaysOnTop = !isAlwaysOnTop;
            pinWindowBtn.classList.toggle('pinned', isAlwaysOnTop);
            try {
                require('electron').ipcRenderer.send('toggle-always-on-top', isAlwaysOnTop);
            } catch(e) {}
        });
    }

    // Quick Download Mode
    const quickDownloadCheck = document.getElementById('quickDownloadCheck');
    let isQuickMode = localStorage.getItem('uniget_quick_mode') === 'true';
    if (quickDownloadCheck) {
        quickDownloadCheck.checked = isQuickMode;
        quickDownloadCheck.addEventListener('change', (e) => {
            isQuickMode = e.target.checked;
            localStorage.setItem('uniget_quick_mode', isQuickMode);
        });
    }

    // Install UserScript (Tampermonkey)
    const installUserScriptBtn = document.getElementById('installUserScriptBtn');
    if (installUserScriptBtn) {
        installUserScriptBtn.addEventListener('click', () => {
            const scriptUrl = 'http://localhost:3000/uniget-extension.user.js';
            try {
                require('electron').shell.openExternal(scriptUrl);
            } catch(e) {
                window.open(scriptUrl, '_blank');
            }
            if (setupModal) setupModal.style.display = 'none';
        });
    }

    // Onboarding
    const onboardingModal = document.getElementById('onboardingModal');
    const finishOnboardingBtn = document.getElementById('finishOnboardingBtn');
    if (!localStorage.getItem('uniget_onboarded')) {
        if (onboardingModal) onboardingModal.style.display = 'flex';
    }
    if (finishOnboardingBtn) {
        finishOnboardingBtn.addEventListener('click', () => {
            localStorage.setItem('uniget_onboarded', 'true');
            if (onboardingModal) onboardingModal.style.display = 'none';
        });
    }

    // Drag & Drop Handling
    const dragOverlay = document.getElementById('dragOverlay');
    let dragCounter = 0;
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragOverlay) dragOverlay.classList.add('active');
    });
    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0 && dragOverlay) dragOverlay.classList.remove('active');
    });
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (dragOverlay) dragOverlay.classList.remove('active');
        
        const url = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
        if (url && (url.includes('http://') || url.includes('https://'))) {
            if (urlInput) urlInput.value = url;
            if (addBtn) addBtn.click();
        }
    });

    // Extension Detection
    setInterval(() => {
        const isExtensionActive = document.body.dataset.ytdlmExtension === "active";
        if (openSetupBtn) {
            if (isExtensionActive) {
                openSetupBtn.style.color = "var(--text-dim)";
                openSetupBtn.title = "Eklenti Aktif";
            } else {
                openSetupBtn.style.color = "var(--accent)";
                openSetupBtn.title = "Eklenti Kurulu Değil";
            }
        }
    }, 2000);
});
