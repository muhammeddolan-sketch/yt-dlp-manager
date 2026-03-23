// YT-DLM Pro v1.4.6 - Core Application Logic
window.addEventListener('load', () => {
    const socket = typeof io !== 'undefined' ? io() : null;
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

    let currentVideoInfo = null;
    let activeDownloads = {};
    let currentView = 'all';
    let activeDetailsId = null;

    // Theme Initialization
    const savedTheme = localStorage.getItem('ytdlm_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
        themeToggleBtn.innerHTML = savedTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        themeToggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const nextTheme = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', nextTheme);
            localStorage.setItem('ytdlm_theme', nextTheme);
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
                    body: JSON.stringify({ downloadDir: downloadDirInput.value.trim() })
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

    window.addEventListener('click', (e) => {
        if (e.target == detailsModal) {
            detailsModal.style.display = 'none';
            activeDetailsId = null;
        }
        if (e.target == infoModal) {
            infoModal.style.display = 'none';
        }
    });

    // Sidebar Navigation
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

    // Main Download Trigger
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const url = urlInput ? urlInput.value.trim() : '';
            if (!url) return;

            addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                const res = await fetch('/api/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                const info = await res.json();
                if (info.error) throw new Error(info.error);
                
                currentVideoInfo = { ...info, url };
                if (modalPlaylistCheck && isPlaylistCheck) modalPlaylistCheck.checked = isPlaylistCheck.checked;
                showModal(info);
            } catch (e) {
                alert((typeof t === 'function' ? t('error') : 'Error') + ': ' + e.message);
            } finally {
                addBtn.innerHTML = '<i class="fas fa-plus"></i>';
            }
        });
    }

    // Confirm Download in Modal
    if (confirmDownload) {
        confirmDownload.addEventListener('click', async () => {
            if (!currentVideoInfo) return;

            try {
                await fetch('/api/download', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        url: currentVideoInfo.url,
                        title: currentVideoInfo.title,
                        quality: qualityOption ? qualityOption.value : 'best',
                        isPlaylist: modalPlaylistCheck ? modalPlaylistCheck.checked : (isPlaylistCheck ? isPlaylistCheck.checked : false),
                        autoOpen: modalAutoOpenCheck ? modalAutoOpenCheck.checked : true,
                        startTime: document.getElementById('modalStartTime') ? document.getElementById('modalStartTime').value.trim() : null,
                        endTime: document.getElementById('modalEndTime') ? document.getElementById('modalEndTime').value.trim() : null
                    })
                });
                
                if (qualityOption) localStorage.setItem('yt_dlm_last_quality', qualityOption.value);
                if (modalAutoOpenCheck) localStorage.setItem('yt_dlm_auto_open', modalAutoOpenCheck.checked);
                
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

            updateCard(dl);
            if (activeDetailsId === dl.id) updateDetailsModal(dl);
        });
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
        
        const lastQual = localStorage.getItem('yt_dlm_last_quality');
        if (lastQual && qualityOption) qualityOption.value = lastQual;
        
        const autoOpen = localStorage.getItem('yt_dlm_auto_open') === 'true';
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

        downloadList.innerHTML = '';
        dlArray.forEach(dl => {
            downloadList.appendChild(createCard(dl));
        });
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
            let actionButtons = '';
            if (dl.status === 'downloading' || dl.status === 'starting') {
                actionButtons += `<button class="btn-icon pause-btn" title="${typeof t === 'function' ? t('pause') : 'Pause'}"><i class="fas fa-pause"></i></button>`;
            } else if (dl.status === 'paused' || dl.status === 'failed') {
                actionButtons += `<button class="btn-icon resume-btn" title="${typeof t === 'function' ? t('resume') : 'Resume'}"><i class="fas fa-play"></i></button>`;
            }
            actionButtons += `<button class="btn-icon details-btn" title="${typeof t === 'function' ? t('details_btn') : 'Details'}"><i class="fas fa-chart-line"></i></button>`;
            actionButtons += `<button class="btn-icon open-btn" title="${typeof t === 'function' ? t('open_folder') : 'Open'}"><i class="fas fa-folder-open"></i></button>`;
            
            actions.innerHTML = actionButtons;

            const pb = actions.querySelector('.pause-btn');
            if (pb) pb.addEventListener('click', () => fetch('/api/action', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: dl.id, action: 'pause'}) }));

            const rb = actions.querySelector('.resume-btn');
            if (rb) rb.addEventListener('click', () => fetch('/api/action', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: dl.id, action: 'resume'}) }));
            
            const db = actions.querySelector('.details-btn');
            if (db) db.addEventListener('click', () => {
                activeDetailsId = dl.id;
                if (detailsModal) detailsModal.style.display = 'block';
                updateDetailsModal(dl);
            });

            const ob = actions.querySelector('.open-btn');
            if (ob) ob.addEventListener('click', () => fetch('/api/open-folder', { method: 'POST' }));
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
        drawChart(dl);
    }

    function drawChart(dl) {
        const canvas = document.getElementById('speedChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        if (canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;
        if (canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight;
        
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        
        const history = dl.speedHistory || [];
        if (history.length < 2) return;
        
        const maxSpeed = Math.max(...history, 100); 
        ctx.beginPath();
        const accentCol = getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim() || '#18181b';
        ctx.strokeStyle = accentCol; 
        ctx.lineWidth = 2;
        ctx.moveTo(0, h);
        const step = w / 70; 
        for (let i = 0; i < history.length; i++) {
            const val = history[i];
            const x = i * step;
            const y = h - (val / maxSpeed) * h * 0.9; 
            ctx.lineTo(x, y);
        }
        ctx.stroke();
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
        setTimeout(() => updateCard(dl), 10);
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
            try {
                const text = electronClipboard.readText().trim();
                if (text && text !== lastClipboardText && (text.includes('youtube.com/') || text.includes('youtu.be/'))) {
                    lastClipboardText = text;
                    if (urlInput) urlInput.value = text;
                    if (addBtn) addBtn.click();
                }
            } catch (e) {}
        }, 800);
    }

    // Final Support Button
    const donateBtn = document.getElementById('donateBtn');
    if (donateBtn) {
        donateBtn.addEventListener('click', () => {
            try {
                require('electron').shell.openExternal('https://github.com/sponsors');
            } catch(e) {
                alert(typeof t === 'function' ? t('donate_msg') : 'Support our project!');
            }
        });
    }
});
