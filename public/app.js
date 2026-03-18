const socket = io();
const urlInput = document.getElementById('urlInput');
const addBtn = document.getElementById('addBtn');
const downloadList = document.getElementById('downloadList');
const infoModal = document.getElementById('infoModal');
const closeModal = document.querySelector('.close-modal');
const confirmDownload = document.getElementById('confirmDownload');

let currentVideoInfo = null;
let activeDownloads = {};

// Socket events
socket.on('initial-state', (data) => {
    activeDownloads = data;
    renderList();
});

socket.on('progress', (data) => {
    activeDownloads[data.id] = data;
    updateCard(data);
});

// UI Actions
addBtn.onclick = async () => {
    const url = urlInput.value.trim();
    if (!url) return;

    addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Bilgi alınıyor...';
    try {
        const res = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const info = await res.json();
        if (info.error) throw new Error(info.error);
        
        currentVideoInfo = { ...info, url };
        showModal(info);
    } catch (e) {
        alert('Hata: ' + e.message);
    } finally {
        addBtn.innerHTML = '<i class="fas fa-plus"></i> Ekle';
    }
};

confirmDownload.onclick = async () => {
    if (!currentVideoInfo) return;

    const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            url: currentVideoInfo.url,
            title: currentVideoInfo.title 
        })
    });
    
    infoModal.style.display = 'none';
    urlInput.value = '';
};

// Modal functions
function showModal(info) {
    document.getElementById('modalThumbnail').src = info.thumbnail;
    document.getElementById('modalTitle').innerText = info.title;
    document.getElementById('modalUploader').innerText = info.uploader;
    document.getElementById('modalDuration').innerText = 'Süre: ' + info.duration;
    infoModal.style.display = 'block';
}

closeModal.onclick = () => infoModal.style.display = 'none';
window.onclick = (e) => { if(e.target == infoModal) infoModal.style.display = 'none'; };

// Rendering
function renderList() {
    if (Object.keys(activeDownloads).length === 0) {
        downloadList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-cloud-download-alt"></i>
                <p>Henüz bir indirme yok. Bir URL ekleyerek başlayın!</p>
            </div>
        `;
        return;
    }

    downloadList.innerHTML = '';
    Object.values(activeDownloads).reverse().forEach(dl => {
        downloadList.appendChild(createCard(dl));
    });
}

function createCard(dl) {
    const card = document.createElement('div');
    card.className = 'download-card';
    card.id = `dl-${dl.id}`;
    card.innerHTML = `
        <div class="card-icon">
            <i class="fas ${dl.status === 'completed' ? 'fa-check' : 'fa-download'}"></i>
        </div>
        <div class="card-details">
            <div class="card-title">${dl.title}</div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${dl.progress || 0}%"></div>
            </div>
            <div class="card-meta">
                <span><i class="fas fa-percent"></i> ${dl.progress || 0}%</span>
                <span><i class="fas fa-tachometer-alt"></i> ${dl.speed || '0 KiB/s'}</span>
                <span><i class="fas fa-clock"></i> ${dl.eta || '--:--'}</span>
                <span class="status-badge status-${dl.status}">${dl.status}</span>
            </div>
        </div>
        <div class="card-actions">
            <button class="btn-icon"><i class="fas fa-folder-open"></i></button>
        </div>
    `;
    card.querySelector('.btn-icon').onclick = () => {
        fetch('/api/open-folder', { method: 'POST' });
    };
    return card;
}

function updateCard(dl) {
    let card = document.getElementById(`dl-${dl.id}`);
    if (!card) {
        // If it's a new download that wasn't in list
        const emptyState = downloadList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        card = createCard(dl);
        downloadList.prepend(card);
    }

    const progressBar = card.querySelector('.progress-bar');
    const meta = card.querySelector('.card-meta');
    const icon = card.querySelector('.card-icon i');

    progressBar.style.width = `${dl.progress}%`;
    meta.innerHTML = `
        <span><i class="fas fa-percent"></i> ${dl.progress}%</span>
        <span><i class="fas fa-tachometer-alt"></i> ${dl.speed}</span>
        <span><i class="fas fa-clock"></i> ${dl.eta}</span>
        <span class="status-badge status-${dl.status}">${dl.status === 'completed' ? 'Tamamlandı' : dl.status}</span>
    `;

    if (dl.status === 'completed') {
        icon.className = 'fas fa-check';
        icon.parentElement.style.color = 'var(--accent)';
    }
}
