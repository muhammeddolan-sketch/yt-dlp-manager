(function() {
    'use strict';

    const messages = {
        tr: { 
            download: "İndir", quality: "Orijinal Kalite", playlist: "Çalma Listesi", subtitles: "Altyazıları İndir", 
            cancel: "İptal", close: "Kapat", error: "Hata oluştu!", connecting: "Bağlanıyor...", 
            processing: "İşleniyor...", completed: "Tamamlandı!", downloading: "İndiriliyor...",
            server_error: "Hata alınamadı veya sunucu kapalı."
        },
        en: { 
            download: "Download", quality: "Original Quality", playlist: "Playlist", subtitles: "Download Subtitles", 
            cancel: "Cancel", close: "Close", error: "Error occurred!", connecting: "Connecting...", 
            processing: "Processing...", completed: "Completed!", downloading: "Downloading...",
            server_error: "Failed to get info or server is down."
        }
    };
    const lang = navigator.language.startsWith('tr') ? 'tr' : 'en';
    const t = (key) => messages[lang][key] || key;
    
    // Firefox/Mozilla Shim
    const myBrowser = typeof browser !== 'undefined' ? browser : chrome;
    console.log("YT-DLM Extension Loaded (Zen/Firefox Mode)");

    function bgFetch(url, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            myBrowser.runtime.sendMessage({ url, method, data }, (response) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError.message);
                else if (response && response.error) reject(response.error);
                else resolve(response);
            });
        });
    }

    let activeVideo = null;
    const btn = document.createElement('div');
    btn.className = 'yt-dlm-mini-btn';
    
    // Logo implementation
    const logoUrl = myBrowser?.runtime?.getURL ? myBrowser.runtime.getURL('icon48.png') : "http://localhost:3000/icon.png";
    const imgElement = document.createElement('img');
    imgElement.src = logoUrl;
    imgElement.style.cssText = "width: 22px; height: 22px; display: block; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));";
    imgElement.alt = ""; 
    
    const label = document.createElement('span');
    label.innerText = t('download');
    label.style.cssText = "margin-left: 8px; font-weight: 700; color: white; display: block; white-space: nowrap;";

    btn.appendChild(imgElement);
    btn.appendChild(label);

    btn.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.9);
        backdrop-filter: blur(8px);
        padding: 5px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.2);
        cursor: pointer;
        display: none;
        align-items: center;
        transition: transform 0.2s, background 0.2s;
        pointer-events: auto;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        color: white;
    `;

    document.body.appendChild(btn);
    
    // Quality & Settings Modal (Enhanced v1.4.2)
    const popup = document.createElement('div');
    popup.id = 'yt-dlm-popup';
    popup.style.cssText = `
        position: fixed; z-index: 2147483648; display: none;
        background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px);
        color: white; padding: 15px; border-radius: 12px;
        flex-direction: column; gap: 12px; border: 1px solid rgba(255,255,255,0.15);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        min-width: 240px; box-shadow: 0 15px 30px rgba(0,0,0,0.7); 
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    
    const titleDiv = document.createElement('div');
    titleDiv.style.cssText = "font-weight: 700; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; font-size: 15px; color: #60a5fa;";
    titleDiv.textContent = "YT-DLM Pro v1.4.2";
    popup.appendChild(titleDiv);

    // Video Info Section
    const infoSection = document.createElement('div');
    infoSection.style.cssText = "display: flex; flex-direction: column; gap: 8px; font-size: 12px;";
    
    const thumbnail = document.createElement('img');
    thumbnail.id = "yt-dlm-thumb";
    thumbnail.style.cssText = "width: 100%; height: 110px; border-radius: 8px; object-fit: cover; display: none; border: 1px solid rgba(255,255,255,0.1);";
    infoSection.appendChild(thumbnail);
    
    const videoTitle = document.createElement('div');
    videoTitle.id = "yt-dlm-title";
    videoTitle.style.cssText = "font-weight: 600; color: white; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;";
    videoTitle.textContent = "...";
    infoSection.appendChild(videoTitle);

    const videoSub = document.createElement('div');
    videoSub.id = "yt-dlm-duration";
    videoSub.style.cssText = "opacity: 0.6; font-size: 11px;";
    videoSub.textContent = t('processing');
    infoSection.appendChild(videoSub);

    popup.appendChild(infoSection);

    const qualitySelect = document.createElement('select');
    qualitySelect.id = "yt-dlm-quality";
    qualitySelect.style.cssText = "background: #1e293b; color: white; border: 1px solid #334155; padding: 8px; border-radius: 8px; outline: none; cursor: pointer; font-size: 13px;";
    const qualities = [
        { v: "best", t: t('quality') },
        { v: "2160", t: "2160p (4K)" },
        { v: "1440", t: "1440p (2K)" },
        { v: "1080", t: "1080p" },
        { v: "720", t: "720p" },
        { v: "480", t: "480p" },
        { v: "audio", t: "Audio Only (.m4a)" }
    ];
    qualities.forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.v;
        opt.textContent = q.t;
        qualitySelect.appendChild(opt);
    });
    popup.appendChild(qualitySelect);

    const optionsGrid = document.createElement('div');
    optionsGrid.style.cssText = "display: flex; justify-content: space-between; gap: 10px;";

    const playlistLabel = document.createElement('label');
    playlistLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer; color: #cbd5e1; font-size: 11px;";
    const playlistCheck = document.createElement('input');
    playlistCheck.type = "checkbox";
    playlistCheck.id = "yt-dlm-playlist";
    playlistLabel.appendChild(playlistCheck);
    playlistLabel.appendChild(document.createTextNode(t('playlist')));
    optionsGrid.appendChild(playlistLabel);

    const subsLabel = document.createElement('label');
    subsLabel.style.cssText = "display: flex; gap: 6px; align-items: center; cursor: pointer; color: #cbd5e1; font-size: 11px;";
    const subsCheck = document.createElement('input');
    subsCheck.type = "checkbox";
    subsCheck.id = "yt-dlm-subs";
    subsLabel.appendChild(subsCheck);
    subsLabel.appendChild(document.createTextNode(t('subtitles')));
    optionsGrid.appendChild(subsLabel);
    
    popup.appendChild(optionsGrid);

    const btnStart = document.createElement('button');
    btnStart.id = "yt-dlm-start";
    btnStart.style.cssText = "background: #60a5fa; color: #0f172a; border: none; padding: 10px; border-radius: 8px; font-weight: 800; cursor: pointer; transition: 0.2s; font-size: 14px; margin-top: 5px;";
    btnStart.textContent = t('download');
    popup.appendChild(btnStart);

    const btnCancel = document.createElement('button');
    btnCancel.id = "yt-dlm-cancel";
    btnCancel.style.cssText = "background: rgba(248, 113, 113, 0.1); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); padding: 8px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 12px;";
    btnCancel.textContent = t('cancel');
    popup.appendChild(btnCancel);

    const progCont = document.createElement('div');
    progCont.id = "yt-dlm-progress-container";
    progCont.style.cssText = "display: none; flex-direction: column; gap: 5px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;";
    
    const progInfo = document.createElement('div');
    progInfo.style.cssText = "font-size: 11px; color: #cbd5e1; display: flex; justify-content: space-between;";
    const progText = document.createElement('span');
    progText.id = "yt-dlm-prog-text";
    progText.style.cssText = "white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;";
    progText.textContent = t('connecting');
    const progPct = document.createElement('span');
    progPct.id = "yt-dlm-prog-pct";
    progPct.textContent = "%0";
    progInfo.appendChild(progText);
    progInfo.appendChild(progPct);
    
    const progOuter = document.createElement('div');
    progOuter.style.cssText = "width: 100%; height: 8px; background: #334155; border-radius: 4px; overflow: hidden;";
    const progBar = document.createElement('div');
    progBar.id = "yt-dlm-prog-bar";
    progBar.style.cssText = "width: 0%; height: 100%; background: #60a5fa; transition: width 0.3s, background 0.3s;";
    progOuter.appendChild(progBar);
    
    progCont.appendChild(progInfo);
    progCont.appendChild(progOuter);
    popup.appendChild(progCont);

    document.body.appendChild(popup);

    function loadVideoInfo(url) {
        thumbnail.style.display = 'none';
        videoTitle.textContent = "...";
        videoSub.textContent = t('processing');
        btnStart.disabled = true;

        bgFetch("http://127.0.0.1:3000/api/info", "POST", { url: url })
        .then(info => {
            if (info.thumbnail) {
                thumbnail.src = info.thumbnail;
                thumbnail.style.display = 'block';
            }
            videoTitle.textContent = info.title;
            // Store real URL for the download if it was a context menu link
            videoTitle.setAttribute('data-url', url);
            videoSub.textContent = `${info.uploader || '--'} • ${info.duration || '--'}`;
            btnStart.disabled = false;
        })
        .catch(err => {
            videoTitle.textContent = t('error');
            videoSub.textContent = err.message || t('server_error');
        });
    }

    // Listen for triggers
    myBrowser.runtime.onMessage.addListener((request) => {
        if (request.action === "trigger_download") {
            popup.style.top = '50px';
            popup.style.left = (window.innerWidth / 2 - 120) + 'px';
            popup.style.display = 'flex';
            btn.style.display = 'none';
            loadVideoInfo(request.url);
        }
    });

    // More aggressive video detection including shadow roots if needed
    // Faster video detection
    function getAllVideos() {
        // Direct light DOM videos are most common
        let videos = Array.from(document.querySelectorAll('video'));
        
        // Specific check for YouTube and other common players
        const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        if (player) {
            const pv = player.querySelectorAll('video');
            pv.forEach(v => { if (!videos.includes(v)) videos.push(v); });
        }
        
        return videos.filter(v => v.isConnected && v.offsetWidth > 0 && v.offsetHeight > 0);
    }

    function updatePosition() {
        if (!activeVideo || !activeVideo.isConnected) {
            if (popup.style.display === 'none') btn.style.display = 'none';
            return;
        }

        // Ensure button is always in the highest container for visibility (highest z-index)
        const playerContainer = activeVideo.closest('#movie_player') || activeVideo.closest('.html5-video-player') || activeVideo.parentElement || document.body;
        
        if (btn.parentElement !== playerContainer) {
            playerContainer.appendChild(btn);
            btn.style.position = playerContainer === document.body ? 'fixed' : 'absolute';
            btn.style.zIndex = "2147483647"; 
        }

        const rect = activeVideo.getBoundingClientRect();
        const containerRect = btn.parentElement.getBoundingClientRect();
        
        // Don't show if video is not currently visible
        if (rect.width === 0 || rect.height === 0) {
            if (popup.style.display === 'none') btn.style.display = 'none';
            return;
        }
        
        // Calculate relative position based on parent container
        let top, left;
        const buttonWidth = btn.offsetWidth || 80;

        if (btn.style.position === 'absolute' && btn.parentElement !== document.body) {
            top = Math.max(10, (rect.top - containerRect.top) + 10);
            left = Math.min((rect.width - buttonWidth - 10), (rect.left - containerRect.left) + rect.width - buttonWidth - 10);
        } else {
            top = Math.max(10, rect.top + 10);
            left = Math.min(window.innerWidth - buttonWidth - 10, rect.left + rect.width - buttonWidth - 10);
        }
        
        btn.style.top = top + 'px';
        btn.style.left = left + 'px';
        
        if (popup.style.display === 'none') btn.style.display = 'flex';
    }

    // Faster polling (500ms) for better navigation response
    setInterval(() => {
        const videos = getAllVideos();
        if (videos.length > 0) {
            // Sort by size (largest first)
            videos.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
            activeVideo = videos[0];
            if (popup.style.display === 'none') {
                updatePosition();
            }
        } else {
            activeVideo = null;
            if (popup.style.display === 'none') {
                btn.style.display = 'none';
            }
        }
    }, 500);

    window.addEventListener('scroll', () => { if (popup.style.display === 'none') updatePosition(); }, true);
    window.addEventListener('resize', () => { if (popup.style.display === 'none') updatePosition(); }, true);

    btn.onmouseover = () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.background = 'rgba(30, 41, 59, 0.95)';
    };
    btn.onmouseout = () => {
        btn.style.transform = 'scale(1)';
        btn.style.background = 'rgba(15, 23, 42, 0.9)';
    };
    
    btn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const rect = btn.getBoundingClientRect();
        popup.style.top = rect.top + 'px';
        popup.style.left = (rect.left - 180) + 'px';
        popup.style.display = 'flex';
        btn.style.display = 'none';
    };

    let pollTimer = null;

    btn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const rect = btn.getBoundingClientRect();
        popup.style.top = Math.min(window.innerHeight - 450, rect.top) + 'px';
        popup.style.left = Math.max(10, rect.left - 250) + 'px';
        popup.style.display = 'flex';
        btn.style.display = 'none';
        
        loadVideoInfo(window.location.href);
    };

    btnCancel.onclick = () => {
        popup.style.display = 'none';
        btn.style.display = 'flex';
        if (pollTimer) clearInterval(pollTimer);
        progCont.style.display = 'none';
        btnStart.style.display = 'block';
        btnCancel.textContent = t('cancel');
        btnStart.textContent = t('download');
        btnStart.disabled = false;
    };

    btnStart.onmouseover = () => btnStart.style.background = '#93c5fd';
    btnStart.onmouseout = () => btnStart.style.background = '#60a5fa';

    btnStart.onclick = () => {
        const videoUrl = videoTitle.getAttribute('data-url') || window.location.href;
        const quality = document.getElementById('yt-dlm-quality').value;
        const isPlaylist = document.getElementById('yt-dlm-playlist').checked;
        const hasSubtitles = document.getElementById('yt-dlm-subs').checked;
        
        btnStart.innerText = t('processing');
        btnStart.disabled = true;
        
        bgFetch("http://127.0.0.1:3000/api/download", "POST", { 
            url: videoUrl, title: videoTitle.textContent, quality: quality, isPlaylist: isPlaylist, hasSubtitles: hasSubtitles 
        })
        .then(data => {
            btnStart.style.display = 'none';
            btnCancel.textContent = t('close');
            
            progCont.style.display = 'flex';
            progBar.style.width = '0%';
            progBar.style.background = '#60a5fa';
            
            pollTimer = setInterval(() => {
                bgFetch(`http://127.0.0.1:3000/api/status/${data.id}`, 'GET')
                .then(dl => {
                    if (dl.error || !dl.id) return;
                    progPct.innerText = `%${dl.progress || 0}`;
                    progBar.style.width = `${dl.progress || 0}%`;
                    
                    if (dl.status === 'completed') {
                        clearInterval(pollTimer);
                        progText.innerText = t('completed');
                        progBar.style.background = '#4ade80';
                        
                        // Send completion notification
                        myBrowser.runtime.sendMessage({ action: "notify", message: `"${videoTitle.textContent}" ${t('completed')}` });
                        
                        setTimeout(() => { 
                            popup.style.display = 'none'; 
                            btn.style.display = 'flex'; 
                            progCont.style.display = 'none'; 
                            btnStart.style.display = 'block'; 
                            btnCancel.textContent = t('cancel'); 
                            btnStart.textContent = t('download');
                            btnStart.disabled = false;
                        }, 4000);
                    } else if (dl.status.toLowerCase().includes('hata') || dl.status === 'failed') {
                        clearInterval(pollTimer);
                        progText.innerText = t('error');
                        progBar.style.background = '#f87171';
                    } else {
                        progText.innerText = dl.speed ? `${dl.speed} - ${dl.eta || '--'}` : t('downloading');
                    }
                })
                .catch(() => {});
            }, 1000);
        })
        .catch(err => {
            alert(err.message || t('server_error'));
            btnStart.innerText = t('download');
            btnStart.disabled = false;
        });
    };
})();
