// UniGet Pro - Core Application Logic
window.addEventListener('load', () => {
    const socket = typeof io !== 'undefined' ? io({ transports: ['websocket', 'polling'] }) : null;
    const urlInput = document.getElementById('urlInput');
    const addBtn = document.getElementById('addBtn');
    const downloadList = document.getElementById('downloadList');
    const newDownloadBtn = document.getElementById('newDownloadBtn');
    const appContainer = document.querySelector('.app-container');
    const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
    const libraryViewLabelEl = document.getElementById('libraryViewLabel');
    const countAllEl = document.getElementById('countAll');
    const countDownloadingEl = document.getElementById('countDownloading');
    const countCompletedEl = document.getElementById('countCompleted');
    const librarySummaryEl = document.getElementById('librarySummary');
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
    const sleepAfterDownloadCheck = document.getElementById('sleepAfterDownloadCheck');
    const soundEffectsCheck = document.getElementById('soundEffectsCheck');
    const accentColorInput = document.getElementById('accentColorInput');
    const globalHotkeyInput = document.getElementById('globalHotkeyInput');
    const useBrowserCookiesCheck = document.getElementById('useBrowserCookiesCheck');
    const cookiesBrowserSelect = document.getElementById('cookiesBrowserSelect');
    const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
    const updateStatus = document.getElementById('updateStatus');
    const installUpdateBtn = document.getElementById('installUpdateBtn');
    const profileOption = document.getElementById('profileOption');
    const setupModal = document.getElementById('setupModal');
    const openSetupBtn = document.getElementById('openSetupBtn');
    const closeSetup = document.querySelector('.close-setup');
    const closeSetupBtn = document.getElementById('closeSetupBtn');
    const toolStatus = document.getElementById('toolStatus');
    const installFfmpegBtn = document.getElementById('installFfmpegBtn');
    const updateYtDlpBtn = document.getElementById('updateYtDlpBtn');
    const repairBanner = document.getElementById('repairBanner');
    const repairTitle = document.getElementById('repairTitle');
    const repairDesc = document.getElementById('repairDesc');
    const repairToolsBtn = document.getElementById('repairToolsBtn');
    const repairDismissBtn = document.getElementById('repairDismissBtn');
    const appVersionEl = document.getElementById('appVersion');
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

    if (accentColorInput) {
        accentColorInput.addEventListener('change', () => {
            const c = accentColorInput.value;
            document.documentElement.style.setProperty('--accent', c);
            document.documentElement.style.setProperty('--accent-hover', c);
            localStorage.setItem('uniget_accent', c);
        });
    }

    // globalHotkeyInput listener attached later (after declarations)
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
        // Ignore partial progress payloads for downloads we don't know about,
        // so cancelled/ghost entries can't create empty cards.
        if (!activeDownloads[dl.id] && !dl.title && !dl.url) return;
        if (!activeDownloads[dl.id]) activeDownloads[dl.id] = dl;
        else Object.assign(activeDownloads[dl.id], dl);
        if (downloadMatchesCurrentView(activeDownloads[dl.id])) {
            updateCard(activeDownloads[dl.id]);
        } else {
            document.getElementById(`dl-${dl.id}`)?.remove();
            if (downloadList && !downloadList.querySelector('.download-card')) renderList();
        }
        refreshLibraryMeta();
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

    const savedAccent = localStorage.getItem('uniget_accent');
    if (savedAccent) {
        document.documentElement.style.setProperty('--accent', savedAccent);
        document.documentElement.style.setProperty('--accent-hover', savedAccent);
    }

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
    const maxConcurrentInput = document.getElementById('maxConcurrentInput');
    const outputTemplateInput = document.getElementById('outputTemplateInput');
    const historyRetentionInput = document.getElementById('historyRetentionInput');
    const postDownloadCommandInput = document.getElementById('postDownloadCommandInput');
    // globalHotkeyInput already declared above

    if (downloadDirInput && saveDirBtn) {
        fetch('/api/settings').then(r => r.json()).then(data => {
            if (data.downloadDir) downloadDirInput.value = data.downloadDir;
            if (powerModeSelect && data.powerMode) powerModeSelect.value = data.powerMode;
            if (rateLimitInput && typeof data.rateLimitKbps !== 'undefined') rateLimitInput.value = data.rateLimitKbps;
            if (maxConcurrentInput && typeof data.maxConcurrent !== 'undefined') maxConcurrentInput.value = data.maxConcurrent;
            if (outputTemplateInput && typeof data.outputTemplate !== 'undefined') outputTemplateInput.value = data.outputTemplate;
            if (historyRetentionInput && typeof data.historyRetentionDays !== 'undefined') historyRetentionInput.value = data.historyRetentionDays;
            if (postDownloadCommandInput && typeof data.postDownloadCommand !== 'undefined') postDownloadCommandInput.value = data.postDownloadCommand;
            if (globalHotkeyInput && typeof data.globalHotkey !== 'undefined') globalHotkeyInput.value = data.globalHotkey;
            const savedAccent2 = localStorage.getItem('uniget_accent');
            if (accentColorInput && savedAccent2) accentColorInput.value = savedAccent2;
            if (smartRetryCheck) smartRetryCheck.checked = data.smartRetry !== false;
            if (lowNoiseNotificationCheck) lowNoiseNotificationCheck.checked = data.lowNoiseNotifications !== false;
            if (sleepAfterDownloadCheck) sleepAfterDownloadCheck.checked = data.sleepAfterDownload === true;
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
                        sleepAfterDownload: sleepAfterDownloadCheck ? sleepAfterDownloadCheck.checked : false,
                        useBrowserCookies: useBrowserCookiesCheck ? useBrowserCookiesCheck.checked : false,
                        cookiesBrowser: cookiesBrowserSelect ? cookiesBrowserSelect.value : 'chrome',
                        maxConcurrent: maxConcurrentInput ? Number(maxConcurrentInput.value || 5) : 5,
                        outputTemplate: outputTemplateInput ? outputTemplateInput.value.trim() : '',
                        historyRetentionDays: historyRetentionInput ? Number(historyRetentionInput.value || 0) : 0,
                        postDownloadCommand: postDownloadCommandInput ? postDownloadCommandInput.value.trim() : '',
                        globalHotkey: globalHotkeyInput ? globalHotkeyInput.value.trim() : ''
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

        [powerModeSelect, rateLimitInput, maxConcurrentInput, outputTemplateInput, historyRetentionInput, postDownloadCommandInput, globalHotkeyInput, smartRetryCheck, lowNoiseNotificationCheck, sleepAfterDownloadCheck, useBrowserCookiesCheck, cookiesBrowserSelect].forEach((el) => {
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
            const ytDlpVersion = data.ytDlp && data.ytDlp.version ? data.ytDlp.version : 'bulunamadı';
            toolStatus.textContent = [
                `yt-dlp: ${ytDlpVersion}`,
                ffmpegReady ? 'FFmpeg: hazır (yüksek kalite birleştirme açık)' : 'FFmpeg: yok (progressive mod)'
            ].join(' • ');
            if (installFfmpegBtn) installFfmpegBtn.hidden = ffmpegReady;
            if (updateYtDlpBtn) updateYtDlpBtn.hidden = !(data.ytDlp && data.ytDlp.updatable);
            if (appVersionEl && data.appVersion) appVersionEl.textContent = `v${data.appVersion}`;
        } catch {
            toolStatus.textContent = 'Araç durumu okunamadı';
            if (installFfmpegBtn) installFfmpegBtn.hidden = true;
            if (updateYtDlpBtn) updateYtDlpBtn.hidden = true;
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

    if (updateYtDlpBtn) {
        updateYtDlpBtn.addEventListener('click', async () => {
            updateYtDlpBtn.disabled = true;
            if (toolStatus) toolStatus.textContent = 'yt-dlp indiriliyor ve güncelleniyor...';
            try {
                const res = await fetch('/api/tools/update-ytdlp', {
                    method: 'POST',
                    headers: apiClientHeaders
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.error) throw new Error(data.error || 'yt-dlp güncellemesi başarısız');
                playSound('success');
                await refreshToolStatus();
                if (toolStatus) {
                    toolStatus.textContent = data.updated
                        ? `yt-dlp güncellendi: v${data.version}`
                        : `yt-dlp zaten güncel: v${data.version}`;
                }
            } catch (e) {
                playSound('error');
                if (toolStatus) toolStatus.textContent = `yt-dlp güncellemesi başarısız: ${e.message}`;
            } finally {
                updateYtDlpBtn.disabled = false;
            }
        });
    }

    // ── Tool repair banner: missing yt-dlp / ffmpeg self-heal ────────────
    let repairFailedIds = new Set();
    let repairDismissed = false;

    function bannerText(el, key, fallback) {
        if (el) el.textContent = typeof t === 'function' ? t(key) : fallback;
    }

    function showRepairBanner(desc, titleKey = 'repair_title') {
        if (!repairBanner) return;
        if (repairDismissed) return;
        bannerText(repairTitle, titleKey, 'İndirme araçları eksik');
        bannerText(repairDesc, 'repair_desc', 'yt-dlp eksik olduğu için indirme başlatılamadı.');
        if (desc && repairDesc) repairDesc.textContent = desc;
        repairBanner.classList.remove('success');
        repairBanner.hidden = false;
    }

    function hideRepairBanner() {
        if (repairBanner) repairBanner.hidden = true;
    }

    if (repairDismissBtn) {
        repairDismissBtn.addEventListener('click', () => {
            repairDismissed = true;
            hideRepairBanner();
        });
    }

    async function runToolRepair() {
        if (!repairToolsBtn || repairToolsBtn.disabled) return;
        repairToolsBtn.disabled = true;
        const wrenchIcon = repairToolsBtn.querySelector('i');
        if (wrenchIcon) wrenchIcon.classList.add('fa-spin');
        bannerText(repairDesc, 'repair_running', 'Araçlar onarılıyor...');
        repairBanner?.classList.remove('success');

        try {
            // 1) yt-dlp: indir / güncelle
            const ytRes = await fetch('/api/tools/update-ytdlp', {
                method: 'POST',
                headers: apiClientHeaders
            });
            const ytData = await ytRes.json().catch(() => ({}));
            if (!ytRes.ok || ytData.error) throw new Error(ytData.error || 'yt-dlp onarımı başarısız');

            // 2) ffmpeg eksikse kur
            let tools = null;
            try {
                tools = (await (await fetch('/api/tools')).json());
                if (tools && !(tools.ffmpeg && tools.ffmpeg.available)) {
                    const ffRes = await fetch('/api/tools/install-ffmpeg', {
                        method: 'POST',
                        headers: apiClientHeaders
                    });
                    const ffData = await ffRes.json().catch(() => ({}));
                    if (!ffRes.ok || ffData.error) throw new Error(ffData.error || 'FFmpeg kurulumu başarısız');
                }
            } catch (e) {
                // FFmpeg isteğe bağlıdır: yt-dlp çalışıyorsa fallback devrede.
                if (String(e.message).includes('yt-dlp')) throw e;
            }

            // 3) doğrula
            const verify = (await (await fetch('/api/tools')).json());
            const fixed = verify && verify.ytDlp && verify.ytDlp.version;
            if (!fixed) throw new Error('Onarım doğrulanamadı; Defender yt-dlp.exe dosyasını silmiş olabilir.');

            // 4) araçlar geri geldi → başarısız indirmeleri otomatik yeniden dene
            repairFailedIds.forEach((id) => {
                const dl = activeDownloads[id];
                if (dl && (dl.status === 'failed' || String(dl.status).startsWith('error:'))) {
                    fetch('/api/action', {
                        method: 'POST',
                        headers: apiJsonHeaders,
                        body: JSON.stringify({ id, action: 'resume' })
                    }).catch(() => {});
                }
            });
            repairFailedIds.clear();
            repairDismissed = false;

            bannerText(repairDesc, 'repair_done', 'Araçlar onarıldı — indirmeler yeniden deneniyor.');
            repairBanner.classList.add('success');
            playSound('success');
            if (typeof refreshToolStatus === 'function') refreshToolStatus();
            setTimeout(hideRepairBanner, 4000);
        } catch (e) {
            playSound('error');
            showRepairBanner(`${typeof t === 'function' ? t('repair_failed') : 'Onarım başarısız:'} ${e.message}`);
        } finally {
            if (wrenchIcon) wrenchIcon.classList.remove('fa-spin');
            bannerText(repairTitle, 'repair_title', 'İndirme araçları eksik');
            if (repairToolsBtn) repairToolsBtn.disabled = false;
        }
    }

    if (repairToolsBtn) repairToolsBtn.addEventListener('click', runToolRepair);

    function markToolMissingFailure(dl) {
        const detail = String(dl.errorDetail || dl.status || '').toLowerCase();
        const isMissing = String(dl.status).startsWith('error:yt-dlp-not-found')
            || (!String(dl.status || '').startsWith('error:') && detail.includes('yt-dlp') && (detail.includes('bulunamadi') || detail.includes('bulunamadı') || detail.includes('not') && detail.includes('found')));
        if (!isMissing) return;
        if (dl.id) repairFailedIds.add(dl.id);
        showRepairBanner();
    }

    async function checkToolsOnStartup() {
        try {
            const res = await fetch('/api/tools');
            const data = await res.json();
            if (data && data.ytDlp && !data.ytDlp.version) showRepairBanner();
            if (appVersionEl && data.appVersion) appVersionEl.textContent = `v${data.appVersion}`;
        } catch {
            /* server unavailable: status refresh handles it */
        }
    }
    checkToolsOnStartup();

    // Update flow: use the packaged auto-updater when available (Electron),
    // otherwise fall back to the public release check in the browser.
    const updateBridge = window.unigetAPI && typeof window.unigetAPI.checkForUpdates === 'function'
        ? window.unigetAPI
        : null;

    function friendlyUpdateError(message) {
        const text = String(message || '').replace(/\s+/g, ' ').trim();
        if (!text) return 'Bilinmeyen hata';
        if (/latest\.yml/i.test(text) || /\b404\b/.test(text)) {
            return 'Sunucuda güncelleme bilgisi (latest.yml) bulunamadı. Lütfen daha sonra tekrar deneyin veya yeni sürümü manuel yükleyin.';
        }
        return text.length > 220 ? `${text.slice(0, 220)}…` : text;
    }

    function renderUpdateState(state) {
        if (!updateStatus || !state) return;
        const version = state.latestVersion ? `v${state.latestVersion}` : '';
        const messages = {
            checking: 'Güncelleme kontrol ediliyor...',
            available: version ? `Yeni sürüm bulundu: ${version} (indiriliyor...)` : 'Yeni sürüm bulundu, indiriliyor...',
            downloading: `Güncelleme indiriliyor: %${state.percent || 0}`,
            downloaded: version ? `Güncelleme hazır: ${version} - yeniden başlatıp kurun.` : 'Güncelleme hazır - yeniden başlatıp kurun.',
            'up-to-date': version ? `Güncel sürümdesiniz: ${version}` : 'Güncel sürümdesiniz.',
            disabled: 'Güncelleme yalnızca kurulu uygulamada kullanılabilir.',
            error: `Güncelleme hatası: ${friendlyUpdateError(state.error)}`
        };
        if (messages[state.status]) updateStatus.textContent = messages[state.status];
        if (installUpdateBtn) installUpdateBtn.hidden = state.status !== 'downloaded';
    }

    if (updateBridge) {
        updateBridge.getUpdateStatus().then(renderUpdateState).catch(() => {});
        updateBridge.onUpdateStatus(renderUpdateState);
    }

    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', async () => {
            checkUpdatesBtn.disabled = true;
            if (updateStatus) updateStatus.textContent = 'Güncelleme kontrol ediliyor...';
            try {
                if (updateBridge) {
                    const state = await updateBridge.checkForUpdates();
                    renderUpdateState(state || { status: 'checking' });
                } else {
                    const res = await fetch('/api/update-check', { headers: apiClientHeaders });
                    const data = await res.json();
                    if (!res.ok || data.error) throw new Error(data.error || 'Güncelleme kontrolü başarısız');
                    if (data.hasUpdate) {
                        if (updateStatus) updateStatus.textContent = `Yeni sürüm var: v${data.latestVersion}`;
                        openExternalUrl(data.url);
                    } else if (updateStatus) {
                        updateStatus.textContent = `Güncel sürümdesiniz: v${data.currentVersion}`;
                    }
                }
                playSound('success');
            } catch (e) {
                playSound('error');
                if (updateStatus) updateStatus.textContent = `Güncelleme kontrolü başarısız: ${friendlyUpdateError(e.message)}`;
            } finally {
                checkUpdatesBtn.disabled = false;
            }
        });
    }

    if (installUpdateBtn) {
        installUpdateBtn.addEventListener('click', async () => {
            installUpdateBtn.disabled = true;
            try {
                if (!updateBridge) throw new Error('Kurulum yalnızca masaüstü uygulamada kullanılabilir');
                const result = await updateBridge.installUpdate();
                if (result && result.success === false) throw new Error(result.error || 'Kurulum başlatılamadı');
            } catch (e) {
                playSound('error');
                if (updateStatus) updateStatus.textContent = `Kurulum başlatılamadı: ${friendlyUpdateError(e.message)}`;
            } finally {
                installUpdateBtn.disabled = false;
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

    if (infoModal) {
        infoModal.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-sched]');
            if (!btn) return;
            const mins = Number(btn.getAttribute('data-sched')) || 0;
            const inp = document.getElementById('modalScheduleAt');
            if (!inp) return;
            const d = new Date(Date.now() + mins * 60 * 1000);
            const pad = (n) => String(n).padStart(2, '0');
            inp.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

    // Settings categories
    const settingsTabs = Array.from(document.querySelectorAll('.settings-tab'));
    const settingsPanels = Array.from(document.querySelectorAll('.settings-panel'));
    const settingsBody = document.querySelector('.settings-body');
    function activateSettingsTab(name) {
        settingsTabs.forEach((tab) => {
            const active = tab.dataset.settingsTab === name;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        settingsPanels.forEach((panel) => {
            const active = panel.dataset.settingsPanel === name;
            panel.classList.toggle('active', active);
            panel.hidden = !active;
        });
        if (settingsBody) settingsBody.scrollTop = 0;
    }
    settingsTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            playSound('toggle');
            activateSettingsTab(tab.dataset.settingsTab);
        });
    });
    if (settingsTabs.length) activateSettingsTab(settingsTabs[0].dataset.settingsTab);

    // Lock page scroll and stop scroll chaining while any modal is visible.
    const modalNodes = Array.from(document.querySelectorAll('.modal'));
    function syncModalScrollLock() {
        const anyVisible = modalNodes.some((modal) => getComputedStyle(modal).display !== 'none');
        document.body.classList.toggle('modal-open', anyVisible);
    }
    const modalObserver = new MutationObserver(syncModalScrollLock);
    modalNodes.forEach((modal) => modalObserver.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] }));
    syncModalScrollLock();

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
            // Sidebar navigation mirrors the same view state
            navItems.forEach(nav => nav.classList.toggle('active', nav.getAttribute('data-view') === currentView));
            updateLibraryViewLabel();
            renderList();
        });
    });

    if (sidebarCollapseBtn) {
        sidebarCollapseBtn.addEventListener('click', () => {
            const collapsed = appContainer?.getAttribute('data-sidebar') === 'collapsed';
            localStorage.setItem('uniget_sidebar_collapsed', !collapsed ? '1' : '0');
            applySidebarState(!collapsed);
        });
    }

    if (newDownloadBtn) {
        newDownloadBtn.addEventListener('click', () => {
            playSound('open');
            if (urlInput) {
                urlInput.focus();
                urlInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        });
    }

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

    if (globalHotkeyInput) {
        globalHotkeyInput.addEventListener('change', async () => {
            const hk = globalHotkeyInput.value.trim();
            if (!hk) return;
            try {
                if (window.unigetAPI && window.unigetAPI.setHotkey) {
                    await window.unigetAPI.setHotkey(hk);
                }
            } catch (e) {}
        });
    }

    const exportListBtn = document.getElementById('exportListBtn');
    if (exportListBtn) {
        exportListBtn.addEventListener('click', () => {
            try {
                const data = JSON.stringify(activeDownloads, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `uniget-downloads-${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                playSound('success');
            } catch (e) {
                playSound('error');
            }
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
            } else if (btn.classList.contains('reveal-btn')) {
                playSound('open');
                fetch('/api/reveal-file', {
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
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (addBtn) addBtn.click();
            }
        });
    }

    // Main Download Trigger
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const rawUrl = urlInput ? urlInput.value : '';
            const urls = rawUrl.split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
            if (urls.length > 1) {
                if (isFetchingInfo) return;
                isFetchingInfo = true;
                addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                (async () => {
                    for (const u of urls) {
                        try {
                            const res = await fetch('/api/info', { method: 'POST', headers: apiJsonHeaders, body: JSON.stringify({ url: u }) });
                            const info = await res.json();
                            if (info.error || info.downloadable === false || info.mediaType === 'image') continue;
                            const q = localStorage.getItem('uniget_last_quality') || 'best';
                            const battery = navigator.getBattery ? await navigator.getBattery().catch(() => null) : null;
                            const isOnBattery = battery ? !battery.charging : false;
                            const dr = await fetch('/api/download', { method: 'POST', headers: apiJsonHeaders, body: JSON.stringify({ url: info.url, title: info.title, thumbnail: info.thumbnail || null, quality: q, isPlaylist: false, autoOpen: false, startTime: null, endTime: null, isOnBattery, profile: 'custom' }) });
                            const dd = await dr.json();
                            if (dd && dd.id) mergeDownload(dd.download || { ...dd, title: info.title, url: info.url });
                        } catch (e) {}
                    }
                    if (urlInput) urlInput.value = '';
                    isFetchingInfo = false;
                    addBtn.innerHTML = '<i class="fas fa-plus"></i>';
                    playSound('success');
                })();
                return;
            }
            const url = urls[0] || '';
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
                        subtitles: (document.getElementById('modalSubtitlesCheck') || {}).checked === true,
                        subtitleLangs: (document.getElementById('modalSubtitleLang') || {}).value || '',
                        scheduleAt: (document.getElementById('modalScheduleAt') || {}).value || null,
                        subtitleFormat: (document.getElementById('modalSubtitleFormat') || {}).value || 'best',
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
            refreshLibraryMeta();
            const card = document.getElementById(`dl-${data.id}`);
            if (card) {
                card.style.opacity = '0';
                setTimeout(() => {
                    card.remove();
                    if (downloadList && !downloadList.querySelector('.download-card')) {
                        downloadList.innerHTML = `<div class="empty-state"><i class="fas fa-cloud-download-alt"></i><p>${typeof t === 'function' ? t(emptyStateKey()) : 'No downloads yet.'}</p></div>`;
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

        refreshLibraryMeta();

        if (dlArray.length === 0) {
            downloadList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-cloud-download-alt"></i>
                    <p>${typeof t === 'function' ? t(emptyStateKey()) : 'No downloads yet.'}</p>
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

    function refreshLibraryMeta() {
        const downloads = Object.values(activeDownloads);
        const total = downloads.length;
        const completed = downloads.filter((dl) => String(dl?.status || '') === 'completed').length;
        const downloading = downloads.filter((dl) => {
            const status = String(dl?.status || '');
            return status !== 'completed' && !status.startsWith('error:') && status !== 'failed';
        }).length;
        if (countAllEl) countAllEl.textContent = total;
        if (countDownloadingEl) countDownloadingEl.textContent = downloading;
        if (countCompletedEl) countCompletedEl.textContent = completed;
        if (librarySummaryEl) {
            const visible = downloads.filter(downloadMatchesCurrentView).length;
            const unit = typeof t === 'function' ? t('videos') : 'videos';
            librarySummaryEl.textContent = searchQuery ? `${visible} / ${total} ${unit}` : `${visible} ${unit}`;
        }
    }

    function emptyStateKey() {
        if (searchQuery) return 'no_results';
        if (currentView === 'completed') return 'no_completed';
        if (currentView === 'downloading') return 'no_active';
        return 'no_downloads';
    }

    function updateLibraryViewLabel() {
        if (!libraryViewLabelEl) return;
        const key = currentView === 'all' ? 'downloads_title' : currentView;
        libraryViewLabelEl.textContent = typeof t === 'function' ? t(key) : 'Downloads';
    }

    function applySidebarState(collapsed) {
        if (appContainer) appContainer.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded');
        if (sidebarCollapseBtn) {
            sidebarCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
            sidebarCollapseBtn.title = typeof t === 'function'
                ? t(collapsed ? 'sidebar_expand' : 'sidebar_collapse')
                : (collapsed ? 'Expand the sidebar' : 'Collapse the sidebar');
        }
    }

    window.refreshSidebarMeta = () => {
        updateLibraryViewLabel();
        applySidebarState(appContainer?.getAttribute('data-sidebar') === 'collapsed');
    };
    applySidebarState(localStorage.getItem('uniget_sidebar_collapsed') === '1');
    refreshSidebarMeta();

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
        } else if (rawStatus === 'scheduled') {
            statusText = 'Zamanlandi';
        } else if (rawStatus === 'failed') {
            statusText = dl.errorDetail || (typeof t === 'function' ? t('error') : 'Error');
            markToolMissingFailure(dl);
        } else if (rawStatus.startsWith('error:')) {
            statusText = (dl.errorDetail || rawStatus.replace('error:', '')).substring(0, 120);
            markToolMissingFailure(dl);
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
                actionButtons += `<button class="btn-icon reveal-btn" title="Konumda Göster"><i class="fas fa-map-marker-alt"></i></button>`;
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
