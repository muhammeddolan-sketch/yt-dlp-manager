// ==UserScript==
// @name         UniGet Web Helper
// @namespace    http://tampermonkey.net/
// @version      1.8.0
// @description  Adds a clean floating download button to all videos
// @author       Antigravity
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    let activeVideo = null;
    const btn = document.createElement('div');
    
    // Logo Only Request implementation
    btn.innerHTML = '<img src="http://localhost:3000/icon.png" style="width: 28px; height: 28px; display: block; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.6)); border-radius: 6px;" alt="UniGet">';
    btn.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        padding: 2px;
        cursor: pointer;
        display: none;
        opacity: 0;
        transition: transform 0.2s, opacity 0.3s ease;
        pointer-events: none;
    `;

    document.body.appendChild(btn);
    
    // Quality & Settings Modal (Pop-up upon click)
    const popup = document.createElement('div');
    popup.style.cssText = `
        position: fixed;
        z-index: 2147483648;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(8px);
        color: white;
        padding: 12px;
        border-radius: 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        display: none;
        flex-direction: column;
        gap: 10px;
        border: 1px solid rgba(255,255,255,0.1);
        box-shadow: 0 8px 16px rgba(0,0,0,0.6);
        width: 170px;
    `;
    popup.innerHTML = `
        <div style="font-weight: 600; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; font-size: 14px;">UniGet</div>
        <select id="uniget-quality" style="background: #1e293b; color: white; border: 1px solid #334155; padding: 6px; border-radius: 6px; outline: none; cursor: pointer;">
            <option value="best">Orijinal Kalite</option>
            <option value="2160">2160p (4K)</option>
            <option value="1440">1440p (2K)</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
            <option value="audio">Sadece Ses</option>
        </select>
        <label style="display: flex; gap: 6px; align-items: center; cursor: pointer; color: #cbd5e1; margin-top: 2px;">
            <input type="checkbox" id="uniget-playlist"> Çalma Listesi
        </label>
        <label style="display: flex; gap: 6px; align-items: center; cursor: pointer; color: #cbd5e1; margin-top: -4px;">
            <input type="checkbox" id="uniget-subs"> Altyazıları İndir
        </label>
        <button id="uniget-start" style="background: #60a5fa; color: black; border: none; padding: 8px; border-radius: 6px; font-weight: 700; cursor: pointer; transition: 0.2s;">İndir</button>
        <button id="uniget-cancel" style="background: transparent; color: #f87171; border: 1px solid #f87171; padding: 6px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 11px;">İptal</button>
        <!-- Progress Container -->
        <div id="uniget-progress-container" style="display: none; margin-top: 2px; flex-direction: column; gap: 5px;">
            <div style="font-size: 11px; color: #cbd5e1; display: flex; justify-content: space-between;">
                <span id="uniget-prog-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;">Bağlanıyor...</span>
                <span id="uniget-prog-pct">%0</span>
            </div>
            <div style="width: 100%; height: 6px; background: #334155; border-radius: 3px; overflow: hidden;">
                <div id="uniget-prog-bar" style="width: 0%; height: 100%; background: #60a5fa; transition: width 0.3s, background 0.3s;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(popup);

    function updatePosition() {
        if (!activeVideo || !activeVideo.isConnected) {
            if (popup.style.display === 'none') btn.style.display = 'none';
            return;
        }
        const rect = activeVideo.getBoundingClientRect();
        if (rect.top === 0 && rect.height === 0) {
            if (popup.style.display === 'none') btn.style.display = 'none';
            return;
        }
        
        // Place just inside top-right bounds
        const top = Math.max(10, rect.top + 10);
        const left = Math.min(window.innerWidth - 40, rect.left + rect.width - 40);
        
        btn.style.top = top + 'px';
        btn.style.left = left + 'px';
        
        if (popup.style.display === 'none') {
            btn.style.display = 'block';
            // Force reflow for fade in
            void btn.offsetWidth;
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        }
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target.tagName === 'VIDEO' || (target.closest && target.closest('video'))) {
            activeVideo = target.tagName === 'VIDEO' ? target : target.closest('video');
            if (popup.style.display === 'none') updatePosition();
        }
    }, true);

    let hideTimeout = null;
    document.addEventListener('mousemove', (e) => {
        if (!activeVideo || popup.style.display !== 'none') return;
        const target = e.target;
        if (target !== btn && target !== activeVideo && !activeVideo.contains(target)) {
            const rect = activeVideo.getBoundingClientRect();
            const buffer = 30;
            if (e.clientX < rect.left - buffer || e.clientX > rect.right + buffer || 
                e.clientY < rect.top - buffer || e.clientY > rect.bottom + buffer) {
                
                clearTimeout(hideTimeout);
                btn.style.opacity = '0';
                btn.style.pointerEvents = 'none';
                hideTimeout = setTimeout(() => {
                    if (btn.style.opacity === '0') {
                        btn.style.display = 'none';
                        activeVideo = null;
                    }
                }, 300);
            }
        }
    });

    window.addEventListener('scroll', () => { if (popup.style.display === 'none') updatePosition(); });
    window.addEventListener('resize', () => { if (popup.style.display === 'none') updatePosition(); });

    btn.onmouseover = () => btn.style.transform = 'scale(1.15)';
    btn.onmouseout = () => btn.style.transform = 'scale(1)';
    
    // Popup integration logic
    btn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const rect = btn.getBoundingClientRect();
        // Shift popup slightly left of the logo
        popup.style.top = rect.top + 'px';
        popup.style.left = (rect.left - 180) + 'px';
        popup.style.display = 'flex';
        btn.style.display = 'none';
    };

    let pollTimer = null;

    document.getElementById('uniget-cancel').onclick = () => {
        popup.style.display = 'none';
        btn.style.display = 'block';
        if (pollTimer) clearInterval(pollTimer);
        document.getElementById('uniget-progress-container').style.display = 'none';
        document.getElementById('uniget-start').style.display = 'block';
        document.getElementById('uniget-cancel').innerText = 'İptal';
    };

    const btnStart = document.getElementById('uniget-start');
    btnStart.onmouseover = () => btnStart.style.background = '#93c5fd';
    btnStart.onmouseout = () => btnStart.style.background = '#60a5fa';

    // ─── UniGet API (token + one-time pairing approved in the app) ───
    const API_BASE = 'http://localhost:3000';
    const TOKEN_KEY = 'unigetApiToken';

    function gmJson(method, path, body, token) {
        return new Promise((resolve, reject) => {
            const headers = { 'Content-Type': 'application/json', 'X-UniGet-Client': 'userscript' };
            if (token) headers['X-UniGet-Token'] = token;
            GM_xmlhttpRequest({
                method,
                url: `${API_BASE}${path}`,
                headers,
                data: body ? JSON.stringify(body) : undefined,
                onload: (response) => {
                    let data = null;
                    try { data = JSON.parse(response.responseText); } catch (e) {}
                    resolve({ status: response.status, data });
                },
                onerror: () => reject(new Error('UniGet sunucusu kapalı olabilir. Lütfen uygulamayı açın.'))
            });
        });
    }

    async function pairWithApp() {
        const start = await gmJson('POST', '/api/pair', {});
        if (start.status === 429) throw new Error('UniGet başka bir bağlantı isteğini bekliyor veya istek reddedildi.');
        if (!start.data || !start.data.requestId) throw new Error('UniGet bağlantı onayı açılamadı.');
        progressText('UniGet uygulamasında onaylayın...');
        const deadline = Date.now() + 125000;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const poll = await gmJson('POST', '/api/pair/poll', { requestId: start.data.requestId });
            if (poll.status === 404) break;
            if (poll.data && poll.data.status === 'approved' && poll.data.token) {
                GM_setValue(TOKEN_KEY, poll.data.token);
                return poll.data.token;
            }
            if (poll.data && poll.data.status === 'denied') throw new Error('UniGet bağlantı isteği reddedildi.');
        }
        throw new Error('UniGet bağlantı isteği zaman aşımına uğradı.');
    }

    async function api(method, path, body) {
        let token = GM_getValue(TOKEN_KEY, '');
        let res = await gmJson(method, path, body, token);
        if (res.status === 401) {
            GM_setValue(TOKEN_KEY, '');
            token = await pairWithApp();
            res = await gmJson(method, path, body, token);
        }
        if (res.status >= 400 || !res.data || res.data.error) {
            throw new Error((res.data && res.data.error) || `HTTP ${res.status}`);
        }
        return res.data;
    }

    function progressText(text) {
        btnStart.innerText = text;
    }

    function resetStartButton() {
        btnStart.innerText = 'İndir';
        btnStart.disabled = false;
    }

    btnStart.onclick = async (e) => {
        // Page scripts must not be able to queue downloads with fake clicks.
        if (!e.isTrusted) return;
        const videoUrl = window.location.href;
        const quality = document.getElementById('uniget-quality').value;
        const isPlaylist = document.getElementById('uniget-playlist').checked;
        const hasSubtitles = document.getElementById('uniget-subs').checked;

        btnStart.innerText = 'İşleniyor...';
        btnStart.disabled = true;

        let dlData;
        try {
            const info = await api('POST', '/api/info', { url: videoUrl });
            dlData = await api('POST', '/api/download', { url: videoUrl, title: info.title, quality, isPlaylist, hasSubtitles });
        } catch (err) {
            alert(`UniGet: ${err.message}`);
            resetStartButton();
            return;
        }

        btnStart.style.display = 'none';
        document.getElementById('uniget-cancel').innerText = 'Kapat/Gizle';

        const progCont = document.getElementById('uniget-progress-container');
        const progText = document.getElementById('uniget-prog-text');
        const progPct = document.getElementById('uniget-prog-pct');
        const progBar = document.getElementById('uniget-prog-bar');

        progCont.style.display = 'flex';
        progBar.style.width = '0%';
        progBar.style.background = '#60a5fa';

        pollTimer = setInterval(async () => {
            let dlState;
            try {
                dlState = await api('GET', `/api/status/${encodeURIComponent(dlData.id)}`);
            } catch (e) {
                return;
            }
            progPct.innerText = `%${dlState.progress || 0}`;
            progBar.style.width = `${dlState.progress || 0}%`;
            const status = String(dlState.status || '');
            if (status === 'completed') {
                clearInterval(pollTimer);
                progText.innerText = 'Tamamlandı!';
                progBar.style.background = '#4ade80';
                setTimeout(() => {
                    popup.style.display = 'none';
                    btn.style.display = 'block';
                    progCont.style.display = 'none';
                    btnStart.style.display = 'block';
                    document.getElementById('uniget-cancel').innerText = 'İptal';
                    resetStartButton();
                }, 4000);
            } else if (status.toLowerCase().includes('hata') || status.startsWith('error:') || status === 'failed') {
                clearInterval(pollTimer);
                progText.innerText = (dlState.errorDetail || status.replace('error:', '') || 'Hata olustu!').slice(0, 120);
                progBar.style.background = '#f87171';
            } else {
                progText.innerText = dlState.speed ? `${dlState.speed} - ${dlState.eta || '--'}` : 'İndiriliyor...';
            }
        }, 1000);
    };
})();
