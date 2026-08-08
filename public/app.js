// UniGet Pro - Core Application Logic
window.addEventListener('load', () => {
    const socket = typeof io !== 'undefined' ? io({ transports: ['websocket', 'polling'] }) : null;
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
    const soundEffectsCheck = document.getElementById('soundEffectsCheck');
    const useBrowserCookiesCheck = document.getElementById('useBrowserCookiesCheck');
    const cookiesBrowserSelect = document.getElementById('cookiesBrowserSelect');
    const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
    const updateStatus = document.getElementById('updateStatus');
    const profileOption = document.getElementById('profileOption');
    const setupModal = document.getElementById('setupModal');
    const openSetupBtn = document.getElementById('openSetupBtn');
    const closeSetup = document.querySelector('.close-setup');
    const closeSetupBtn = document.getElementById('closeSetupBtn');
    const toolStatus = document.getElementById('toolStatus');
    const installFfmpegBtn = document.getElementById('installFfmpegBtn');
    const firefoxAddonBtn = document.getElementById('firefoxAddonBtn');
    const chromePackageBtn = document.getElementById('chromePackageBtn');

    let currentVideoInfo = null;
    let activeDownloads = {};
    let currentView = 'all';
    let searchQuery = '';
    let activeDetailsId = null;
    let lastNotifyById = {};
    const apiJsonHeaders = { 'Content-Type': 'application/json', 'X-UniGet-Client': 'desktop' };
    const apiClientHeaders = { 'X-UniGet-Client': 'desktop' };
    const firefoxAddonUrl = 'https://addons.mozilla.org/tr/firefox/addon/yt-dlm-web-helper/';
    const chromePackageUrl = `${window.location.origin}/extension/chrome-package`;
    let audioContext = null;
    let soundEnabled = localStorage.getItem('uniget_sound_effects') !== 'false';

    async function syncVisibleAppVersion() {
        try {
            const res = await fetch('/api/health', { headers: apiClientHeaders });
            if (!res.ok) return;
            const data = await res.json();
            if (!data.version) return;
            document.querySelectorAll('.version').forEach((el) => {
                el.textContent = `v${data.version}`;
            });
        } catch(e) {}
    }

    syncVisibleAppVersion();

    if (soundEffectsCheck) {
        soundEffectsCheck.checked = soundEnabled;
        soundEffectsCheck.addEventListener('change', () => {
            soundEnabled = soundEffectsCheck.checked;
            localStorage.setItem('uniget_sound_effects', String(soundEnabled));
            if (soundEnabled) playSound('toggle');
        });
    }

    function getAudioContext() {
        if (!soundEnabled || !window.AudioContext && !window.webkitAudioContext) return null;
        if (!audioContext) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioCtx();
        }
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        return audioContext;
    }

    function playTone(ctx, start, freq, duration, volume, type = 'sine') {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
    }

    function playSound(name) {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const sounds = {
            tap: [[0, 520, 0.045, 0.018, 'sine']],
            toggle: [[0, 420, 0.045, 0.018, 'sine'], [0.045, 560, 0.055, 0.016, 'sine']],
            open: [[0, 460, 0.05, 0.017, 'triangle'], [0.05, 620, 0.06, 0.014, 'triangle']],
            start: [[0, 360, 0.055, 0.018, 'triangle'], [0.06, 520, 0.075, 0.018, 'triangle']],
            success: [[0, 480, 0.065, 0.018, 'sine'], [0.07, 640, 0.08, 0.018, 'sine'], [0.15, 820, 0.11, 0.014, 'sine']],
            error: [[0, 260, 0.085, 0.018, 'sawtooth'], [0.09, 180, 0.11, 0.014, 'sawtooth']]
        };
        (sounds[name] || sounds.tap).forEach(([offset, freq, duration, volume, type]) => {
            playTone(ctx, now + offset, freq, duration, volume, type);
        });
    }

    function openExternalUrl(url) {
        try {
            if (!window.unigetAPI || !window.unigetAPI.openExternal(url)) throw new Error('openExternal unavailable');
        } catch(e) {
            window.open(url, '_blank');
        }
    }

    async function copyText(text) {
        const value = String(text || '').trim();
        if (!value) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch(e) {}
        try {
            const area = document.createElement('textarea');
            area.value = value;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok;
        } catch(e) {
            return false;
        }
    }

    document.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, .nav-item, select, input[type="checkbox"]')) {
            playSound('tap');
        }
    }, { passive: true });

    function mergeDownload(dl) {
        if (!dl || !dl.id) return;
        if (!activeDownloads[dl.id]) activeDownloads[dl.id] = dl;
        else Object.assign(activeDownloads[dl.id], dl);
        if (downloadMatchesCurrentView(activeDownloads[dl.id])) {
            updateCard(activeDownloads[dl.id]);
        } else {
            document.getElementById(`dl-${dl.id}`)?.remove();
            if (downloadList && !downloadList.querySelector('.download-card')) renderList();
        }
    }

    async function refreshDownloads() {
        try {
            const res = await fetch('/api/downloads', { headers: apiClientHeaders });
            if (!res.ok) return;
            activeDownloads = await res.json();
            renderList();
        } catch(e) {}
    }

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
                if (window.unigetAPI) window.unigetAPI.changeLang(lang);
            } catch(e) { /* Non-Electron environment */ }
        };
        
        if (typeof updateUI === 'function') updateUI(); 
    }

    // Autostart Status — prefer the Electron IPC bridge (works on Windows);
    // fall back to the Linux desktop-file API served by the backend.
    const autostartCheck = document.getElementById('autostartCheck');
    const useIpcAutostart = !!(window.unigetAPI && window.unigetAPI.getAutostart);
    if (autostartCheck && useIpcAutostart) {
        window.unigetAPI.getAutostart().then((data) => {
            autostartCheck.checked = !!(data && data.enabled);
            if (data && data.supported === false) {
                const row = autostartCheck.closest('.switch-container');
                if (row) row.style.opacity = '0.55';
            }
        }).catch(e => console.warn('Autostart error:', e));

        autostartCheck.addEventListener('change', async () => {
            try {
                await window.unigetAPI.setAutostart(autostartCheck.checked);
            } catch (e) {
                console.error(e);
            }
        });
    } else if (autostartCheck) {
        fetch('/api/autostart/status').then(r => r.json()).then(data => {
            autostartCheck.checked = data.enabled;
        }).catch(e => console.warn('Autostart error:', e));

        autostartCheck.addEventListener('change', async () => {
            await fetch('/api/autostart', {
                method: 'POST',
                headers: apiJsonHeaders,
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
            if (useBrowserCookiesCheck) useBrowserCookiesCheck.checked = data.useBrowserCookies === true;
            if (cookiesBrowserSelect && data.cookiesBrowser) cookiesBrowserSelect.value = data.cookiesBrowser;
        });

        refreshToolStatus();

        if (selectDirBtn) {
            selectDirBtn.addEventListener('click', async () => {
                try {
                    const selectedPath = window.unigetAPI ? await window.unigetAPI.selectFolder() : null;
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
                    headers: apiJsonHeaders,
                    body: JSON.stringify({
                        downloadDir: downloadDirInput.value.trim(),
                        powerMode: powerModeSelect ? powerModeSelect.value : 'auto',
                        rateLimitKbps: rateLimitInput ? Number(rateLimitInput.value || 0) : 0,
                        smartRetry: smartRetryCheck ? smartRetryCheck.checked : true,
                        lowNoiseNotifications: lowNoiseNotificationCheck ? lowNoiseNotificationCheck.checked : true,
                        useBrowserCookies: useBrowserCookiesCheck ? useBrowserCookiesCheck.checked : false,
                        cookiesBrowser: cookiesBrowserSelect ? cookiesBrowserSelect.value : 'chrome'
                    })
                });
                const data = await res.json();
                if (data.success) {
                    playSound('success');
                    saveDirBtn.textContent = '✓ Kaydedildi';
                    saveDirBtn.style.background = 'var(--success)';
                    saveDirBtn.style.color = '#fff';
                    setTimeout(() => {
                        saveDirBtn.style.display = 'none';
                        saveDirBtn.textContent = 'Kaydet';
                        saveDirBtn.style.background = '';
                        saveDirBtn.style.color = '';
                    }, 1500);
                }
            } catch (e) {
                playSound('error');
                console.error('Settings save error:', e);
            } finally {
                saveDirBtn.disabled = false;
            }
        });

        [powerModeSelect, rateLimitInput, smartRetryCheck, lowNoiseNotificationCheck, useBrowserCookiesCheck, cookiesBrowserSelect].forEach((el) => {
            if (!el) return;
            el.addEventListener('change', () => {
                saveDirBtn.style.display = 'block';
            });
        });
    }

    async function refreshToolStatus() {
        if (!toolStatus) return;
        try {
            const res = await fetch('/api/tools');
            const data = await res.json();
            const ffmpegReady = !!(data.ffmpeg && data.ffmpeg.available);
            toolStatus.textContent = ffmpegReady
                ? 'FFmpeg: hazir - yuksek kalite birlestirme acik'
                : 'FFmpeg: yok - tek dosya progressive mod kullaniliyor';
            if (installFfmpegBtn) installFfmpegBtn.hidden = ffmpegReady;
        } catch {
            toolStatus.textContent = 'Arac durumu okunamadi';
            if (installFfmpegBtn) installFfmpegBtn.hidden = true;
        }
    }

    if (installFfmpegBtn) {
        installFfmpegBtn.addEventListener('click', async () => {
            installFfmpegBtn.disabled = true;
            if (toolStatus) toolStatus.textContent = 'FFmpeg indiriliyor ve kuruluyor...';
            try {
                const res = await fetch('/api/tools/install-ffmpeg', {
                    method: 'POST',
                    headers: apiClientHeaders
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.error) throw new Error(data.error || 'FFmpeg kurulumu basarisiz');
                playSound('success');
                await refreshToolStatus();
            } catch (e) {
                playSound('error');
                if (toolStatus) toolStatus.textContent = `FFmpeg kurulumu basarisiz: ${e.message}`;
            } finally {
                installFfmpegBtn.disabled = false;
            }
        });
    }

    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', async () => {
            checkUpdatesBtn.disabled = true;
            if (updateStatus) updateStatus.textContent = 'Guncelleme kontrol ediliyor...';
            try {
                const res = await fetch('/api/update-check', { headers: apiClientHeaders });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error || 'Guncelleme kontrolu basarisiz');
                if (data.hasUpdate) {
                    if (updateStatus) updateStatus.textContent = `Yeni surum var: v${data.latestVersion}`;
                    openExternalUrl(data.url);
                } else if (updateStatus) {
                    updateStatus.textContent = `Guncel surumdesin: v${data.currentVersion}`;
                }
                playSound('success');
            } catch (e) {
                playSound('error');
                if (updateStatus) updateStatus.textContent = `Guncelleme kontrolu basarisiz: ${e.message}`;
            } finally {
                checkUpdatesBtn.disabled = false;
            }
        });
    }

    async function validateMediaBeforeDownload(url) {
        const res = await fetch('/api/validate-media', {
            method: 'POST',
            headers: apiJsonHeaders,
            body: JSON.stringify({ url })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            throw new Error(data.error || 'Medya dogrulanamadi');
        }
        if (data.downloadable === false || data.mediaType === 'image') {
            throw new Error('Bu baglanti video/ses gibi gorunmuyor. Foto veya desteklenmeyen medya olabilir.');
        }
        return data;
    }

    // Modal Controls
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            playSound('toggle');
            if (infoModal) infoModal.style.display = 'none';
        });
    }

    // Details Modal
    const detailsModal = document.getElementById('detailsModal');
    const closeDetails = document.querySelector('.close-details');
    if (closeDetails) {
        closeDetails.addEventListener('click', () => {
            playSound('toggle');
            if (detailsModal) detailsModal.style.display = 'none';
            activeDetailsId = null;
        });
    }
    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener('click', () => {
            playSound('open');
            settingsModal.style.display = 'flex';
        });
    }
    if (closeSettings && settingsModal) {
        closeSettings.addEventListener('click', () => {
            playSound('toggle');
            settingsModal.style.display = 'none';
        });
    }
    if (openSetupBtn && setupModal) {
        openSetupBtn.addEventListener('click', () => {
            playSound('open');
            setupModal.style.display = 'flex';
        });
    }
    if (closeSetup && setupModal) {
        closeSetup.addEventListener('click', () => {
            playSound('toggle');
            setupModal.style.display = 'none';
        });
    }
    if (closeSetupBtn && setupModal) {
        closeSetupBtn.addEventListener('click', () => {
            playSound('toggle');
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

    // Download list search filter
    const filterInput = document.getElementById('filterInput');
    if (filterInput) {
        filterInput.addEventListener('input', () => {
            searchQuery = filterInput.value.trim().toLowerCase();
            renderList();
        });
    }

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            currentView = item.getAttribute('data-view');
            // Icon rail and view tabs mirror the same view state
            navItems.forEach(nav => nav.classList.toggle('active', nav.getAttribute('data-view') === currentView));
            renderList();
        });
    });

    // Global Actions
    if (openFolderGlobal) {
        openFolderGlobal.addEventListener('click', () => {
            fetch('/api/open-folder', { method: 'POST', headers: apiClientHeaders }).catch(e => console.error(e));
        });
    }

    if (clearCompletedBtn) {
        clearCompletedBtn.addEventListener('click', () => {
            fetch('/api/clear-completed', { method: 'POST', headers: apiClientHeaders }).catch(e => console.error(e));
        });
    }

    // Event Delegation for action buttons to avoid performance issues
    if (downloadList) {
        downloadList.addEventListener('click', async (e) => {
            const btn = e.target.closest('.btn-icon');
            if (!btn) return;
            const card = e.target.closest('.download-card');
            if (!card) return;
            const dlId = card.id.replace('dl-', '');

            if (btn.classList.contains('pause-btn')) {
                playSound('toggle');
                fetch('/api/action', { method: 'POST', headers: apiJsonHeaders, body: JSON.stringify({id: dlId, action: 'pause'}) });
            } else if (btn.classList.contains('resume-btn')) {
                playSound('start');
                fetch('/api/action', { method: 'POST', headers: apiJsonHeaders, body: JSON.stringify({id: dlId, action: 'resume'}) });
            } else if (btn.classList.contains('cancel-btn')) {
                playSound('toggle');
                fetch('/api/action', { method: 'POST', headers: apiJsonHeaders, body: JSON.stringify({id: dlId, action: 'cancel'}) });
            } else if (btn.classList.contains('details-btn')) {
                playSound('open');
                activeDetailsId = dlId;
                if (detailsModal) detailsModal.style.display = 'block';
                if (activeDownloads[dlId]) updateDetailsModal(activeDownloads[dlId]);
            } else if (btn.classList.contains('play-file-btn')) {
                playSound('open');
                fetch('/api/open-file', {
                    method: 'POST',
                    headers: apiJsonHeaders,
                    body: JSON.stringify({ id: dlId })
                }).catch(e => console.error(e));
            } else if (btn.classList.contains('open-btn')) {
                fetch('/api/open-folder', { method: 'POST', headers: apiClientHeaders });
            } else if (btn.classList.contains('copy-error-btn')) {
                const dl = activeDownloads[dlId];
                const ok = await copyText(dl ? `${dl.title || 'Download'}\n${dl.url || ''}\n${dl.errorDetail || dl.status || ''}` : '');
                playSound(ok ? 'success' : 'error');
            } else if (btn.classList.contains('copy-link-btn')) {
                const dl = activeDownloads[dlId];
                const ok = await copyText(dl ? dl.url : '');
                playSound(ok ? 'success' : 'error');
            }
        });
    }

    // Network request deduplication cache
    let isFetchingInfo = false;

    // URL validation helper
    function isValidUrl(str) {
        try { new URL(str); return true; } catch { return false; }
    }

    // Inline URL validation feedback
    if (urlInput) {
        const urlField = urlInput.closest('.url-field') || urlInput;
        urlInput.addEventListener('input', () => {
            const val = urlInput.value.trim();
            if (!val) {
                urlField.style.borderColor = '';
                return;
            }
            urlField.style.borderColor = isValidUrl(val) ? 'var(--success)' : 'var(--danger)';
        });
        urlInput.addEventListener('blur', () => {
            urlField.style.borderColor = '';
        });
    }

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
                    headers: apiJsonHeaders,
                    body: JSON.stringify({ url }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                const info = await res.json();
                if (info.error) throw new Error(info.error);
                if (info.downloadable === false || info.mediaType === 'image') {
                    throw new Error('Bu baglanti video/ses gibi gorunmuyor. Foto veya desteklenmeyen medya olabilir.');
                }
                
                const isQuickMode = localStorage.getItem('uniget_quick_mode') === 'true';
                if (isQuickMode) {
                    const selectedQuality = localStorage.getItem('uniget_last_quality') || 'best';
                    const battery = navigator.getBattery ? await navigator.getBattery().catch(() => null) : null;
                    const isOnBattery = battery ? !battery.charging : false;
                    
                    const downloadRes = await fetch('/api/download', {
                        method: 'POST',
                        headers: apiJsonHeaders,
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
                    const downloadData = await downloadRes.json();
                    if (!downloadRes.ok || downloadData.error) throw new Error(downloadData.error || 'Download could not be started');
                    mergeDownload(downloadData.download || { ...downloadData, title: info.title, url: info.url });
                    playSound('start');
                    if (urlInput) urlInput.value = '';
                } else {
                    currentVideoInfo = { ...info, url };
                    if (modalPlaylistCheck && isPlaylistCheck) modalPlaylistCheck.checked = isPlaylistCheck.checked;
                    playSound('open');
                    showModal(info);
                }
            } catch (e) {
                playSound('error');
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

                const downloadRes = await fetch('/api/download', {
                    method: 'POST',
                    headers: apiJsonHeaders,
                    body: JSON.stringify({ 
                        url: currentVideoInfo.url,
                        title: currentVideoInfo.title,
                        thumbnail: currentVideoInfo.thumbnail || null,
                        quality: selectedQuality,
                        isPlaylist: modalPlaylistCheck ? modalPlaylistCheck.checked : (isPlaylistCheck ? isPlaylistCheck.checked : false),
                        autoOpen: modalAutoOpenCheck ? modalAutoOpenCheck.checked : true,
                        startTime: document.getElementById('modalStartTime') ? document.getElementById('modalStartTime').value.trim() : null,
                        endTime: document.getElementById('modalEndTime') ? document.getElementById('modalEndTime').value.trim() : null,
                        isOnBattery,
                        profile: selectedProfile
                    })
                });
                const downloadData = await downloadRes.json();
                if (!downloadRes.ok || downloadData.error) throw new Error(downloadData.error || 'Download could not be started');
                mergeDownload(downloadData.download || { ...downloadData, title: currentVideoInfo.title, url: currentVideoInfo.url });
                
                if (qualityOption) localStorage.setItem('uniget_last_quality', selectedQuality);
                if (modalAutoOpenCheck) localStorage.setItem('uniget_auto_open', modalAutoOpenCheck.checked);
                
                playSound('start');
                if (infoModal) infoModal.style.display = 'none';
                if (urlInput) urlInput.value = '';
            } catch(e) {
                playSound('error');
                console.error('Download Trigger Error:', e);
            }
        });
    }

    // Socket.IO Events
    if (socket) {
        console.log('Socket initialized.');
        socket.on('connect', refreshDownloads);
        socket.on('connect_error', refreshDownloads);
        socket.on('initial-state', (data) => {
            activeDownloads = data;
            renderList();
        });

        socket.on('download-cancelled', (data) => {
            delete activeDownloads[data.id];
            const card = document.getElementById(`dl-${data.id}`);
            if (card) {
                card.style.opacity = '0';
                setTimeout(() => {
                    card.remove();
                    if (downloadList && !downloadList.querySelector('.download-card')) {
                        downloadList.innerHTML = `<div class="empty-state"><i class="fas fa-cloud-download-alt"></i><p>${typeof t === 'function' ? t('no_downloads') : 'No downloads yet.'}</p></div>`;
                    }
                }, 200);
            }
            if (activeDetailsId === data.id) {
                if (detailsModal) detailsModal.style.display = 'none';
                activeDetailsId = null;
            }
        });

        socket.on('progress', (data) => {
            mergeDownload(data);
            const dl = activeDownloads[data.id];
            if (!dl) return;

            if (activeDetailsId === dl.id && detailsModal && detailsModal.style.display !== 'none') {
                if (!dl.speedHistory) dl.speedHistory = [];
                let val = 0;
                if (data.speed && typeof data.speed === 'string') {
                    val = parseFloat(data.speed) || 0;
                    if (data.speed.includes('MiB/s')) val *= 1024;
                    if (data.speed.includes('GiB/s')) val *= 1024 * 1024;
                }
                dl.speedHistory.push(val);
                if (dl.speedHistory.length > 40) dl.speedHistory.shift();
                updateDetailsModal(dl);
            }
            maybeNotify(dl);
        });
    }

    refreshDownloads();
    setInterval(refreshDownloads, 5000);

    function maybeNotify(dl) {
        const notificationsEnabled = lowNoiseNotificationCheck ? lowNoiseNotificationCheck.checked : true;
        if (!notificationsEnabled) return;
        const status = String(dl.status || '');
        if (!['completed', 'failed'].includes(status) && !status.startsWith('error:')) return;
        const cacheKey = `${dl.id}:${status}`;
        if (lastNotifyById[cacheKey]) return;
        // Prevent unbounded growth over long sessions.
        const keys = Object.keys(lastNotifyById);
        if (keys.length > 200) delete lastNotifyById[keys[0]];
        lastNotifyById[cacheKey] = true;
        playSound(status === 'completed' ? 'success' : 'error');
        if ('Notification' in window) {
            const notifTitle = status === 'completed' ? `UniGet - ${typeof t === 'function' ? t('completed_status') : 'Completed'}` : `UniGet - ${typeof t === 'function' ? t('error') : 'Error'}`;
            const showNotif = () => {
                const n = new Notification(notifTitle, { body: dl.title || 'Download task', silent: false });
                // Click brings app to front
                n.onclick = () => {
                    try { if (window.unigetAPI) window.unigetAPI.focusWindow(); } catch(e) {}
                    window.focus();
                    n.close();
                };
            };
            if (Notification.permission === 'granted') {
                showNotif();
                return;
            }
            if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((perm) => {
                    if (perm === 'granted') showNotif();
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
        
        dlArray = dlArray.filter(downloadMatchesCurrentView);

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

    function downloadMatchesCurrentView(dl) {
        if (searchQuery) {
            const haystack = `${dl?.title || ''} ${dl?.url || ''}`.toLowerCase();
            if (!haystack.includes(searchQuery)) return false;
        }
        const status = String(dl?.status || '');
        if (currentView === 'all') return true;
        if (currentView === 'completed') return status === 'completed';
        if (currentView === 'downloading') {
            return status !== 'completed' && !status.startsWith('error:') && status !== 'failed';
        }
        return true;
    }

    function updateCard(dl, cardEl) {
        let card = cardEl || document.getElementById(`dl-${dl.id}`);
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
        const rawStatus = dl.status || '';
        let statusText;
        if (rawStatus === 'completed') {
            statusText = typeof t === 'function' ? t('completed_status') : 'Completed';
        } else if (rawStatus === 'paused') {
            statusText = typeof t === 'function' ? t('paused_status') : 'Paused';
        } else if (rawStatus === 'failed') {
            statusText = dl.errorDetail || (typeof t === 'function' ? t('error') : 'Error');
        } else if (rawStatus.startsWith('error:')) {
            statusText = (dl.errorDetail || rawStatus.replace('error:', '')).substring(0, 120);
        } else {
            statusText = rawStatus.substring(0, 80);
        }
        // Sanitize for safe innerHTML insertion
        const safeStatus = statusText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        if (meta) {
            meta.innerHTML = `
                <span>${dl.progress || 0}%</span>
                <span>${dl.speed || '--'}</span>
                <span>${dl.eta || '--:--'}</span>
                <span class="status-badge" style="text-transform: capitalize;">${safeStatus}</span>
            `;
        }

        card.classList.remove('completed', 'failed', 'paused', 'downloading');
        if (icon) {
            if (rawStatus === 'completed') {
                icon.className = 'fas fa-check';
                card.classList.add('completed');
            } else if (rawStatus.startsWith('error:') || rawStatus === 'failed') {
                icon.className = 'fas fa-exclamation-triangle';
                card.classList.add('failed');
            } else if (rawStatus === 'paused') {
                icon.className = 'fas fa-pause';
                card.classList.add('paused');
            } else {
                icon.className = 'fas fa-arrow-down';
                card.classList.add('downloading');
            }
        }

        if (actions) {
            const isDownloading = ['downloading', 'starting', 'queued'].includes(rawStatus);
            const isPausedOrFailed = ['paused', 'failed'].includes(rawStatus) || rawStatus.startsWith('error:');
            
            let actionButtons = '';
            if (isDownloading) {
                actionButtons += `<button class="btn-icon pause-btn" title="${typeof t === 'function' ? t('pause') : 'Pause'}"><i class="fas fa-pause"></i></button>`;
                actionButtons += `<button class="btn-icon cancel-btn" title="${typeof t === 'function' ? t('cancel') : 'Cancel'}" style="color:var(--danger)"><i class="fas fa-times"></i></button>`;
            } else if (isPausedOrFailed) {
                actionButtons += `<button class="btn-icon resume-btn" title="${typeof t === 'function' ? t('resume') : 'Resume'}"><i class="fas fa-play"></i></button>`;
                actionButtons += `<button class="btn-icon copy-error-btn" title="Hata detayini kopyala"><i class="fas fa-copy"></i></button>`;
                actionButtons += `<button class="btn-icon cancel-btn" title="${typeof t === 'function' ? t('cancel') : 'Cancel'}" style="color:var(--danger)"><i class="fas fa-times"></i></button>`;
            }
            if (rawStatus === 'completed' && dl.filePath) {
                actionButtons += `<button class="btn-icon play-file-btn" title="Videoyu Aç"><i class="fas fa-play-circle"></i></button>`;
            }
            if (dl.url) {
                actionButtons += `<button class="btn-icon copy-link-btn" title="${typeof t === 'function' ? t('copy_link') : 'Copy link'}"><i class="fas fa-link"></i></button>`;
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
        
        if (detailsModal && detailsModal.style.display !== 'none') drawChart(dl);
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
        chartCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7057ee';
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
        const safeTitle = (dl.title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const thumbHtml = dl.thumbnail
            ? `<img class="card-thumb" src="${dl.thumbnail.replace(/"/g,'&quot;')}" alt="" loading="lazy">`
            : `<div class="card-icon"><i class="fas fa-arrow-down"></i></div>`;
        card.innerHTML = `
            ${thumbHtml}
            <div class="card-details">
                <div class="card-title" title="${safeTitle}">${safeTitle}${dl.isPlaylist ? ' <span style="opacity:0.5;font-size:0.75em">[PL]</span>' : ''}</div>
                <div class="progress-container">
                    <div class="progress-bar" style="width: 0%"></div>
                </div>
                <div class="card-meta"></div>
            </div>
            <div class="card-actions" style="display:flex; gap: 5px;"></div>
        `;
        // Pass the element directly: the card is not in the DOM yet, so an id
        // lookup would miss and recurse back into createCard forever.
        updateCard(dl, card);
        return card;
    }

    // Electron Clipboard Integration — only check on window focus, not polling
    let lastClipboardText = '';
    function checkClipboard() {
        if (!window.unigetAPI) return;
        try {
            const text = window.unigetAPI.readClipboardText().trim();
            if (text && text !== lastClipboardText &&
                (text.includes('youtube.com/') || text.includes('youtu.be/') ||
                 text.includes('vimeo.com/') || text.includes('twitch.tv/'))) {
                lastClipboardText = text;
                if (urlInput) {
                    urlInput.value = text;
                    if (isQuickMode && addBtn) addBtn.click();
                }
            }
        } catch (e) {}
    }

    // Check on window focus instead of polling every 3s
    window.addEventListener('focus', checkClipboard);
    // Also check once on load in case app opened with URL in clipboard
    setTimeout(checkClipboard, 800);

    // Final Support Button
    const donateBtn = document.getElementById('donateBtn');
    if (donateBtn) {
        donateBtn.addEventListener('click', () => {
            openExternalUrl('https://donate.bynogame.com/muhammeddolan');
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
                if (window.unigetAPI) window.unigetAPI.setAlwaysOnTop(isAlwaysOnTop);
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
            playSound('start');
            openExternalUrl(`${window.location.origin}/uniget-extension.user.js`);
            if (setupModal) setupModal.style.display = 'none';
        });
    }

    if (firefoxAddonBtn) {
        firefoxAddonBtn.addEventListener('click', () => {
            playSound('open');
            openExternalUrl(firefoxAddonUrl);
        });
    }

    if (chromePackageBtn) {
        chromePackageBtn.addEventListener('click', () => {
            playSound('open');
            openExternalUrl(chromePackageUrl);
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
            playSound('success');
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
            playSound('start');
            if (urlInput) urlInput.value = url;
            if (addBtn) addBtn.click();
        }
    });

    // Extension Detection - check correct attribute set by content.js
    setInterval(() => {
        const isExtensionActive = document.body.dataset.unigetExtension === "active";
        if (openSetupBtn) {
            if (isExtensionActive) {
                openSetupBtn.style.color = "var(--text-dim)";
                openSetupBtn.title = "Eklenti Aktif";
            } else {
                openSetupBtn.style.color = "var(--accent)";
                openSetupBtn.title = "Eklenti Kurulu Değil";
            }
        }
    }, 10000);
});
