const myBrowser = typeof browser !== 'undefined' ? browser : chrome;

function isAllowedFetchUrl(value) {
    try {
        const parsed = new URL(value);
        if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
            parsed.protocol === 'http:' &&
            parsed.port === '3000') {
            return true;
        }
        return parsed.protocol === 'https:' && parsed.hostname === 'noembed.com';
    } catch {
        return false;
    }
}

function isUniGetApiUrl(value) {
    try {
        const parsed = new URL(value);
        return (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
            parsed.protocol === 'http:' &&
            parsed.port === '3000';
    } catch {
        return false;
    }
}

// ─── Context menu ─────────────────────────────────────────────────
myBrowser.runtime.onInstalled.addListener(() => {
    myBrowser.contextMenus.create({
        id: 'uniget-download',
        title: 'Download with UniGet',
        contexts: ['link', 'video', 'audio', 'page']
    });
});

myBrowser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'uniget-download') return;
    const url = info.linkUrl || info.srcUrl || info.pageUrl;

    // Try to open the popup UI via content script first
    myBrowser.tabs.sendMessage(tab.id, { action: 'trigger_download', url }, () => {
        if (!myBrowser.runtime.lastError) return;
        // Content script not available — fire direct API call
        fetch('http://127.0.0.1:3000/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-UniGet-Client': 'extension' },
            body: JSON.stringify({ url, title: tab?.title || 'Media', quality: 'best', isPlaylist: false, autoOpen: false })
        })
        .then(r => r.json())
        .then(data => {
            if (!data?.id) throw new Error(data?.error || 'failed');
            myBrowser.notifications.create({
                type: 'basic', iconUrl: 'icon48.png',
                title: 'UniGet', message: 'İndirme kuyruğa eklendi.'
            });
        })
        .catch(() => {
            myBrowser.notifications.create({
                type: 'basic', iconUrl: 'icon48.png',
                title: 'UniGet', message: 'Uygulama bulunamadı (localhost:3000)'
            });
        });
    });
});

// ─── Message relay (fetch proxy for content scripts) ──────────────
myBrowser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'notify') {
        myBrowser.notifications.create({
            type: 'basic', iconUrl: 'icon48.png',
            title: 'UniGet', message: request.message
        });
        return;
    }

    if (request.type === 'fetch' || request.url) {
        const url     = request.url || '';
        const options = request.options || {};
        if (!isAllowedFetchUrl(url)) {
            sendResponse({ error: 'URL not allowed' });
            return;
        }

        const headers = { ...(options.headers || { 'Content-Type': 'application/json' }) };
        if (isUniGetApiUrl(url)) headers['X-UniGet-Client'] = 'extension';

        fetch(url, {
            method:  options.method  || 'GET',
            headers,
            body:    options.body    || undefined
        })
        .then(async res => {
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status}: ${text}`);
            }
            return res.json();
        })
        .then(data => sendResponse(data))
        .catch(err => {
            // localhost → 127.0.0.1 fallback (one retry)
            if (url.includes('localhost') && !request._retried) {
                const fallback = url.replace('localhost', '127.0.0.1');
                myBrowser.runtime.sendMessage({ ...request, url: fallback, _retried: true }, sendResponse);
                return;
            }
            sendResponse({ error: err.message || 'Fetch failed' });
        });
        return true; // keep channel open for async sendResponse
    }
});
