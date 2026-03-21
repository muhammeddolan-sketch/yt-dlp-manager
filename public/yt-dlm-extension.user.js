// ==UserScript==
// @name         YT-DLM Web Helper
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Adds a clean floating download button to all videos
// @author       Antigravity
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    let activeVideo = null;
    const btn = document.createElement('div');
    
    // Logo Only Request implementation
    btn.innerHTML = '<img src="http://localhost:3000/icon.png" style="width: 28px; height: 28px; display: block; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.6)); border-radius: 6px;" alt="YT-DLM">';
    btn.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        padding: 2px;
        cursor: pointer;
        display: none;
        transition: transform 0.2s;
        pointer-events: auto;
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
        <div style="font-weight: 600; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; font-size: 14px;">YT-DLM</div>
        <select id="yt-dlm-quality" style="background: #1e293b; color: white; border: 1px solid #334155; padding: 6px; border-radius: 6px; outline: none; cursor: pointer;">
            <option value="best">Orijinal Kalite</option>
            <option value="2160">2160p (4K)</option>
            <option value="1440">1440p (2K)</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
            <option value="audio">Sadece Ses</option>
        </select>
        <label style="display: flex; gap: 6px; align-items: center; cursor: pointer; color: #cbd5e1; margin-top: 2px;">
            <input type="checkbox" id="yt-dlm-playlist"> Çalma Listesi
        </label>
        <label style="display: flex; gap: 6px; align-items: center; cursor: pointer; color: #cbd5e1; margin-top: -4px;">
            <input type="checkbox" id="yt-dlm-subs"> Altyazıları İndir
        </label>
        <button id="yt-dlm-start" style="background: #60a5fa; color: black; border: none; padding: 8px; border-radius: 6px; font-weight: 700; cursor: pointer; transition: 0.2s;">İndir</button>
        <button id="yt-dlm-cancel" style="background: transparent; color: #f87171; border: 1px solid #f87171; padding: 6px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 11px;">İptal</button>
        <!-- Progress Container -->
        <div id="yt-dlm-progress-container" style="display: none; margin-top: 2px; flex-direction: column; gap: 5px;">
            <div style="font-size: 11px; color: #cbd5e1; display: flex; justify-content: space-between;">
                <span id="yt-dlm-prog-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;">Bağlanıyor...</span>
                <span id="yt-dlm-prog-pct">%0</span>
            </div>
            <div style="width: 100%; height: 6px; background: #334155; border-radius: 3px; overflow: hidden;">
                <div id="yt-dlm-prog-bar" style="width: 0%; height: 100%; background: #60a5fa; transition: width 0.3s, background 0.3s;"></div>
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
        
        if (popup.style.display === 'none') btn.style.display = 'block';
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target.tagName === 'VIDEO' || (target.closest && target.closest('video'))) {
            activeVideo = target.tagName === 'VIDEO' ? target : target.closest('video');
            if (popup.style.display === 'none') updatePosition();
        }
    }, true);

    document.addEventListener('mousemove', (e) => {
        if (!activeVideo || popup.style.display !== 'none') return;
        const target = e.target;
        if (target !== btn && target !== activeVideo && !activeVideo.contains(target)) {
            const rect = activeVideo.getBoundingClientRect();
            const buffer = 50;
            if (e.clientX < rect.left - buffer || e.clientX > rect.right + buffer || 
                e.clientY < rect.top - buffer || e.clientY > rect.bottom + buffer) {
                btn.style.display = 'none';
                activeVideo = null;
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

    document.getElementById('yt-dlm-cancel').onclick = () => {
        popup.style.display = 'none';
        btn.style.display = 'block';
        if (pollTimer) clearInterval(pollTimer);
        document.getElementById('yt-dlm-progress-container').style.display = 'none';
        document.getElementById('yt-dlm-start').style.display = 'block';
        document.getElementById('yt-dlm-cancel').innerText = 'İptal';
    };

    const btnStart = document.getElementById('yt-dlm-start');
    btnStart.onmouseover = () => btnStart.style.background = '#93c5fd';
    btnStart.onmouseout = () => btnStart.style.background = '#60a5fa';

    document.getElementById('yt-dlm-start').onclick = () => {
        const videoUrl = window.location.href;
        const quality = document.getElementById('yt-dlm-quality').value;
        const isPlaylist = document.getElementById('yt-dlm-playlist').checked;
        const hasSubtitles = document.getElementById('yt-dlm-subs').checked;
        
        btnStart.innerText = 'İşleniyor...';
        btnStart.disabled = true;
        
        GM_xmlhttpRequest({
            method: "POST",
            url: "http://localhost:3000/api/info",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ url: videoUrl }),
            onload: function(response) {
                try {
                    const info = JSON.parse(response.responseText);
                    if (info.error) throw new Error(info.error);
                    
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: "http://localhost:3000/api/download",
                        headers: { "Content-Type": "application/json" },
                        data: JSON.stringify({ url: videoUrl, title: info.title, quality: quality, isPlaylist: isPlaylist, hasSubtitles: hasSubtitles }),
                        onload: function(dlResponse) {
                            try {
                                const dlData = JSON.parse(dlResponse.responseText);
                                btnStart.style.display = 'none';
                                document.getElementById('yt-dlm-cancel').innerText = 'Kapat/Gizle';
                                
                                const progCont = document.getElementById('yt-dlm-progress-container');
                                const progText = document.getElementById('yt-dlm-prog-text');
                                const progPct = document.getElementById('yt-dlm-prog-pct');
                                const progBar = document.getElementById('yt-dlm-prog-bar');
                                
                                progCont.style.display = 'flex';
                                progBar.style.width = '0%';
                                progBar.style.background = '#60a5fa';
                                
                                pollTimer = setInterval(() => {
                                    GM_xmlhttpRequest({
                                        method: "GET",
                                        url: `http://localhost:3000/api/status/${dlData.id}`,
                                        onload: function(r) {
                                            try {
                                                const dlState = JSON.parse(r.responseText);
                                                if (dlState.error) return;
                                                progPct.innerText = `%${dlState.progress || 0}`;
                                                progBar.style.width = `${dlState.progress || 0}%`;
                                                
                                                if (dlState.status === 'completed') {
                                                    clearInterval(pollTimer);
                                                    progText.innerText = 'Tamamlandı!';
                                                    progBar.style.background = '#4ade80';
                                                    setTimeout(() => { 
                                                        popup.style.display = 'none'; 
                                                        btn.style.display = 'block'; 
                                                        progCont.style.display = 'none'; 
                                                        btnStart.style.display = 'block'; 
                                                        document.getElementById('yt-dlm-cancel').innerText = 'İptal'; 
                                                        btnStart.innerText = 'İndir';
                                                        btnStart.disabled = false;
                                                    }, 4000);
                                                } else if (dlState.status.toLowerCase().includes('hata') || dlState.status === 'failed') {
                                                    clearInterval(pollTimer);
                                                    progText.innerText = 'Hata oluştu!';
                                                    progBar.style.background = '#f87171';
                                                } else {
                                                    progText.innerText = dlState.speed ? `${dlState.speed} - ${dlState.eta || '--'}` : 'İndiriliyor...';
                                                }
                                            } catch(e) {}
                                        }
                                    });
                                }, 1000);
                            } catch(err) {
                                btnStart.innerText = 'İndir';
                                btnStart.disabled = false;
                            }
                        }
                    });
                } catch(err) {
                    alert('Hata: Video bilgisi alınamadı.');
                    btnStart.innerText = 'İndir';
                    btnStart.disabled = false;
                }
            },
            onerror: function() {
                alert('YT-DLM Sunucusu kapalı olabilir. Lütfen uygulamayı açın.');
                btnStart.innerText = 'İndir';
                btnStart.disabled = false;
            }
        });
    };
})();
