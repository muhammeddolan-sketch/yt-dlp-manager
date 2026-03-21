const socket = io();
const urlInput = document.getElementById('urlInput');
const addBtn = document.getElementById('addBtn');
const downloadList = document.getElementById('downloadList');
const infoModal = document.getElementById('infoModal');
const closeModal = document.querySelector('.close-modal');
const confirmDownload = document.getElementById('confirmDownload');
const qualityOption = document.getElementById('qualityOption');
const isPlaylistCheck = document.getElementById('isPlaylistCheck');
const modalPlaylistCheck = document.getElementById('modalPlaylistCheck');
const modalSubtitlesCheck = document.getElementById('modalSubtitlesCheck');

const openFolderGlobal = document.getElementById('openFolderGlobal');
const clearCompletedBtn = document.getElementById('clearCompletedBtn');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const langSelect = document.getElementById('langSelect');

// Init Language UI
if (langSelect) {
    langSelect.value = currentLang;
    langSelect.onchange = (e) => setLanguage(e.target.value);
    updateUI(); 
}

// Details Chart Handlers
const detailsModal = document.getElementById('detailsModal');
const closeDetails = document.querySelector('.close-details');
let activeDetailsId = null;

closeDetails.onclick = () => {
    detailsModal.style.display = 'none';
    activeDetailsId = null;
};
window.addEventListener('click', (e) => {
    if (e.target == detailsModal) {
        detailsModal.style.display = 'none';
        activeDetailsId = null;
    }
});

// Enable Electron clipboard integration gracefully (only if running inside Electron)
let electronClipboard = null;
try {
    const { clipboard } = require('electron');
    electronClipboard = clipboard;
} catch (e) {}

let currentVideoInfo = null;
let activeDownloads = {};
let currentView = 'all';

// Clipboard Auto-Fill Check
let lastClipboardText = '';
if (electronClipboard) {
    setInterval(() => {
        try {
            const text = electronClipboard.readText().trim();
            if (text && text !== lastClipboardText && (text.includes('youtube.com/') || text.includes('youtu.be/') || text.includes('twitter.com/') || text.includes('x.com/') || text.includes('instagram.com/'))) {
                lastClipboardText = text;
                urlInput.value = text;
                // Auto trigger add button optionally, or just paste it
                if (window.document.hasFocus() || true) {
                    addBtn.click();
                }
            }
        } catch (e) {}
    }, 1500);
}

navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        currentView = item.getAttribute('data-view');
        renderList();
    });
});

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
    if (data.speed && data.speed.includes) {
        val = parseFloat(data.speed) || 0;
        if (data.speed.includes('MiB/s')) val *= 1024;
        if (data.speed.includes('GiB/s')) val *= 1024 * 1024;
    }
    dl.speedHistory.push(val);
    if (dl.speedHistory.length > 70) dl.speedHistory.shift();

    updateCard(dl);
    
    if (activeDetailsId === dl.id) {
        updateDetailsModal(dl);
    }
});

addBtn.onclick = async () => {
    const url = urlInput.value.trim();
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
        if (modalPlaylistCheck) modalPlaylistCheck.checked = isPlaylistCheck.checked;
        showModal(info);
    } catch (e) {
        alert(t('error') + ': ' + e.message);
    } finally {
        addBtn.innerHTML = '<i class="fas fa-plus"></i>';
    }
};

confirmDownload.onclick = async () => {
    if (!currentVideoInfo) return;

    await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            url: currentVideoInfo.url,
            title: currentVideoInfo.title,
            quality: qualityOption.value,
            isPlaylist: modalPlaylistCheck ? modalPlaylistCheck.checked : isPlaylistCheck.checked,
            hasSubtitles: modalSubtitlesCheck ? modalSubtitlesCheck.checked : false
        })
    });
    
    infoModal.style.display = 'none';
    urlInput.value = '';
};

openFolderGlobal.onclick = () => {
    fetch('/api/open-folder', { method: 'POST' });
};

clearCompletedBtn.onclick = () => {
    fetch('/api/clear-completed', { method: 'POST' });
};

function showModal(info) {
    document.getElementById('modalThumbnail').src = info.thumbnail || 'icon.png';
    document.getElementById('modalTitle').innerText = info.title;
    document.getElementById('modalUploader').innerText = info.uploader || t('loading');
    document.getElementById('modalDuration').innerText = t('duration') + ': ' + (info.duration || '--:--');
    infoModal.style.display = 'block';
}

closeModal.onclick = () => infoModal.style.display = 'none';
window.onclick = (e) => { if (e.target == infoModal) infoModal.style.display = 'none'; };

