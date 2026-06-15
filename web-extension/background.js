const myBrowser = typeof browser !== 'undefined' ? browser : chrome;
const responseCache = new Map();
const FETCH_TIMEOUT_MS = 7000;

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

async function fetchJsonForContentScript(url, options = {}) {
    const method = options.method || 'GET';
    const cacheKey = method === 'GET' && url.includes('https://noembed.com/') ? url : null;
    if (cacheKey && responseCache.has(cacheKey)) {
        const cached = responseCache.get(cacheKey);
        if (Date.now() - cached.ts < 2 * 60 * 1000) return cached.data;
        responseCache.delete(cacheKey);
    }

    const headers = { ...(options.headers || { 'Content-Type': 'application/json' }) };
    if (isUniGetApiUrl(url)) headers['X-UniGet-Client'] = 'extension';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method,
            headers,
            body: options.body || undefined,
            signal: controller.signal
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (cacheKey) responseCache.set(cacheKey, { ts: Date.now(), data });
        return data;
    } finally {
        clearTimeout(timeoutId);
    }
}

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

    myBrowser.tabs.sendMessage(tab.id, { action: 'trigger_download', url }, () => {
        if (!myBrowser.runtime.lastError) return;

        fetchJsonForContentScript('http://127.0.0.1:3000/api/validate-media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        })
        .then(data => {
            if (!data || data.error) throw new Error(data?.error || 'Media could not be verified');
            if (data.downloadable === false || data.mediaType === 'image') throw new Error('Not a video/audio URL');
            return fetchJsonForContentScript('http://127.0.0.1:3000/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    title: tab?.title || data.title || 'Media',
                    thumbnail: data.thumbnail || null,
                    quality: 'best',
                    isPlaylist: false,
                    autoOpen: false
                })
            });
        })
        .then(data => {
            if (!data?.id) throw new Error(data?.error || 'failed');
            myBrowser.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'UniGet',
                message: 'Indirme kuyruga eklendi.'
            });
        })
        .catch(err => {
            myBrowser.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'UniGet',
                message: err.message && err.message !== 'Not a video/audio URL'
                    ? err.message.slice(0, 80)
                    : 'Video veya ses bulunamadi'
            });
        });
    });
});

myBrowser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'notify') {
        myBrowser.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'UniGet',
            message: request.message
        });
        return;
    }

    if (request.type === 'fetch' || request.url) {
        const url = request.url || '';
        const options = request.options || {};
        if (!isAllowedFetchUrl(url)) {
            sendResponse({ error: 'URL not allowed' });
            return;
        }

        fetchJsonForContentScript(url, options)
            .then(data => sendResponse(data))
            .catch(async err => {
                if (url.includes('localhost')) {
                    try {
                        const fallback = url.replace('localhost', '127.0.0.1');
                        sendResponse(await fetchJsonForContentScript(fallback, options));
                        return;
                    } catch (fallbackErr) {
                        sendResponse({ error: fallbackErr.message || err.message || 'Fetch failed' });
                        return;
                    }
                }
                sendResponse({ error: err.message || 'Fetch failed' });
            });
        return true;
    }
});
