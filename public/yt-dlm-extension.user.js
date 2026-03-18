// ==UserScript==
// @name         YT-DLM Web Helper
// @namespace    http://tampermonkey.net/
// @version      1.1
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
    
    // Style: Minimalist, semi-transparent, elegant
    btn.innerHTML = '<i class="fas fa-download"></i> İndir';
    btn.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        background: rgba(16, 185, 129, 0.85);
        color: white;
        padding: 6px 14px;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: none;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.2);
        box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        transition: transform 0.2s, background 0.2s;
        pointer-events: auto;
    `;

    // Add font-awesome
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(link);
    document.body.appendChild(btn);

    function updatePosition() {
        if (!activeVideo || !activeVideo.isConnected) {
            btn.style.display = 'none';
            return;
        }
        const rect = activeVideo.getBoundingClientRect();
        if (rect.top === 0 && rect.height === 0) {
            btn.style.display = 'none';
            return;
        }
        
        // Dynamic positioning: Top-right of the video but within viewport
        const top = Math.max(10, rect.top + 10);
        const left = Math.min(window.innerWidth - 100, rect.left + rect.width - 90);
        
        btn.style.top = top + 'px';
        btn.style.left = left + 'px';
        btn.style.display = 'block';
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target.tagName === 'VIDEO' || (target.closest && target.closest('video'))) {
            activeVideo = target.tagName === 'VIDEO' ? target : target.closest('video');
            updatePosition();
        }
    }, true);

    // Hide if mouse leaves video and button
    document.addEventListener('mousemove', (e) => {
        if (!activeVideo) return;
        const target = e.target;
        if (target !== btn && target !== activeVideo && !activeVideo.contains(target)) {
            // Give a small buffer or delay? For now just hide if far
            const rect = activeVideo.getBoundingClientRect();
            const buffer = 50;
            if (e.clientX < rect.left - buffer || e.clientX > rect.right + buffer || 
                e.clientY < rect.top - buffer || e.clientY > rect.bottom + buffer) {
                btn.style.display = 'none';
                activeVideo = null;
            }
        }
    });

    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; btn.style.background = '#059669'; };
    btn.onmouseout = () => { btn.style.transform = 'scale(1)'; btn.style.background = 'rgba(16, 185, 129, 0.85)'; };
    
    btn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const videoUrl = window.location.href;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> İşleniyor...';
        
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
                        data: JSON.stringify({ url: videoUrl, title: info.title }),
                        onload: function() {
                            btn.innerHTML = '<i class="fas fa-check"></i> Eklendi!';
                            setTimeout(() => {
                                btn.innerHTML = '<i class="fas fa-download"></i> İndir';
                                btn.style.display = 'none';
                            }, 3000);
                        }
                    });
                } catch(err) {
                    alert('Hata: Video bilgisi alınamadı.');
                    btn.innerHTML = '<i class="fas fa-download"></i> İndir';
                }
            },
            onerror: function() {
                alert('YT-DLM Sunucusu kapalı olabilir. Lütfen uygulamayı açın.');
                btn.innerHTML = '<i class="fas fa-download"></i> İndir';
            }
        });
    };
})();