function renderList() {
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
                <p data-i18n="no_downloads">${t('no_downloads')}</p>
            </div>
        `;
        return;
    }

    downloadList.innerHTML = '';
    dlArray.forEach(dl => {
        downloadList.appendChild(createCard(dl));
    });
}

function updateDetailsModal(dl) {
    document.getElementById('detailsTitle').innerText = dl.title;
    document.getElementById('detailsSpeed').innerText = dl.speed || '--';
    document.getElementById('detailsEta').innerText = dl.eta || '--:--';
    document.getElementById('detailsProg').innerText = `%${dl.progress || 0}`;
    drawChart(dl);
}

function drawChart(dl) {
    const canvas = document.getElementById('speedChart');
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
    ctx.strokeStyle = '#60a5fa'; 
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(96, 165, 250, 0.2)';
    
    const step = w / 70; 
    
    ctx.moveTo(0, h);
    for (let i = 0; i < history.length; i++) {
        const val = history[i];
        const x = i * step;
        const y = h - (val / maxSpeed) * h * 0.9; 
        ctx.lineTo(x, y);
    }
    ctx.lineTo((history.length - 1) * step, h);
    ctx.closePath();
    ctx.fill();
    
    ctx.beginPath();
    ctx.moveTo(0, h - (history[0] / maxSpeed) * h * 0.9);
    for (let i = 1; i < history.length; i++) {
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
    
    // We render an empty shell and rely on updateCard to structure it immediately
    card.innerHTML = `
        <div class="card-icon"><i class="fas fa-arrow-down"></i></div>
        <div class="card-details">
            <div class="card-title" title="${dl.title}">${dl.title} ${dl.isPlaylist ? ' [' + t('playlist') + ']' : ''}</div>
            <div class="progress-container">
                <div class="progress-bar" style="width: 0%"></div>
            </div>
            <div class="card-meta"></div>
        </div>
        <div class="card-actions" style="display:flex; gap: 5px;"></div>
    `;
    
    // Defer update slightly so it is attached securely
    setTimeout(() => updateCard(dl), 10);
    return card;
}

function updateCard(dl) {
    let card = document.getElementById(`dl-${dl.id}`);
    if (!card) {
        const emptyState = downloadList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        card = createCard(dl);
        downloadList.prepend(card);
        return; // Recurses on timeout
    }

    const progressBar = card.querySelector('.progress-bar');
    const meta = card.querySelector('.card-meta');
    const icon = card.querySelector('.card-icon i');
    const actions = card.querySelector('.card-actions');

    progressBar.style.width = `${dl.progress || 0}%`;
    let statusText = dl.status === 'completed' ? t('completed_status') : (dl.status === 'paused' ? t('paused_status') : dl.status);

    meta.innerHTML = `
        <span><i class="fas fa-percent"></i> ${dl.progress || 0}%</span>
        <span><i class="fas fa-tachometer-alt"></i> ${dl.speed || '--'}</span>
        <span><i class="fas fa-clock"></i> ${dl.eta || '--:--'}</span>
        <span class="status-badge" style="text-transform: capitalize;">${statusText}</span>
    `;

    if (dl.status === 'completed') {
        icon.className = 'fas fa-check';
        icon.parentElement.style.color = '#4ade80';
    } else if (dl.status.toLowerCase().includes('hata') || dl.status === 'failed') {
        icon.className = 'fas fa-exclamation-triangle';
        icon.parentElement.style.color = '#f87171';
    } else if (dl.status === 'paused') {
        icon.className = 'fas fa-pause';
        icon.parentElement.style.color = '#fbbf24';
    } else {
        icon.className = 'fas fa-arrow-down';
        icon.parentElement.style.color = 'var(--accent)';
    }

    // Interactive action buttons layout
    let actionButtons = '';
    if (dl.status === 'downloading' || dl.status === 'starting') {
        actionButtons += `<button class="btn-icon pause-btn" title="${t('pause')}"><i class="fas fa-pause"></i></button>`;
    } else if (dl.status === 'paused' || dl.status === 'failed') {
        actionButtons += `<button class="btn-icon resume-btn" title="${t('resume')}"><i class="fas fa-play"></i></button>`;
    }
    actionButtons += `<button class="btn-icon details-btn" title="${t('details_btn')}"><i class="fas fa-chart-line"></i></button>`;
    actionButtons += `<button class="btn-icon open-btn" title="${t('open_folder')}"><i class="fas fa-folder-open"></i></button>`;
    
    actions.innerHTML = actionButtons;

    const pb = actions.querySelector('.pause-btn');
    if (pb) pb.onclick = () => fetch('/api/action', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: dl.id, action: 'pause'}) });

    const rb = actions.querySelector('.resume-btn');
    if (rb) rb.onclick = () => fetch('/api/action', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: dl.id, action: 'resume'}) });
    
    const db = actions.querySelector('.details-btn');
    if (db) db.onclick = () => {
        activeDetailsId = dl.id;
        detailsModal.style.display = 'block';
        updateDetailsModal(dl);
    };

    const ob = actions.querySelector('.open-btn');
    if (ob) ob.onclick = () => fetch('/api/open-folder', { method: 'POST' });
}

// Donate Button Action
const donateBtn = document.getElementById('donateBtn');
if (donateBtn) {
    donateBtn.onclick = () => {
        try {
            require('electron').shell.openExternal('https://github.com/sponsors');
        } catch(e) {
            alert(t('donate_msg'));
        }
    };
}
